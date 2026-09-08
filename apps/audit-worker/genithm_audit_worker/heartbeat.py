from __future__ import annotations

import json
import logging
import os
import threading
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

LOGGER = logging.getLogger("genithm.worker-heartbeat")
DEFAULT_HEARTBEAT_SECONDS = 30.0


def start_worker_heartbeat(worker_kind: str, worker_version: str) -> threading.Event:
    url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    key = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
    interval = float(os.environ.get("GENITHM_WORKER_HEARTBEAT_SECONDS", DEFAULT_HEARTBEAT_SECONDS))
    if not url.startswith("https://") or not key or key.startswith("sb_publishable_"):
        raise RuntimeError("worker heartbeat requires SUPABASE_URL and a server-side SUPABASE_SECRET_KEY")
    if not 10 <= interval <= 120:
        raise RuntimeError("GENITHM_WORKER_HEARTBEAT_SECONDS must be between 10 and 120")
    stop = threading.Event()
    def run() -> None:
        payload = json.dumps({"worker_kind": worker_kind, "worker_version": worker_version}, separators=(",", ":")).encode("utf-8")
        while not stop.is_set():
            request = Request(f"{url}/rest/v1/rpc/record_worker_heartbeat", data=payload, method="POST", headers={"apikey": key, "Content-Type": "application/json", "Accept": "application/json", "User-Agent": worker_version})
            try:
                with urlopen(request, timeout=15) as response:
                    response.read(1024)
            except (HTTPError, URLError, TimeoutError, OSError) as exc:
                LOGGER.warning("worker heartbeat failed kind=%s error_type=%s", worker_kind, type(exc).__name__)
            stop.wait(interval)
    threading.Thread(target=run, name=f"{worker_kind}-heartbeat", daemon=True).start()
    return stop
