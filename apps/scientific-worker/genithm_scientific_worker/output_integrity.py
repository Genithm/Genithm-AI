from __future__ import annotations

"""Independent pre-upload audit for FASTA MSA and Newick phylogenies.

An audit proves internal consistency with the separately supplied queue
claim/provenance. It does not prove tree topology or input authenticity
without separately trusted database and input evidence.
"""

import hashlib
from typing import Any

from .artifact_audit import audit_json_artifact
from .input_integrity import ALPHABETS, SHA
from .phylogeny import parse_newick, validate_alignment
from .source_scope import validate_phylogeny_source


class ScientificOutputIntegrityError(ValueError):
    pass


def _check(test: bool, description: str) -> None:
    if not test:
        raise ScientificOutputIntegrityError(description)


def audit_scientific_output(
    data: bytes, job: dict[str, Any],
    summary: dict[str, Any], provenance: dict[str, Any],
) -> dict[str, Any]:
    """Verify exactly what the worker will upload/acknowledge."""
    kind = job.get("job_type")
    _check(isinstance(data, bytes) and bool(data), "scientific artifact is empty or invalid")
    _check(isinstance(summary, dict) and isinstance(provenance, dict),
           "scientific result metadata is invalid")
    _check(summary.get("job_type") == kind, "scientific result type mismatch")
    _check(provenance.get("tool_id") == job.get("tool_id") and
           provenance.get("tool_version") == job.get("tool_version") and
           provenance.get("request_fingerprint") == job.get("request_fingerprint"),
           "scientific result tool or request provenance mismatch")

    if kind in {"pairwise_alignment", "sequence_insights", "protein_properties"}:
        return audit_json_artifact(
            data, expected_job_type=kind, expected_summary=summary,
            expected_provenance=provenance,
        )

    if kind == "multiple_sequence_alignment":
        inputs = job.get("inputs")
        _check(isinstance(inputs, list) and 3 <= len(inputs) <= 50,
               "MSA output has an invalid number of source inputs")
        _check(all(isinstance(item, dict) for item in inputs),
               "MSA source input provenance is malformed")
        types = {item.get("sequence_type") for item in inputs}
        _check(len(types) == 1 and next(iter(types)) in ALPHABETS,
               "MSA output source types are inconsistent")
        sequence_type = next(iter(types))
        count = len(inputs)
        _check(summary.get("sequence_count") == count and
               summary.get("strategy") == "auto" and
               summary.get("input_sha256s") == [item.get("sha256") for item in inputs],
               "MSA result summary does not match queued inputs")
        _check(all(isinstance(item.get("sha256"), str) and
                   SHA.fullmatch(item["sha256"]) is not None for item in inputs),
               "MSA input digests are malformed")
        _check(provenance.get("parameters") == job.get("parameters") and
               provenance.get("inputs") == [
                   {"position": item.get("position"), "role": item.get("role"),
                    "sha256": item.get("sha256")} for item in inputs
               ], "MSA output provenance does not match claimed inputs")
        # The normalized parser enforces all input identifiers exactly once,
        # correct lengths and strict canonical FASTA sequence ordering.
        normalized = validate_alignment(data, count)
        _check(normalized == data, "MSA output is not canonical ordered FASTA")
        seqs = [line for line in data.decode("ascii").splitlines()
                if line and not line.startswith(">")]
        _check(len(seqs) == count and
               len(seqs[0]) == summary.get("aligned_length"),
               "MSA output aligned length differs from summary")
        alphabet = ALPHABETS[sequence_type] | frozenset("-.")
        _check(all(set(seq) <= alphabet and any(c not in "-." for c in seq)
                   for seq in seqs),
               "MSA output contains invalid or empty biological sequences")

    elif kind == "phylogenetic_tree":
        path, size, source_sha, source_id, count, seq_type = validate_phylogeny_source(job)
        normalized, metrics = parse_newick(data, count)
        _check(normalized == data, "phylogeny output is not canonical Newick")
        model = "gtr_cat" if seq_type in {"dna", "rna"} else "jtt_cat"
        _check(summary.get("leaf_count") == metrics.leaf_count and
               summary.get("internal_support_count") == metrics.internal_support_count and
               summary.get("model") == model and
               summary.get("source_msa_job_id") == source_id and
               summary.get("source_msa_sha256") == source_sha,
               "phylogeny results disagree with Newick evidence or source")
        _check(provenance.get("model") == model and
               provenance.get("source_msa_job_id") == source_id and
               provenance.get("source_msa_sha256") == source_sha and
               provenance.get("source_msa_object_path") == path,
               "phylogeny provenance does not match its source MSA")
    else:
        raise ScientificOutputIntegrityError("unapproved scientific output type")
    return {
        "verified": True,
        "job_type": kind,
        "sha256": hashlib.sha256(data).hexdigest(),
        "bytes": len(data),
        "tool_id": provenance["tool_id"],
        "tool_version": provenance["tool_version"],
    }
