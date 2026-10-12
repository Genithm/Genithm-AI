from __future__ import annotations

import hashlib
import json
from copy import deepcopy

import pytest

from genithm_scientific_worker.artifact_audit import (
    ScientificArtifactAuditError,
    audit_json_artifact,
)
from genithm_scientific_worker.runtime import canonical_pairwise_result
from genithm_scientific_worker.runtime_v4 import canonical_protein_result
from genithm_scientific_worker.sequence_insights import (
    SequenceInput,
    canonical_sequence_insights_result,
)

SHA_A, SHA_B, FINGERPRINT = "a" * 64, "b" * 64, "f" * 64


def artifact_bytes(payload: object) -> bytes:
    return json.dumps(payload, separators=(",", ":"), sort_keys=True, ensure_ascii=True).encode()


def pairwise_evidence():
    return canonical_pairwise_result({
        "parameters": {"algorithm": "global", "match_score": 2,
                       "mismatch_score": -1, "gap_score": -2},
        "request_fingerprint": FINGERPRINT,
        "inputs": [
            {"position": 1, "role": "sequence_a", "sha256": SHA_A},
            {"position": 2, "role": "sequence_b", "sha256": SHA_B},
        ],
    }, "ACGTT", "ACGCT")


def sequence_evidence(operation: str = "orf_scan"):
    return canonical_sequence_insights_result({
        "tool_id": "genithm-sequence-insights",
        "tool_version": "0.1.0",
        "parameters": {
            "operation": operation,
            "motif": "AAA" if operation == "motif_scan" else None,
            "min_aa": 2 if operation == "orf_scan" else 30,
        },
        "request_fingerprint": FINGERPRINT,
        "inputs": [{"position": 1, "role": "nucleotide_sequence",
                    "sha256": SHA_A, "sequence_type": "dna"}],
    }, SequenceInput("ATGAAATAA", "dna"))


def protein_evidence():
    return canonical_protein_result({
        "parameters": {"alphabet": "canonical_20_amino_acids"},
        "request_fingerprint": FINGERPRINT,
        "inputs": [{"sha256": SHA_A}],
    }, "ACDEFGHIKLMNPQRSTVWY")


@pytest.mark.parametrize("factory,job_type", [
    (pairwise_evidence,"pairwise_alignment"),
    (protein_evidence,"protein_properties"),
    (sequence_evidence,"sequence_insights"),
])
def test_valid_scientific_artifacts_pass_independent_audit(factory,job_type):
    data, summary, provenance=factory()
    result=audit_json_artifact(data,claimed_sha256=hashlib.sha256(data).hexdigest(),
                               expected_job_type=job_type,
                               expected_summary=summary,expected_provenance=provenance)
    assert result["verified"] is True
    assert result["sha256"]==hashlib.sha256(data).hexdigest()
    assert result["job_type"]==job_type


@pytest.mark.parametrize("operation",[
    "orf_scan", "six_frame_translation", "motif_scan", "reverse_complement"
])
def test_four_sequence_insight_methods_verify(operation):
    data, summary, provenance=sequence_evidence(operation)
    audit_json_artifact(data,expected_summary=summary,expected_provenance=provenance)


def test_hash_type_and_canonical_encoding_are_verified():
    data,summary,provenance=pairwise_evidence()
    with pytest.raises(ScientificArtifactAuditError,match="SHA-256"):
        audit_json_artifact(data,claimed_sha256="0"*64)
    with pytest.raises(ScientificArtifactAuditError,match="job type"):
        audit_json_artifact(data,expected_job_type="protein_properties")
    with pytest.raises(ScientificArtifactAuditError,match="canonical"):
        audit_json_artifact(json.dumps(json.loads(data),indent=2).encode())


def test_tampered_pairwise_metrics_are_rejected_even_if_json_is_rehashed():
    data,summary,provenance=pairwise_evidence()
    for change in ("identity","score","aligned_b","gaps"):
        payload=json.loads(data)
        if change=="identity":
            payload["summary"]["identity_percent"]=100.0
        elif change=="score":
            payload["summary"]["score"]=200
        elif change=="aligned_b":
            payload["alignment"]["sequence_b"]="AAAAA"
        else:
            payload["summary"]["gaps"]=1
        tampered=artifact_bytes(payload)
        with pytest.raises(ScientificArtifactAuditError):
            audit_json_artifact(tampered,claimed_sha256=hashlib.sha256(tampered).hexdigest())


@pytest.mark.parametrize("operation",["orf_scan","motif_scan","six_frame_translation","reverse_complement"])
def test_tampered_sequence_metrics_rejected(operation):
    data,_,_=sequence_evidence(operation)
    payload=json.loads(data)
    if operation=="orf_scan":
        payload["result"]["orfs"][0]["end_1based"]=7
    elif operation=="motif_scan":
        payload["result"]["hits"][0]["end_1based"]=900
    elif operation=="six_frame_translation":
        payload["result"]["frames"].pop()
    else:
        payload["result"]["reverse_complement"]="A"
    with pytest.raises(ScientificArtifactAuditError):
        audit_json_artifact(artifact_bytes(payload))


def test_tampered_protein_biochemistry_is_rejected():
    data,_,_=protein_evidence()
    for attr,value in (("molecular_weight_da",-1),("length",10),
                       ("aromaticity_fraction",2.0),("estimated_isoelectric_point",15)):
        payload=json.loads(data)
        payload["summary"][attr]=value
        with pytest.raises(ScientificArtifactAuditError):
            audit_json_artifact(artifact_bytes(payload))


def test_expected_summary_and_provenance_are_bound_to_queue():
    data,summary,provenance=pairwise_evidence()
    fake_summary=deepcopy(summary)
    fake_summary["matches"]=-1
    with pytest.raises(ScientificArtifactAuditError,match="queued job summary"):
        audit_json_artifact(data,expected_summary=fake_summary)
    fake_provenance=deepcopy(provenance)
    fake_provenance["request_fingerprint"]="c"*64
    with pytest.raises(ScientificArtifactAuditError,match="queued job provenance"):
        audit_json_artifact(data,expected_provenance=fake_provenance)
