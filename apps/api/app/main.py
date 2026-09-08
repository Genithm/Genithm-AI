import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import Response

from .settings import get_settings

settings = get_settings()

app = FastAPI(
    title="Genithm API",
    version="0.1.0",
    docs_url="/docs" if settings.environment != "production" else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Cache-Control"] = "no-store" if request.url.path.startswith("/api/") else "no-cache"
        return response


app.add_middleware(SecurityHeadersMiddleware)


@app.get("/api/v1/health", tags=["operations"])
def health() -> dict[str, str]:
    return {"status": "ok", "service": "genithm-api"}


def _fetch_release_readiness() -> dict[str, object]:
    if not settings.supabase_readiness_configured:
        if settings.environment == "production":
            return {"status": "not_ready", "reason": "supabase_readiness_not_configured"}
        return {"status": "ready", "dependency_check": "skipped_not_configured"}

    assert settings.supabase_url is not None
    assert settings.supabase_secret_key is not None
    request = Request(
        f"{settings.supabase_url.rstrip('/')}/rest/v1/rpc/get_release_readiness",
        data=b"{}",
        method="POST",
        headers={
            "apikey": settings.supabase_secret_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "genithm-api-readiness/1.0",
        },
    )

    try:
        with urlopen(request, timeout=settings.readiness_timeout_seconds) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError):
        return {"status": "not_ready", "reason": "supabase_readiness_check_failed"}

    if not isinstance(payload, dict):
        return {"status": "not_ready", "reason": "supabase_readiness_invalid_response"}
    return payload


@app.get("/api/v1/ready", tags=["operations"])
def ready() -> Response:
    readiness = _fetch_release_readiness()
    status = readiness.get("status")
    http_status = 200 if status == "ready" else 503
    return JSONResponse(status_code=http_status, content=readiness)
