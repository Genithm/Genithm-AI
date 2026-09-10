from __future__ import annotations

import argparse
import json
import os
import sys
import time
import uuid
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class Config:
    supabase_url: str
    publishable_key: str
    api_base_url: str
    email: str
    password: str
    timeout_seconds: float
    poll_seconds: float
    max_wait_seconds: float


class E2EError(RuntimeError):
    pass


def _clean_https_origin(value: str, label: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise E2EError(f"{label} must be a clean HTTPS origin")
    return value.rstrip("/")


def _json_request(url: str, *, method: str = "GET", headers: dict[str, str] | None = None, payload: Any = None, timeout: float = 10) -> tuple[int, Any]:
    body = None if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request_headers = {"Accept": "application/json", "User-Agent": "genithm-production-e2e/1.0", **(headers or {})}
    if body is not None:
        request_headers["Content-Type"] = "application/json"
    request = Request(url, data=body, method=method, headers=request_headers)
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw) if raw else None
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            detail = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            detail = raw[:500]
        raise E2EError(f"HTTP {exc.code} from {url}: {detail}") from exc
    except (URLError, TimeoutError) as exc:
        raise E2EError(f"request failed for {url}: {type(exc).__name__}") from exc


def _raw_request(url: str, *, method: str, headers: dict[str, str], body: bytes, timeout: float) -> int:
    request = Request(url, data=body, method=method, headers={"User-Agent": "genithm-production-e2e/1.0", **headers})
    try:
        with urlopen(request, timeout=timeout) as response:
            return response.status
    except HTTPError as exc:
        raise E2EError(f"object upload failed with HTTP {exc.code}") from exc
    except (URLError, TimeoutError) as exc:
        raise E2EError(f"object upload request failed: {type(exc).__name__}") from exc


def _auth_headers(config: Config, access_token: str) -> dict[str, str]:
    return {"apikey": config.publishable_key, "Authorization": f"Bearer {access_token}"}


def _login(config: Config) -> tuple[str, str]:
    status, payload = _json_request(
        f"{config.supabase_url}/auth/v1/token?grant_type=password",
        method="POST",
        headers={"apikey": config.publishable_key},
        payload={"email": config.email, "password": config.password},
        timeout=config.timeout_seconds,
    )
    if status != 200 or not isinstance(payload, dict):
        raise E2EError("test-user authentication failed")
    access_token = payload.get("access_token")
    user = payload.get("user")
    user_id = user.get("id") if isinstance(user, dict) else None
    if not isinstance(access_token, str) or not isinstance(user_id, str):
        raise E2EError("authentication response missing token or user id")
    return access_token, user_id


def _rpc(config: Config, access_token: str, function: str, payload: dict[str, Any]) -> Any:
    _, response = _json_request(
        f"{config.supabase_url}/rest/v1/rpc/{function}",
        method="POST",
        headers=_auth_headers(config, access_token),
        payload=payload,
        timeout=config.timeout_seconds,
    )
    return response


def _insert(config: Config, access_token: str, table: str, payload: dict[str, Any]) -> dict[str, Any]:
    _, response = _json_request(
        f"{config.supabase_url}/rest/v1/{table}",
        method="POST",
        headers={**_auth_headers(config, access_token), "Prefer": "return=representation"},
        payload=payload,
        timeout=config.timeout_seconds,
    )
    if not isinstance(response, list) or len(response) != 1 or not isinstance(response[0], dict):
        raise E2EError(f"unexpected insert response from {table}")
    return response[0]


def _select_one(config: Config, access_token: str, table: str, filters: dict[str, str], columns: str = "*") -> dict[str, Any] | None:
    query = {"select": columns, **{key: f"eq.{value}" for key, value in filters.items()}, "limit": "1"}
    _, response = _json_request(
        f"{config.supabase_url}/rest/v1/{table}?{urlencode(query)}",
        headers=_auth_headers(config, access_token),
        timeout=config.timeout_seconds,
    )
    if not isinstance(response, list):
        raise E2EError(f"unexpected select response from {table}")
    if not response:
        return None
    if not isinstance(response[0], dict):
        raise E2EError(f"invalid row response from {table}")
    return response[0]


def _wait_for(config: Config, description: str, probe) -> dict[str, Any]:
    deadline = time.monotonic() + config.max_wait_seconds
    last: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        last = probe()
        if last is not None:
            return last
        time.sleep(config.poll_seconds)
    raise E2EError(f"timed out waiting for {description}; last={last}")


def _reserve_and_upload(config: Config, access_token: str, project_id: str, filename: str, fasta: bytes) -> str:
    _, reservation = _json_request(
        f"{config.api_base_url}/api/v1/storage/sequence-uploads",
        method="POST",
        headers={"Authorization": f"Bearer {access_token}"},
        payload={
            "project_id": project_id,
            "original_filename": filename,
            "file_size_bytes": len(fasta),
            "content_type": "text/plain",
        },
        timeout=config.timeout_seconds,
    )
    if not isinstance(reservation, dict):
        raise E2EError("invalid upload reservation response")
    upload_id = reservation.get("upload_id")
    upload_url = reservation.get("upload_url")
    required_headers = reservation.get("required_headers")
    if not isinstance(upload_id, str) or not isinstance(upload_url, str) or not isinstance(required_headers, dict):
        raise E2EError("upload reservation missing required fields")
    if _raw_request(upload_url, method="PUT", headers={str(k): str(v) for k, v in required_headers.items()}, body=fasta, timeout=config.timeout_seconds) not in {200, 201, 204}:
        raise E2EError("R2 upload did not return a success status")
    _, completion = _json_request(
        f"{config.api_base_url}/api/v1/storage/sequence-uploads/{upload_id}/complete",
        method="POST",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=config.timeout_seconds,
    )
    if not isinstance(completion, dict) or completion.get("status") != "pending_validation":
        raise E2EError(f"unexpected upload completion state: {completion}")
    return upload_id


def run(config: Config) -> None:
    access_token, user_id = _login(config)
    suffix = uuid.uuid4().hex[:10]
    org_name = f"Genithm E2E {suffix}"
    org_slug = f"genithm-e2e-{suffix}"

    organization = _rpc(config, access_token, "create_organization", {"org_name": org_name, "org_slug": org_slug})
    if not isinstance(organization, dict) or not isinstance(organization.get("id"), str):
        raise E2EError("organization RPC did not return an organization")
    organization_id = organization["id"]

    project = _insert(
        config,
        access_token,
        "projects",
        {
            "organization_id": organization_id,
            "name": f"Production E2E {suffix}",
            "description": "Automated production release validation project",
            "status": "active",
            "created_by": user_id,
        },
    )
    project_id = str(project["id"])

    sequence_a = b">e2e_a\nACGTACGTACGTACGT\n"
    sequence_b = b">e2e_b\nACGTACGTTCGTACGT\n"
    upload_a = _reserve_and_upload(config, access_token, project_id, "e2e-a.fasta", sequence_a)
    upload_b = _reserve_and_upload(config, access_token, project_id, "e2e-b.fasta", sequence_b)

    for upload_id in (upload_a, upload_b):
        row = _wait_for(
            config,
            f"sequence upload {upload_id} validation",
            lambda upload_id=upload_id: (
                lambda current: current if current and current.get("status") == "ready" else (
                    (_ for _ in ()).throw(E2EError(f"sequence validation failed: {current}"))
                    if current and current.get("status") in {"rejected", "error"}
                    else None
                )
            )(_select_one(config, access_token, "sequence_uploads", {"id": upload_id}, "id,status,sha256,sequence_type,sequence_count,residue_count,validator_version")),
        )
        if row.get("sequence_count") != 1 or not row.get("sha256") or not row.get("validator_version"):
            raise E2EError(f"validated upload lacks scientific provenance: {row}")

    job_id = _rpc(
        config,
        access_token,
        "request_pairwise_alignment",
        {
            "project_id": project_id,
            "sequence_a_id": upload_a,
            "sequence_b_id": upload_b,
            "algorithm": "global",
            "match_score": 2,
            "mismatch_score": -1,
            "gap_score": -2,
        },
    )
    if not isinstance(job_id, str):
        raise E2EError(f"pairwise alignment RPC returned invalid job id: {job_id}")

    job = _wait_for(
        config,
        f"scientific job {job_id}",
        lambda: (
            lambda current: current if current and current.get("status") == "completed" else (
                (_ for _ in ()).throw(E2EError(f"scientific job failed: {current}"))
                if current and current.get("status") in {"failed", "error", "cancelled"}
                else None
            )
        )(_select_one(config, access_token, "scientific_jobs", {"id": job_id}, "id,status,job_type,tool_id,tool_version,executor_version,result_sha256,result_bytes,result_summary,provenance,processing_error")),
    )
    if job.get("job_type") != "pairwise_alignment" or not job.get("result_sha256") or not job.get("tool_version") or not job.get("executor_version"):
        raise E2EError(f"completed scientific job lacks required provenance: {job}")
    summary = job.get("result_summary")
    if not isinstance(summary, dict) or "identity_percent" not in summary or "score" not in summary:
        raise E2EError(f"pairwise result summary is incomplete: {summary}")
    provenance = job.get("provenance")
    if not isinstance(provenance, dict):
        raise E2EError("pairwise job provenance is missing")

    print(f"[PASS] authenticated test user: {config.email}")
    print(f"[PASS] organization/project isolation: {organization_id}/{project_id}")
    print(f"[PASS] R2 upload + deterministic validation: {upload_a}, {upload_b}")
    print(f"[PASS] pairwise scientific execution + provenance: {job_id}")
    print("Production scientific E2E passed.")


def _config_from_env(args: argparse.Namespace) -> Config:
    required = {
        "GENITHM_E2E_SUPABASE_URL": os.environ.get("GENITHM_E2E_SUPABASE_URL"),
        "GENITHM_E2E_SUPABASE_PUBLISHABLE_KEY": os.environ.get("GENITHM_E2E_SUPABASE_PUBLISHABLE_KEY"),
        "GENITHM_E2E_API_BASE_URL": os.environ.get("GENITHM_E2E_API_BASE_URL"),
        "GENITHM_E2E_EMAIL": os.environ.get("GENITHM_E2E_EMAIL"),
        "GENITHM_E2E_PASSWORD": os.environ.get("GENITHM_E2E_PASSWORD"),
    }
    missing = [key for key, value in required.items() if not value]
    if missing:
        raise E2EError("missing required runtime environment: " + ", ".join(sorted(missing)))
    return Config(
        supabase_url=_clean_https_origin(str(required["GENITHM_E2E_SUPABASE_URL"]), "Supabase URL"),
        publishable_key=str(required["GENITHM_E2E_SUPABASE_PUBLISHABLE_KEY"]),
        api_base_url=_clean_https_origin(str(required["GENITHM_E2E_API_BASE_URL"]), "API URL"),
        email=str(required["GENITHM_E2E_EMAIL"]),
        password=str(required["GENITHM_E2E_PASSWORD"]),
        timeout_seconds=args.timeout_seconds,
        poll_seconds=args.poll_seconds,
        max_wait_seconds=args.max_wait_seconds,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Genithm production scientific E2E validation using a dedicated test user.")
    parser.add_argument("--timeout-seconds", type=float, default=10.0)
    parser.add_argument("--poll-seconds", type=float, default=2.0)
    parser.add_argument("--max-wait-seconds", type=float, default=180.0)
    args = parser.parse_args()
    if not 0.5 <= args.timeout_seconds <= 30 or not 0.5 <= args.poll_seconds <= 30 or not 10 <= args.max_wait_seconds <= 900:
        print("invalid timing arguments", file=sys.stderr)
        return 2
    try:
        run(_config_from_env(args))
    except E2EError as exc:
        print(f"Production scientific E2E failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
