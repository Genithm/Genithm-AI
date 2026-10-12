#!/usr/bin/env python3
"""Loopback-only Codespaces science service, never a public backend.

Uses the exact production sequence algorithms, no third-party dependencies,
no Supabase credentials, no persistence and no network egress.
"""
from __future__ import annotations

import json
import runpy
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = 8769
MAX_REQUEST_BYTES = 8192
ENGINE = runpy.run_path(str(Path(__file__).with_name("codespaces-live-science.py")))
COMPUTE = ENGINE["compute"]
SLOTS = threading.BoundedSemaphore(2)


class LabHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        # Do not log researcher-provided sequences or request bodies.
        pass

    def respond(self, status: int, payload: dict[str, object]) -> None:
        data = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self.respond(200, {"status": "ok", "mode": "local-development-only"})
        else:
            self.respond(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/analyze":
            self.respond(404, {"error": "not found"})
            return
        if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
            self.respond(415, {"error": "application/json is required"})
            return
        # Direct browser calls cannot supply an Origin; only server-side
        # loopback requests from the Next.js development route are accepted.
        if self.headers.get("Origin"):
            self.respond(403, {"error": "direct browser requests are not allowed"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if not 1 <= length <= MAX_REQUEST_BYTES:
            self.respond(413, {"error": "request exceeds allowed limit"})
            return
        if not SLOTS.acquire(blocking=False):
            self.respond(429, {"error": "Codespaces scientific engine is busy"})
            return
        try:
            raw = self.rfile.read(length)
            if len(raw) != length:
                self.respond(400, {"error": "incomplete request"})
                return
            payload = json.loads(raw.decode("utf-8"))
            result = COMPUTE(payload)
            self.respond(200, result)
        except (ValueError, UnicodeError, json.JSONDecodeError) as exc:
            self.respond(422, {"error": str(exc)})
        except Exception:
            self.respond(500, {"error": "local scientific computation failed"})
        finally:
            SLOTS.release()


def main() -> None:
    with ThreadingHTTPServer(("127.0.0.1", PORT), LabHandler) as server:
        server.serve_forever(poll_interval=0.5)


if __name__ == "__main__":
    main()
