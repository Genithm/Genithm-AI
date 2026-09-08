from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .evidence_followup import (
    FOLLOWUP_JSON_SCHEMA,
    FOLLOWUP_POLICY_VERSION,
    FOLLOWUP_PROMPT_VERSION,
    SYSTEM_INSTRUCTIONS as FOLLOWUP_SYSTEM_INSTRUCTIONS,
    build_followup_input,
    parse_followup_response,
)
from .interpreter import (
    INTERPRETATION_JSON_SCHEMA,
    INTERPRETATION_POLICY_VERSION,
    INTERPRETATION_PROMPT_VERSION,
    SYSTEM_INSTRUCTIONS as INTERPRETER_SYSTEM_INSTRUCTIONS,
    build_interpretation_input,
    parse_interpretation_response,
)
from .planner import (
    PLAN_JSON_SCHEMA,
    POLICY_VERSION,
    PROMPT_VERSION,
    SYSTEM_INSTRUCTIONS,
    build_user_input,
    extract_response_text,
    validate_plan_shape,
)

USER_AGENT = "genithm-ai-worker/0.3.0"


@dataclass(frozen=True, slots=True)
class Settings:
    supabase_url: str
    supabase_secret_key: str
    openai_api_key: str
    model: str
    visibility_seconds: int = 300
    poll_seconds: float = 2.0
    request_timeout_seconds: float = 90.0

    @classmethod
    def from_env(cls) -> "Settings":
        supabase_url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
        supabase_secret_key = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
        openai_api_key = os.environ.get("OPENAI_API_KEY", "").strip()
        model = os.environ.get("GENITHM_AI_MODEL", "").strip()
        if not supabase_url.startswith("https://"):
            raise ValueError("SUPABASE_URL must be an https URL")
        if not supabase_secret_key or supabase_secret_key.startswith("sb_publishable_"):
            raise ValueError("SUPABASE_SECRET_KEY must be a server-side secret key")
        if not openai_api_key:
            raise ValueError("OPENAI_API_KEY is required")
        if not model or len(model) > 128 or any(ch.isspace() for ch in model):
            raise ValueError("GENITHM_AI_MODEL is invalid")
        visibility = int(os.environ.get("GENITHM_AI_VISIBILITY_SECONDS", "300"))
        poll = float(os.environ.get("GENITHM_AI_POLL_SECONDS", "2"))
        timeout = float(os.environ.get("GENITHM_AI_REQUEST_TIMEOUT_SECONDS", "90"))
        if visibility < 60 or visibility > 900:
            raise ValueError("GENITHM_AI_VISIBILITY_SECONDS must be 60..900")
        if poll < 0.25 or poll > 60:
            raise ValueError("GENITHM_AI_POLL_SECONDS must be 0.25..60")
        if timeout < 10 or timeout > 300:
            raise ValueError("GENITHM_AI_REQUEST_TIMEOUT_SECONDS must be 10..300")
        return cls(supabase_url, supabase_secret_key, openai_api_key, model, visibility, poll, timeout)


class JsonHttpClient:
    @staticmethod
    def request(url: str, *, method: str, headers: dict[str, str], payload: dict[str, Any], timeout: float, max_bytes: int = 2 * 1024 * 1024) -> Any:
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
        request = Request(url, data=body, method=method, headers=headers)
        try:
            with urlopen(request, timeout=timeout) as response:
                raw = response.read(max_bytes + 1)
        except HTTPError as exc:
            detail = exc.read(8192).decode("utf-8", "replace")
            retryable = exc.code in {408, 409, 425, 429, 500, 502, 503, 504}
            raise ProviderHttpError(f"HTTP {exc.code}: {detail[:1000]}", retryable=retryable) from exc
        except URLError as exc:
            raise ProviderHttpError("network connection failed", retryable=True) from exc
        if len(raw) > max_bytes:
            raise ProviderHttpError("response exceeded Genithm size limit", retryable=False)
        if not raw:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ProviderHttpError("response was not valid JSON", retryable=False) from exc


class ProviderHttpError(RuntimeError):
    def __init__(self, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.retryable = retryable


class SupabaseRpcClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def rpc(self, name: str, payload: dict[str, Any]) -> Any:
        try:
            return JsonHttpClient.request(
                f"{self.settings.supabase_url}/rest/v1/rpc/{name}",
                method="POST",
                headers={
                    "apikey": self.settings.supabase_secret_key,
                    "Authorization": f"Bearer {self.settings.supabase_secret_key}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "User-Agent": USER_AGENT,
                },
                payload=payload,
                timeout=30.0,
            )
        except ProviderHttpError as exc:
            raise RuntimeError(f"Supabase RPC {name} failed: {exc}") from exc


class OpenAIPlannerClient:
    provider = "openai"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _responses(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = JsonHttpClient.request(
            "https://api.openai.com/v1/responses",
            method="POST",
            headers={
                "Authorization": f"Bearer {self.settings.openai_api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": USER_AGENT,
            },
            payload=payload,
            timeout=self.settings.request_timeout_seconds,
        )
        if not isinstance(response, dict):
            raise ProviderHttpError("provider returned an invalid response shape", retryable=False)
        return response

    def plan(self, user_message: str, authorized_context: dict[str, Any]) -> dict[str, Any]:
        payload = {"model": self.settings.model, "store": False, "instructions": SYSTEM_INSTRUCTIONS, "input": build_user_input(user_message, authorized_context), "text": {"format": {"type": "json_schema", "name": "genithm_ai_plan_v1", "strict": True, "schema": PLAN_JSON_SCHEMA}}}
        response = self._responses(payload)
        try:
            return validate_plan_shape(json.loads(extract_response_text(response)))
        except (json.JSONDecodeError, ValueError) as exc:
            raise ProviderHttpError(f"structured planner output was invalid: {exc}", retryable=False) from exc


class OpenAIInterpreterClient(OpenAIPlannerClient):
    def interpret(self, evidence: dict[str, Any]) -> dict[str, Any]:
        payload = {"model": self.settings.model, "store": False, "instructions": INTERPRETER_SYSTEM_INSTRUCTIONS, "input": build_interpretation_input(evidence), "text": {"format": {"type": "json_schema", "name": "genithm_ai_interpretation_v1", "strict": True, "schema": INTERPRETATION_JSON_SCHEMA}}}
        try:
            return parse_interpretation_response(self._responses(payload), evidence)
        except ValueError as exc:
            raise ProviderHttpError(str(exc), retryable=False) from exc


class OpenAIEvidenceFollowupClient(OpenAIPlannerClient):
    def answer(self, question: str, evidence: dict[str, Any]) -> dict[str, Any]:
        payload = {"model": self.settings.model, "store": False, "instructions": FOLLOWUP_SYSTEM_INSTRUCTIONS, "input": build_followup_input(question, evidence), "text": {"format": {"type": "json_schema", "name": "genithm_ai_evidence_answer_v1", "strict": True, "schema": FOLLOWUP_JSON_SCHEMA}}}
        try:
            return parse_followup_response(self._responses(payload), evidence)
        except ValueError as exc:
            raise ProviderHttpError(str(exc), retryable=False) from exc


def _first_row(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if isinstance(value, list):
        if not value:
            return None
        value = value[0]
    if not isinstance(value, dict):
        raise RuntimeError("Supabase claim response has an unexpected shape")
    return value


def process_plan_once(settings: Settings, rpc: SupabaseRpcClient, planner: OpenAIPlannerClient) -> bool:
    claimed = _first_row(rpc.rpc("claim_ai_plan_request", {"visibility_seconds": settings.visibility_seconds}))
    if claimed is None:
        return False
    message_id = int(claimed["message_id"]); request_id = str(claimed["plan_request_id"]); user_message = str(claimed["user_message"]); authorized_context = claimed.get("authorized_context")
    if not isinstance(authorized_context, dict):
        rpc.rpc("finish_ai_plan_error", {"message_id": message_id, "plan_request_id": request_id, "processing_error": "Authorized context was invalid.", "retryable": False, "max_attempts": 3}); raise RuntimeError("authorized context was invalid")
    try:
        plan = planner.plan(user_message, authorized_context)
        rpc.rpc("finish_ai_plan_success", {"message_id": message_id, "plan_request_id": request_id, "provider": planner.provider, "model": settings.model, "prompt_version": PROMPT_VERSION, "policy_version": POLICY_VERSION, "plan": plan})
        return True
    except ProviderHttpError as exc:
        rpc.rpc("finish_ai_plan_error", {"message_id": message_id, "plan_request_id": request_id, "processing_error": str(exc)[:1500], "retryable": exc.retryable, "max_attempts": 3}); raise
    except Exception as exc:
        rpc.rpc("finish_ai_plan_error", {"message_id": message_id, "plan_request_id": request_id, "processing_error": str(exc)[:1500], "retryable": False, "max_attempts": 3}); raise


def process_interpretation_once(settings: Settings, rpc: SupabaseRpcClient, interpreter: OpenAIInterpreterClient) -> bool:
    claimed = _first_row(rpc.rpc("claim_ai_interpretation_request", {"visibility_seconds": settings.visibility_seconds}))
    if claimed is None:
        return False
    message_id = int(claimed["message_id"]); request_id = str(claimed["interpretation_request_id"]); evidence = claimed.get("evidence_snapshot")
    if not isinstance(evidence, dict):
        rpc.rpc("finish_ai_interpretation_error", {"message_id": message_id, "interpretation_request_id": request_id, "processing_error": "Evidence snapshot was invalid.", "retryable": False, "max_attempts": 3}); raise RuntimeError("evidence snapshot was invalid")
    try:
        interpretation = interpreter.interpret(evidence)
        rpc.rpc("finish_ai_interpretation_success", {"message_id": message_id, "interpretation_request_id": request_id, "provider": interpreter.provider, "model": settings.model, "prompt_version": INTERPRETATION_PROMPT_VERSION, "policy_version": INTERPRETATION_POLICY_VERSION, "interpretation": interpretation})
        return True
    except ProviderHttpError as exc:
        rpc.rpc("finish_ai_interpretation_error", {"message_id": message_id, "interpretation_request_id": request_id, "processing_error": str(exc)[:1500], "retryable": exc.retryable, "max_attempts": 3}); raise
    except Exception as exc:
        rpc.rpc("finish_ai_interpretation_error", {"message_id": message_id, "interpretation_request_id": request_id, "processing_error": str(exc)[:1500], "retryable": False, "max_attempts": 3}); raise


def process_followup_once(settings: Settings, rpc: SupabaseRpcClient, followup: OpenAIEvidenceFollowupClient) -> bool:
    claimed = _first_row(rpc.rpc("claim_ai_evidence_followup_request", {"visibility_seconds": settings.visibility_seconds}))
    if claimed is None:
        return False
    message_id = int(claimed["message_id"]); request_id = str(claimed["followup_request_id"]); question = claimed.get("question"); evidence = claimed.get("evidence_snapshot")
    if not isinstance(question, str) or not isinstance(evidence, dict):
        rpc.rpc("finish_ai_evidence_followup_error", {"message_id": message_id, "followup_request_id": request_id, "processing_error": "Follow-up request payload was invalid.", "retryable": False, "max_attempts": 3}); raise RuntimeError("follow-up payload was invalid")
    try:
        answer = followup.answer(question, evidence)
        rpc.rpc("finish_ai_evidence_followup_success", {"message_id": message_id, "followup_request_id": request_id, "provider": followup.provider, "model": settings.model, "prompt_version": FOLLOWUP_PROMPT_VERSION, "policy_version": FOLLOWUP_POLICY_VERSION, "answer": answer})
        return True
    except ProviderHttpError as exc:
        rpc.rpc("finish_ai_evidence_followup_error", {"message_id": message_id, "followup_request_id": request_id, "processing_error": str(exc)[:1500], "retryable": exc.retryable, "max_attempts": 3}); raise
    except Exception as exc:
        rpc.rpc("finish_ai_evidence_followup_error", {"message_id": message_id, "followup_request_id": request_id, "processing_error": str(exc)[:1500], "retryable": False, "max_attempts": 3}); raise


def process_once(settings: Settings, rpc: SupabaseRpcClient, planner: OpenAIPlannerClient, interpreter: OpenAIInterpreterClient | None = None, followup: OpenAIEvidenceFollowupClient | None = None) -> bool:
    if process_plan_once(settings, rpc, planner): return True
    if process_interpretation_once(settings, rpc, interpreter or OpenAIInterpreterClient(settings)): return True
    return process_followup_once(settings, rpc, followup or OpenAIEvidenceFollowupClient(settings))


def run_forever(settings: Settings) -> None:
    rpc = SupabaseRpcClient(settings); planner = OpenAIPlannerClient(settings); interpreter = OpenAIInterpreterClient(settings); followup = OpenAIEvidenceFollowupClient(settings)
    while True:
        try: worked = process_once(settings, rpc, planner, interpreter, followup)
        except Exception as exc:
            print(f"AI worker iteration failed: {exc}", file=sys.stderr, flush=True); worked = True
        if not worked: time.sleep(settings.poll_seconds)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Genithm's permission-controlled AI planner, evidence interpreter, and grounded follow-up responder")
    parser.add_argument("--once", action="store_true", help="Process at most one queued AI request")
    args = parser.parse_args(); settings = Settings.from_env()
    if args.once:
        rpc = SupabaseRpcClient(settings); process_once(settings, rpc, OpenAIPlannerClient(settings), OpenAIInterpreterClient(settings), OpenAIEvidenceFollowupClient(settings)); return
    run_forever(settings)


if __name__ == "__main__": main()
