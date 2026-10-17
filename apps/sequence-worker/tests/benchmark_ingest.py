"""Reproducible synthetic FASTA benchmark: old three-pass path vs streaming.

Fresh subprocesses, identical on-disk input, identical serialized result required.
CPU time and RSS observations are evidence, not a promise of production latency.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict
import hashlib
import json
from pathlib import Path
import resource
import subprocess
import sys
import tempfile
import time


def child(path: Path, mode: str) -> dict:
    from genithm_sequence_worker.validator import validate_fasta_bytes
    from genithm_sequence_worker.statistics import calculate_sequence_statistics
    from genithm_sequence_worker.streaming import analyze_fasta_stream
    started = time.perf_counter()
    if mode == "legacy":
        data = path.read_bytes()
        validation = validate_fasta_bytes(data)
        stats = calculate_sequence_statistics(data)
    else:
        with path.open("rb") as stream:
            validation, stats = analyze_fasta_stream(stream, expected_size=path.stat().st_size)
    elapsed = time.perf_counter() - started
    payload = json.dumps(
        {"validation": asdict(validation), "statistics": stats.to_payload()},
        sort_keys=True, separators=(",", ":"),
    ).encode()
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if sys.platform == "darwin":
        rss //= 1024
    return {
        "implementation": mode, "elapsed_seconds": elapsed,
        "peak_process_rss_kib": rss, "file_bytes": path.stat().st_size,
        "records": validation.sequence_count, "residues": validation.residue_count,
        "source_sha256": validation.sha256,
        "result_sha256": hashlib.sha256(payload).hexdigest(),
    }


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--child", choices=["legacy", "streaming"])
    p.add_argument("--input", type=Path)
    p.add_argument("--mib", type=int, default=16)
    p.add_argument("--unwrapped", action="store_true")
    args = p.parse_args()
    if args.child:
        print(json.dumps(child(args.input, args.child)))
        return
    if not 1 <= args.mib <= 48:
        p.error("--mib must be 1..48 to stay within the actual worker limit")
    with tempfile.TemporaryDirectory(prefix="genithm-synthetic-ingest-") as temp:
        source = Path(temp) / "synthetic.fasta"
        line = b"ACGTN" * (13107 if args.unwrapped else 16)
        with source.open("wb") as f:
            f.write(b">synthetic-FASTA-benchmark-not-biological-evidence\n")
            while f.tell() + len(line) + 1 < args.mib * 1024 * 1024:
                f.write(line)
                if not args.unwrapped:
                    f.write(b"\n")
            f.write(b"\n")
        measurements = []
        for mode in ["legacy", "streaming"]:
            result = subprocess.run(
                [sys.executable, __file__, "--child", mode, "--input", str(source)],
                capture_output=True, text=True, check=True, timeout=120,
            )
            measurements.append(json.loads(result.stdout))
        a, b = measurements
        assert a["source_sha256"] == b["source_sha256"]
        assert a["result_sha256"] == b["result_sha256"], "Numerical result drift"
        print(json.dumps({
            "schema": "genithm-ingest-benchmark/1", "python": sys.version,
            "platform": sys.platform, "synthetic": True,
            "case": "unwrapped" if args.unwrapped else "80-residue-lines",
            "measurements": measurements,
            "result_identical": True,
            "observed_speedup": a["elapsed_seconds"] / b["elapsed_seconds"],
            "observed_rss_reduction_percent": 100 * (1 - b["peak_process_rss_kib"] / a["peak_process_rss_kib"]),
            "limitations": "One synthetic file, one host, warm filesystem cache; not network or production end-to-end latency.",
        }, indent=2))


if __name__ == "__main__":
    main()
