"""V68 Compose contract: actual Docker Compose parsing and security assertions.

No secret values, URLs, uploaded data or provider credentials are logged.
The operator-supplied env file can contain only placeholders during this test.
"""
from __future__ import annotations
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ROOT / "deploy" / "large-data" / "compose.worker.yml"
API_DOCKERFILE = ROOT / "apps" / "api" / "Dockerfile"

def main():
    if not COMPOSE.is_file() or not API_DOCKERFILE.is_file():
        raise SystemExit("Missing private-worker compose contract")
    # Never source an untrusted envfile. Docker Compose only parses its values.
    if not os.environ.get("GENITHM_LARGE_DATA_WORKER_ENV"):
        raise SystemExit("Set GENITHM_LARGE_DATA_WORKER_ENV to a dummy CI envfile.")
    cmd = ["docker", "compose", "-f", str(COMPOSE), "--profile", "paired",
           "config", "--format", "json"]
    result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, check=False)
    if result.returncode:
        raise SystemExit("Docker Compose worker configuration is invalid (details omitted to avoid leaking env).")
    try:
        services = json.loads(result.stdout)["services"]
    except (ValueError, KeyError, TypeError):
        raise SystemExit("Worker compose JSON contract could not be parsed.") from None
    assert set(services)=={"verifier","pair-verifier"}, "Only two opt-in workers are permitted"
    for name, module in (("verifier","app.large_data.worker"),
                         ("pair-verifier","app.large_data.pair_worker")):
        item = services[name]
        assert item["entrypoint"]==["python","-m",module], name
        assert item.get("read_only") is True, name
        assert item.get("restart")=="unless-stopped", name
        assert item.get("init") is True, name
        assert item.get("cap_drop")==["ALL"], name
        assert "no-new-privileges:true" in item.get("security_opt",[]), name
        assert item.get("pids_limit") == 128, name
        assert item.get("mem_limit") == 1024**3, name
        assert item.get("ports") in (None,[]), "Private workers must not expose ports"
        assert item.get("volumes") in (None,[]), "No host filesystem or secrets mounts"
        assert item.get("privileged") in (None,False), name
        assert item.get("network_mode") not in ("host","service:host"), name
        assert item.get("environment",{}).get("GENITHM_LARGE_DATA_ENABLED")=="true", name
        assert not any(str(k).startswith("NEXT_PUBLIC_") for k in item.get("environment",{})), name
    assert services["pair-verifier"].get("profiles")==["paired"]
    assert services["pair-verifier"]["environment"]["GENITHM_LARGE_DATA_PAIRING_ENABLED"]=="true"
    assert "USER genithm" in API_DOCKERFILE.read_text()
    print("V68 private verifier and optional pair worker configuration: validated")

if __name__ == "__main__":
    main()
