"""Reproducible synthetic alignment benchmark; never reads research data.

Each implementation runs in a fresh subprocess. Peak RSS includes the Python
interpreter and imports. Timings are observations, not an enforced speed SLA.
"""
from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import os
import platform
import random
import resource
import subprocess
import sys
import time
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--length", type=int, default=2000)
    parser.add_argument("--child", choices=["reference", "optimized"])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not 1 <= args.length <= 3000:
        parser.error("Length must be 1-3000; never exceed approved DP cell bound")
    if args.child:
        from genithm_scientific_worker.pairwise import align
        from pairwise_reference import reference_align
        rng = random.Random(4101)
        a = "".join(rng.choices("ACGT", k=args.length))
        b = "".join(rng.choices("ACGT", k=args.length))
        fn = align if args.child == "optimized" else reference_align
        started = time.perf_counter()
        result = fn(a, b, algorithm="global", match_score=2, mismatch_score=-1, gap_score=-2)
        elapsed = time.perf_counter() - started
        digest = hashlib.sha256(json.dumps(dataclasses.asdict(result), sort_keys=True).encode()).hexdigest()
        print(json.dumps({"implementation": args.child, "seconds": elapsed,
                          "peak_process_rss_kib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                          "result_sha256": digest}))
        return 0
    rows = []
    for kind in ["reference", "optimized"]:
        result = subprocess.run([sys.executable, __file__, "--child", kind, "--length", str(args.length)],
                                text=True, capture_output=True, check=True, timeout=90, env=os.environ.copy())
        rows.append(json.loads(result.stdout))
    if rows[0]["result_sha256"] != rows[1]["result_sha256"]:
        raise RuntimeError("Alignment output changed: benchmark rejected")
    report = {"scope": "Synthetic global alignment, fresh subprocess for each implementation; not production load testing",
              "python": platform.python_version(), "platform": platform.platform(),
              "sequence_length": args.length, "dp_cells": args.length ** 2,
              "identical_output": True, "measurements": rows,
              "observed_speed_ratio": rows[0]["seconds"] / rows[1]["seconds"],
              "peak_process_memory_ratio": rows[0]["peak_process_rss_kib"] / rows[1]["peak_process_rss_kib"]}
    output = json.dumps(report, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output + "\n")
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
