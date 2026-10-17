# Genithm V41: desktop research and scientific execution capacity

This iteration preserves the approved light interface and invests in the
existing server-side scientific execution path. It does not introduce a new
browser-only lab or pretend to implement RNA-seq/whole-genome pipelines.

## Desktop workspace policy

Phones and tablets identified by the standard mobile client hint, platform
hint, or mobile user-agent signatures receive `/desktop-required` instead of
login/signup, the research dashboard, or the sample preview. The notice does
not provide a mobile workspace. Desktop computers, including touch laptops,
can still resize windows or zoom for accessibility.

Device identification is best-effort and can be spoofed. This is a product
support policy, NOT an authentication control: existing session validation,
row-level security, API authentication and scientific approval remain intact.
Auth callbacks, sign-out, public pages and machine API clients remain supported.
No secret or return-to query string is forwarded to the desktop notice.

## Exact, lower-memory server-side alignment

The trusted pairwise executor now keeps two score rows and one byte per
traceback cell instead of full Python-object score and traceback matrices.
Global/local scores, diagonal/up/left tie ordering, first row-major local
optimum, aligned strings and canonical result bytes are unchanged. The
nine-million-cell bound is deliberately retained; this is not a whole-genome
aligner. No database tool-version, algorithm, or result-format migration is
needed. Runtime worker version is 0.7.0; scientific algorithm identities remain
unchanged because exhaustive/reference parity is required.

Validation includes 7,200 exhaustive short-sequence cases, 500 deterministic
random DNA/protein cases, byte-identical result/provenance comparison,
independent pre-upload output validation and a measured allocation test.
`tests/benchmark_pairwise.py` benchmarks a synthetic 3,000 by 3,000 global
alignment in separate subprocesses, compares output SHA-256 and records time
and peak whole-process RSS. These observations are not production SLAs.

## Controlled parallel background processing

`GENITHM_SCIENTIFIC_CONCURRENCY=1` remains the conservative default.
An operator can explicitly provision 2-4 independent processes to consume
approved scientific jobs from the existing transactional queue. This uses
real processes, not browser threads, and does not increase a tenant's
permissions, quota, accepted input limits, or authority to approve analyses.
Each process owns its HTTP client and uses the original claim/download/audit/
upload/finish flow. Work is NOT pre-fetched into an in-memory batch.

`--once` still processes at most one job. For continuous workers, SIGTERM/SIGINT
stop new claims and allow active work to drain within the configured visibility
period. The Codespaces and Kubernetes defaults allow 330 seconds to drain the
normal 300-second worker window. Unexpected child failure is visible and
stops the pool; an ambiguous RPC commit is not blindly repeated. Worker
heartbeats stop when the supervisor exits. This does not solve recovery of
already-abandoned jobs after host failure: those need an independently fenced
recovery protocol before they can be safely replayed.

Raising concurrency is optional and consumes existing provisioned CPU/RAM;
it does not create machines or increase cloud capacity. Keep one slot on a
small shared development machine. Provision/test adequate memory and CPU
before increasing it. Native scientific tool resource and timeout bounds
are retained.

## Delivery and activation

The V1 coordinated candidate generation advances so the existing release
pipeline can publish matching API and all six worker images after main CI
passes. The release tooling contract is synchronized with the already-audited
Wrangler version 4.151.1. Do not start a new candidate until all required images
are published; the launcher deliberately fails closed if they are missing.

After publication, the existing full preview launcher installs the new image:

```bash
git pull --ff-only
bash scripts/codespaces_preview.sh
```

A properly provisioned operator may opt into parallel execution:

```bash
GENITHM_SCIENTIFIC_CONCURRENCY=2 bash scripts/codespaces_preview.sh
```

Merging source or publishing images does not restart an already-running
Codespace. No live database data or security policies are modified by V41.

## Reproducible checks

```bash
PYTHONPATH=apps/scientific-worker pytest -q apps/scientific-worker/tests
PYTHONPATH=apps/scientific-worker python apps/scientific-worker/tests/benchmark_pairwise.py --length 3000
node --experimental-strip-types --test apps/web/tests/desktop-workspace-v41.test.mjs
```

A two-consumer integration fixture uses the actual execution, input hashing,
alignment, output auditing, upload and result commit code against a loopback
RPC/storage server. It waits for two distinct claims before allowing downloads,
so a sequential runner cannot satisfy that test. It is not a live Supabase
row-level-security test or a production load test. Browser tests use genuine
mobile browser identifiers to check the desktop-only policy; desktop resizing
checks remain as accessibility tests, not mobile product support.
