from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


class SupabaseGatewayError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True, slots=True)
class AuthenticatedUser:
    id: str
    access_token: str


class SupabaseGateway:
    def __init__(self, *, url: str, publishable_key: str, secret_key: str, timeout_seconds: float = 10.0) -> None:
        self.url = url.rstrip("/")
        self.publishable_key = publishable_key
        self.secret_key = secret_key
        self.timeout_seconds = timeout_seconds

    @staticmethod
    def _json_request(request: Request, *, timeout: float) -> Any:
        try:
            with urlopen(request, timeout=timeout) as response:
                raw = response.read(2 * 1024 * 1024 + 1)
        except HTTPError as exc:
            detail = exc.read(4096).decode("utf-8", "replace")
            if exc.code in {401, 403}:
                raise SupabaseGatewayError("authentication or authorization failed", status_code=exc.code) from exc
            raise SupabaseGatewayError(f"Supabase request failed with HTTP {exc.code}: {detail[:500]}") from exc
        except (URLError, TimeoutError) as exc:
            raise SupabaseGatewayError("Supabase connection failed") from exc
        if len(raw) > 2 * 1024 * 1024:
            raise SupabaseGatewayError("Supabase response exceeded size limit")
        if not raw:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise SupabaseGatewayError("Supabase returned invalid JSON") from exc

    @staticmethod
    def bearer_token(authorization: str | None) -> str:
        if not authorization:
            raise SupabaseGatewayError("authentication required", status_code=401)
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token.strip() or len(token) > 16384:
            raise SupabaseGatewayError("invalid authorization header", status_code=401)
        return token.strip()

    def authenticate(self, authorization: str | None) -> AuthenticatedUser:
        token = self.bearer_token(authorization)
        request = Request(
            f"{self.url}/auth/v1/user",
            headers={
                "apikey": self.publishable_key,
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "User-Agent": "genithm-storage-gateway/0.1",
            },
            method="GET",
        )
        payload = self._json_request(request, timeout=self.timeout_seconds)
        user_id = payload.get("id") if isinstance(payload, dict) else None
        if not isinstance(user_id, str) or not user_id:
            raise SupabaseGatewayError("invalid authenticated user response", status_code=401)
        return AuthenticatedUser(id=user_id, access_token=token)

    def user_rpc(self, user: AuthenticatedUser, name: str, payload: dict[str, Any]) -> Any:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        request = Request(
            f"{self.url}/rest/v1/rpc/{quote(name, safe='')}",
            data=body,
            headers={
                "apikey": self.publishable_key,
                "Authorization": f"Bearer {user.access_token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "genithm-storage-gateway/0.1",
            },
            method="POST",
        )
        return self._json_request(request, timeout=self.timeout_seconds)

    def user_upload(self, user: AuthenticatedUser, upload_id: str) -> dict[str, Any] | None:
        select = quote(
            "id,created_by,object_path,file_size_bytes,content_type,status,storage_provider,storage_bucket",
            safe=",",
        )
        request = Request(
            f"{self.url}/rest/v1/sequence_uploads?id=eq.{quote(upload_id, safe='')}&select={select}&limit=1",
            headers={
                "apikey": self.publishable_key,
                "Authorization": f"Bearer {user.access_token}",
                "Accept": "application/json",
                "User-Agent": "genithm-storage-gateway/0.1",
            },
            method="GET",
        )
        payload = self._json_request(request, timeout=self.timeout_seconds)
        if not isinstance(payload, list) or not payload:
            return None
        row = payload[0]
        return row if isinstance(row, dict) else None

    def service_rpc(self, name: str, payload: dict[str, Any]) -> Any:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        request = Request(
            f"{self.url}/rest/v1/rpc/{quote(name, safe='')}",
            data=body,
            headers={
                "apikey": self.secret_key,
                "Authorization": f"Bearer {self.secret_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "genithm-storage-gateway/0.1",
            },
            method="POST",
        )
        return self._json_request(request, timeout=self.timeout_seconds)
