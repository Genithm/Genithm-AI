# Science V6: production scientific integrity and reproducibility

**Scope:** actual scientific worker paths and portable post-run evidence.
This is not a Codespaces preview feature, a new scientific job type, a
database migration, or a production deployment.

## Why this gate exists

A SHA-256 checksum proves the object bytes retrieved match the value in
database provenance. It does **not** prove the record is DNA versus RNA,
the number of residues is correct, the sequence inputs are in the intended
order, or a result's reported identity/ORF counts agree with its evidence.

V6 validates both sides of that boundary:

1. **Input manifest:** claimed organization/project/job UUIDs, request
   fingerprint, input count, ascending 1-based positions, allowed
   nucleotide/protein types, 64-character SHA-256 digests, bounded object
   paths/sizes and declared biological residue counts.
2. **Decoded FASTA:** content length must equal the authoritative
   `residue_count`, every character must be consistent with the
   declared DNA/RNA/protein alphabet, and pairwise/MSA inputs must
   have compatible sequence types. The original SHA-256 download
   check remains in effect.
3. **Output evidence:** before uploading JSON or acknowledging job
   success, an independent validator checks deterministic JSON encoding,
   reported tool identity/fingerprint, summary/provenance equality,
   pairwise scores/identity/gaps, ORF/motif coordinates, translation
   reading frames, reverse-complement alphabet and protein composition
   and physicochemical bounds.
4. **Failure isolation:** an inconsistency results in the existing
   `finish_scientific_job_error` path; it cannot upload the bad
   artifact or mark the job successful. The original queued-job
   authorization, storage and project isolation policies remain
   responsible for access controls.

Existing MAFFT and FastTree methods already validate their non-JSON
results against normalized input records and source MSA provenance;
the new independent JSON auditor intentionally supports **pairwise
alignment, sequence insights and protein properties** only.

## Independent reproducibility check

The scientific-worker Python package now provides a command-line tool:

```sh
genithm-scientific-audit ./downloaded-result.json \
  --job-type sequence_insights \
  --sha256 TRUSTED_64_CHARACTER_RESULT_DIGEST
```

It returns a machine-readable object with `verified`, job type,
SHA-256, byte count and tool identity; failure returns exit status 2.

The optional expected SHA-256 must be obtained **independently from
trusted job metadata** (never from the artifact being inspected). Without
trusted metadata, the audit only confirms an internally consistent
canonical scientific result, not who produced it or who owns it. No
digital signature is claimed, and the tool never contacts external
services.

## Runtime and rollout compatibility

Scientific worker runtime identity: `genithm-scientific-worker/0.6.0`.
Scientific algorithms and their tool versions are **unchanged**. Existing
5 job types, finish RPC signatures and queue schema are unchanged.
Release and install the new worker through approved CI before switching
real workloads. This source merge alone does not deploy or apply any
production database migration.

## Regression coverage

Unit tests include clean artifacts, rehashed false evidence, incorrect
declared nucleotide types and residue counts, mixed-source alphabets,
duplicate or noncanonical positions, forged queue scope/fingerprint,
and fault-injected worker results. The latter must be rejected **before
storage upload** and must follow the existing explicit error RPC.

Run:

```sh
python -m pytest apps/scientific-worker/tests
python -m genithm_scientific_worker.artifact_audit --help
```

No Oracle, Codespaces preview, or production credentials are required
to validate this milestone.
