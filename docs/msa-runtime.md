# Multiple Sequence Alignment V1

Genithm MSA V1 runs through the generalized scientific job engine. The API/database request path validates tenancy, input integrity metadata, compute bounds, rate limits, and approved tool/version before a durable queue message is created.

## Approved executor

- Tool: MAFFT
- Tool registry version: `7.505-1`
- Debian stable package: `mafft=7.505-1` in the pinned `python:3.13.15-slim-trixie` worker image
- Strategy: `--auto`
- Threads: `1`
- Network access required by the scientific computation: no
- Worker executor: `genithm-scientific-worker/0.2.0`

The worker invokes MAFFT using a fixed argument vector with `shell=False`; no user-controlled command fragments are accepted.

## V1 bounds

- 3 to 50 inputs
- unique input upload IDs
- same project and organization
- validated `ready` inputs only
- one FASTA record per input
- same validated sequence type across all inputs
- no pre-existing gaps
- maximum 20,000 residues per input
- maximum 100,000 total residues
- maximum 2 MiB source object per input
- MSA request limit: 10/hour/user and 40/hour/organization
- generalized active scientific concurrency limit still applies

## Integrity and provenance

The worker re-downloads every input from private storage and checks exact byte size plus SHA-256 before execution. Internal stable identifiers (`seq1`, `seq2`, ...) are used instead of user-controlled FASTA headers.

MAFFT output is rejected unless:

- record count equals input count;
- all expected internal identifiers occur exactly once;
- all aligned records have the same non-zero length;
- removing alignment gaps from each result reproduces the corresponding original input sequence exactly.

The normalized FASTA artifact is stored under the deterministic private path:

`<organization>/<project>/<job>/msa-result.fasta`

Result finalization verifies job type, ordered input SHA-256 list, tool/version, executor version, request fingerprint, strategy, sequence count, aligned length, artifact path, artifact presence, result size, and result SHA-256 metadata.

The result path is non-overwriting. On a retry after an earlier upload, the worker accepts the existing object only if its bytes hash to the exact expected deterministic output.

## Deployment status

The MSA runtime is code/container ready but is not considered continuously live until the scientific worker is deployed with its server-side Supabase secret through a deployment secret manager. No service key belongs in the repository or frontend.
