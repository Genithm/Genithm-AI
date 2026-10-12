from __future__ import annotations

import hashlib
from copy import deepcopy
from unittest.mock import patch

import pytest

from genithm_scientific_worker.output_integrity import (
    ScientificOutputIntegrityError, audit_scientific_output,
)
from genithm_scientific_worker.source_scope import validate_phylogeny_source
from genithm_scientific_worker.runtime import process_phylogeny
from genithm_scientific_worker.runtime_v4 import process_one

ORG = "10000000-0000-4000-8000-000000000001"
PROJECT = "10000000-0000-4000-8000-000000000002"
JOB = "10000000-0000-4000-8000-000000000003"
SOURCE = "10000000-0000-4000-8000-000000000004"
ALIGNMENT = b">seq1\nACGT\n>seq2\nACCT\n>seq3\nAGGT\n"
TREE = b"(seq1:0.1,seq2:0.2,seq3:0.3);\n"


def phylo_job():
    params = {
        "source_msa_job_id": SOURCE,
        "source_result_object_path": f"{ORG}/{PROJECT}/{SOURCE}/msa-result.fasta",
        "source_result_sha256": hashlib.sha256(ALIGNMENT).hexdigest(),
        "source_result_bytes": len(ALIGNMENT),
        "sequence_type": "dna",
        "sequence_count": 3,
        "aligned_length": 4,
        "model": "gtr_cat",
    }
    return {
        "job_type": "phylogenetic_tree", "tool_id": "fasttree",
        "tool_version": "2.1.11-2", "request_fingerprint": "a"*64,
        "organization_id": ORG, "project_id": PROJECT, "job_id": JOB,
        "parameters": params, "message_id": 9,
    }


def test_source_scope_prevents_cross_tenant_path_before_download():
    job = phylo_job()
    assert validate_phylogeny_source(job)[0].startswith(ORG + "/" + PROJECT)
    for forged in ("another-tenant/" + job["parameters"]["source_result_object_path"],
                   f"{ORG}/{PROJECT}/../{SOURCE}/msa-result.fasta",
                   f"{ORG}/{PROJECT}/{JOB}/msa-result.fasta"):
        hostile = deepcopy(job)
        hostile["parameters"]["source_result_object_path"] = forged
        with pytest.raises(ValueError, match="tenant and MSA"):
            validate_phylogeny_source(hostile)
    hostile = deepcopy(job)
    hostile["parameters"]["source_result_bytes"] = True
    with pytest.raises(ValueError, match="byte count"):
        validate_phylogeny_source(hostile)


def test_phylogeny_output_audit_rejects_rehashed_forged_metrics():
    job = phylo_job()
    p = job["parameters"]
    summary = {
        "job_type": "phylogenetic_tree", "model": "gtr_cat",
        "leaf_count": 3, "internal_support_count": 0,
        "source_msa_job_id": SOURCE, "source_msa_sha256": p["source_result_sha256"],
    }
    provenance = {
        "tool_id": "fasttree", "tool_version": "2.1.11-2",
        "request_fingerprint": job["request_fingerprint"], "model": "gtr_cat",
        "source_msa_job_id": SOURCE, "source_msa_sha256": p["source_result_sha256"],
        "source_msa_object_path": p["source_result_object_path"],
    }
    assert audit_scientific_output(TREE, job, summary, provenance)["verified"]
    tampered = dict(summary, leaf_count=99)
    with pytest.raises(ScientificOutputIntegrityError, match="Newick"):
        audit_scientific_output(TREE, job, tampered, provenance)
    with pytest.raises(ValueError, match="duplicated"):
        audit_scientific_output(b"(seq1:0.1,seq1:0.1,seq3:0.1);\n", job, summary, provenance)


def test_phylogeny_download_is_never_attempted_with_forged_scope():
    class Client:
        def download_result(self, *_):
            raise AssertionError("must never download cross-tenant data")
    job = phylo_job()
    job["parameters"]["source_result_object_path"] = "other/tenant/source.fasta"
    with pytest.raises(ValueError, match="tenant and MSA"):
        process_phylogeny(Client(), job)


def test_phylogeny_verifies_source_aligned_length():
    class Client:
        def download_result(self, *_):
            return ALIGNMENT
    job = phylo_job()
    job["parameters"]["aligned_length"] = 999
    with pytest.raises(ValueError, match="aligned length"):
        process_phylogeny(Client(), job)


def test_runtime_rejects_fake_tree_before_upload_or_success():
    job = phylo_job()
    class Client:
        config = type("Config", (), {"visibility_seconds": 300, "max_attempts": 3})()
        uploads = []
        calls = []
        def rpc(self, name, payload):
            self.calls.append((name, payload))
            return [job] if name == "claim_scientific_job" else None
        def upload_result(self, *args):
            self.uploads.append(args)
    client = Client()
    def forged_result(*_):
        p = job["parameters"]
        return TREE, {
            "job_type": "phylogenetic_tree", "leaf_count": 99,
            "internal_support_count": 0, "model": "gtr_cat",
            "source_msa_job_id": SOURCE, "source_msa_sha256": p["source_result_sha256"],
        }, {
            "tool_id": "fasttree", "tool_version": "2.1.11-2",
            "request_fingerprint": job["request_fingerprint"], "model": "gtr_cat",
            "source_msa_job_id": SOURCE, "source_msa_sha256": p["source_result_sha256"],
            "source_msa_object_path": p["source_result_object_path"],
        }, "unused", "text/plain", "0.6.0"
    with patch("genithm_scientific_worker.runtime_v4.process_phylogeny", side_effect=forged_result):
        assert process_one(client)
    assert not client.uploads
    assert client.calls[-1][0] == "finish_scientific_job_error"
    assert client.calls[-1][1]["failure_class"] == "output_validation"
    assert client.calls[-1][1]["retryable"] is False


def test_msa_output_audit_detects_wrong_count_and_content():
    job = {"job_type": "multiple_sequence_alignment", "tool_id": "mafft",
           "tool_version": "7.505-1", "request_fingerprint": "a"*64,
           "parameters": {}, "inputs": [
               {"position": i, "role": "sequence", "sha256": f"{i}"*64, "sequence_type": "dna"}
               for i in range(1, 4)
           ]}
    summary = {"job_type": "multiple_sequence_alignment", "strategy": "auto",
               "sequence_count": 3, "aligned_length": 4,
               "input_sha256s": [i["sha256"] for i in job["inputs"]]}
    provenance = {"tool_id": "mafft", "tool_version": "7.505-1",
                  "request_fingerprint": "a"*64, "parameters": {},
                  "inputs": [{"position": i["position"], "role": i["role"],
                              "sha256": i["sha256"]} for i in job["inputs"]]}
    assert audit_scientific_output(ALIGNMENT, job, summary, provenance)["verified"]
    with pytest.raises(ScientificOutputIntegrityError, match="aligned length"):
        audit_scientific_output(ALIGNMENT, job, dict(summary, aligned_length=5), provenance)
    with pytest.raises(ScientificOutputIntegrityError, match="invalid or empty"):
        audit_scientific_output(ALIGNMENT.replace(b"AGGT", b"AXGT"), job, summary, provenance)
