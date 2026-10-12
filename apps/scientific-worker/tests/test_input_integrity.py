from __future__ import annotations

import copy

import pytest

from genithm_scientific_worker.input_integrity import (
    ScientificInputIntegrityError,
    validate_input_manifest,
    validate_sequence_content,
    validate_shared_sequence_type,
)
from genithm_scientific_worker.runtime import process_pairwise, process_msa
from genithm_scientific_worker.runtime_v4 import process_protein
from genithm_scientific_worker.runtime import process_sequence_insights

ORG="10000000-0000-4000-8000-000000000001"
PROJECT="10000000-0000-4000-8000-000000000002"
JOB="10000000-0000-4000-8000-000000000003"


def item(index=1,kind="dna",count=5):
    return {
        "position":index,"role":"nucleotide_sequence" if index==1 else "other",
        "sequence_type":kind,"residue_count":count,"file_size_bytes":128,
        "sha256":"a"*64,"object_path":f"{ORG}/{PROJECT}/sequence-{index}.fasta",
    }


def job(items):
    return {
        "organization_id":ORG,"project_id":PROJECT,"job_id":JOB,
        "request_fingerprint":"f"*64,
        "inputs":items, "parameters":{"algorithm":"global","match_score":2,"mismatch_score":-1,"gap_score":-2},
        "tool_id":"genithm-pairwise-aligner","tool_version":"0.1.0",
    }


class MemoryClient:
    def __init__(self,content: list[bytes]):
        self.content=iter(content)
        self.downloads=0

    def download(self,path,size,digest):
        self.downloads+=1
        return next(self.content)


def test_valid_claims_are_accepted():
    inputs=[item(1),item(2)]
    assert validate_input_manifest(job(inputs),count_min=2,count_max=2,
                                   allowed_types=frozenset({"dna"}))==inputs
    assert validate_shared_sequence_type(inputs)=="dna"


@pytest.mark.parametrize("key,value",[
    ("position",3),("position",True),("sha256","not-a-hash"),
    ("residue_count",0),("residue_count",True),
    ("file_size_bytes",0),("file_size_bytes",True),
    ("object_path","../../../another-project"),
    ("sequence_type","mystery"),
])
def test_invalid_claims_fail_before_download(key,value):
    claim=job([item(),item(2)])
    claim["inputs"][0][key]=value
    with pytest.raises(ScientificInputIntegrityError):
        validate_input_manifest(claim,count_min=2,count_max=2,
                                allowed_types=frozenset({"dna","rna"}))


def test_mutated_scope_or_fingerprint_is_rejected():
    claim=job([item()])
    for key,value in (("job_id","injected/path"),("organization_id","invalid"),
                      ("request_fingerprint","f"*10)):
        mutated=copy.deepcopy(claim)
        mutated[key]=value
        with pytest.raises(ScientificInputIntegrityError):
            validate_input_manifest(mutated,count_min=1,count_max=1,
                                    allowed_types=frozenset({"dna"}))


def test_incompatible_types_and_invalid_bases_are_rejected():
    with pytest.raises(ScientificInputIntegrityError,match="mixes incompatible"):
        validate_shared_sequence_type([item(1,"dna"),item(2,"rna")])
    with pytest.raises(ScientificInputIntegrityError,match="length"):
        validate_sequence_content(item(count=4),"ACGTN",tool="pairwise")
    with pytest.raises(ScientificInputIntegrityError,match="alphabet"):
        validate_sequence_content(item(count=5),"ACGUX",tool="MAFFT")
    validate_sequence_content(item(kind="rna",count=5),"ACGUN",tool="MAFFT")


def test_pairwise_validated_fasta_binds_sequence_length_and_type():
    j=job([item(1,count=5),item(2,count=5)])
    client=MemoryClient([b">a\nACGTN\n",b">b\nACGTA\n"])
    data,summary,provenance,path,content_type,version=process_pairwise(client,j)
    assert client.downloads==2
    assert summary["aligned_length"]==5
    assert summary["identity_percent"]==80
    assert content_type=="application/json"


def test_pairwise_rejects_residue_count_and_cross_type_before_success():
    j=job([item(1,count=6),item(2,count=5)])
    c=MemoryClient([b">a\nACGTN\n",b">b\nACGTA\n"])
    with pytest.raises(ScientificInputIntegrityError,match="length"):
        process_pairwise(c,j)
    mismatch=job([item(1,kind="dna"),item(2,kind="rna")])
    c2=MemoryClient([])
    with pytest.raises(ScientificInputIntegrityError,match="mixes"):
        process_pairwise(c2,mismatch)
    assert c2.downloads==0


def test_msa_rejects_alphabet_or_claimed_residue_count():
    j=job([item(1,count=4),item(2,count=4),item(3,count=4)])
    j["tool_id"]="mafft"
    j["tool_version"]="7.505-1"
    c=MemoryClient([b">a\nACGT\n",b">b\nACGX\n",b">c\nACGT\n"])
    with pytest.raises(ScientificInputIntegrityError,match="alphabet"):
        process_msa(c,j)
    bad=job([item(1,count=4),item(2,count=5),item(3,count=4)])
    bad["tool_id"]="mafft"
    bad["tool_version"]="7.505-1"
    c2=MemoryClient([b">a\nACGT\n",b">b\nACGT\n",b">c\nACGT\n"])
    with pytest.raises(ScientificInputIntegrityError,match="length"):
        process_msa(c2,bad)


def test_sequence_insight_role_must_be_authorized():
    j=job([item()])
    j["tool_id"]="genithm-sequence-insights"
    j["tool_version"]="0.1.0"
    j["inputs"][0]["role"]="unexpected"
    c=MemoryClient([])
    with pytest.raises(ScientificInputIntegrityError,match="roles"):
        process_sequence_insights(c,j)
    assert c.downloads==0


def test_protein_runtime_requires_canonical_provenance_before_download():
    j=job([item(kind="dna",count=20)])
    j["tool_id"]="genithm-protein-properties"
    j["tool_version"]="0.1.0"
    c=MemoryClient([])
    with pytest.raises(ScientificInputIntegrityError,match="incompatible"):
        process_protein(c,j)
    assert c.downloads==0
