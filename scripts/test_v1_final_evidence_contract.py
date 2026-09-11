import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "scripts/validate_v1_final_evidence.py"
EXAMPLE = ROOT / "release/v1/final-evidence.example.json"
SHA = "1" * 40


def run_evidence(data: dict) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "evidence.json"
        path.write_text(json.dumps(data), encoding="utf-8")
        return subprocess.run(
            [sys.executable, str(VALIDATOR), "--evidence", str(path), "--expected-source-sha", SHA],
            text=True,
            capture_output=True,
            check=False,
        )


def main() -> int:
    data = json.loads(EXAMPLE.read_text(encoding="utf-8"))
    data["source_sha"] = SHA
    for key in data["evidence_refs"]:
        data["evidence_refs"][key] = f"evidence:{key}"

    ok = run_evidence(data)
    assert ok.returncode == 0, ok.stderr

    bad = json.loads(json.dumps(data))
    bad["checks"]["scientific_e2e"] = False
    failed = run_evidence(bad)
    assert failed.returncode != 0
    assert "scientific_e2e" in failed.stderr

    bad = json.loads(json.dumps(data))
    bad["readiness"]["healthy_workers"] = 5
    failed = run_evidence(bad)
    assert failed.returncode != 0
    assert "healthy_workers" in failed.stderr

    bad = json.loads(json.dumps(data))
    bad["evidence_refs"]["rollback_drill"] = ""
    failed = run_evidence(bad)
    assert failed.returncode != 0
    assert "rollback_drill" in failed.stderr

    print("PASS: V1 final release evidence contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
