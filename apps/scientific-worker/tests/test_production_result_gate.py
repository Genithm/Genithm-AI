from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from dataclasses import dataclass
from unittest.mock import patch

from genithm_scientific_worker.runtime_v4 import process_one

ORG="10000000-0000-4000-8000-000000000001"
PROJ="10000000-0000-4000-8000-000000000002"
JOB="10000000-0000-4000-8000-000000000003"
SOURCE=b">dna\nATGAAATAA\n"


@dataclass
class Config:
    visibility_seconds: int=300
    max_attempts: int=3


class RecordingClient:
    def __init__(self,job:dict,source:bytes=SOURCE):
        self.job=deepcopy(job)
        self.source=source
        self.config=Config()
        self.uploads:list[tuple[str,bytes,str]]=[]
        self.rpc_calls:list[tuple[str,dict]]=[]

    def rpc(self,name:str,payload:dict):
        self.rpc_calls.append((name,payload))
        if name=="claim_scientific_job":
            return [self.job]
        return None

    def download(self,path:str,size:int,digest:str):
        assert hashlib.sha256(self.source).hexdigest()==digest
        assert len(self.source)==size
        return self.source

    def upload_result(self,path:str,data:bytes,content_type:str):
        self.uploads.append((path,data,content_type))


def job() -> dict:
    return {
        "message_id":42,"job_id":JOB,"job_type":"sequence_insights",
        "tool_id":"genithm-sequence-insights","tool_version":"0.1.0",
        "organization_id":ORG,"project_id":PROJ,
        "request_fingerprint":"a"*64,
        "parameters":{"operation":"orf_scan","motif":None,"min_aa":2},
        "inputs":[{
            "position":1,"role":"nucleotide_sequence","sha256":hashlib.sha256(SOURCE).hexdigest(),
            "sequence_type":"dna","residue_count":9,"file_size_bytes":len(SOURCE),
            "object_path":f"{ORG}/{PROJ}/input.fasta",
        }],
    }


def test_authorized_production_job_is_audited_and_acknowledged():
    client=RecordingClient(job())
    assert process_one(client) is True
    assert len(client.uploads)==1
    assert client.rpc_calls[1][0]=="finish_sequence_insights_job_success"
    path,data,content_type=client.uploads[0]
    assert path==f"{ORG}/{PROJ}/{JOB}/sequence-insights-result.json"
    assert content_type=="application/json"
    assert hashlib.sha256(data).hexdigest()==client.rpc_calls[1][1]["result_sha256"]
    assert json.loads(data)["summary"]["orf_count"]==1


def test_tampered_evidence_never_uploads_or_claims_success():
    client=RecordingClient(job())
    from genithm_scientific_worker.runtime import process_sequence_insights as original

    def corrupt_output(*args,**kwargs):
        data,summary,provenance,path,content_type,version=original(*args,**kwargs)
        payload=json.loads(data)
        payload["summary"]["orf_count"]=999
        malicious=json.dumps(payload,sort_keys=True,separators=(",",":")).encode()
        return malicious,summary,provenance,path,content_type,version

    with patch("genithm_scientific_worker.runtime_v4.process_sequence_insights",
               side_effect=corrupt_output):
        assert process_one(client) is True

    assert client.uploads==[]
    assert client.rpc_calls[-1][0]=="finish_scientific_job_error"
    assert client.rpc_calls[-1][1]["retryable"] is False
    assert client.rpc_calls[-1][1]["failure_class"]=="input_integrity"
    assert not any(name.endswith("_success") for name,_ in client.rpc_calls)


def test_mutated_source_length_fails_without_saving_evidence():
    claimed=job()
    claimed["inputs"][0]["residue_count"]=10
    client=RecordingClient(claimed)
    assert process_one(client) is True
    assert not client.uploads
    assert client.rpc_calls[-1][0]=="finish_scientific_job_error"
    assert client.rpc_calls[-1][1]["retryable"] is False


def test_mixed_tenant_job_scope_fails_without_upload():
    claimed=job()
    claimed["organization_id"]="../../user"
    client=RecordingClient(claimed)
    assert process_one(client) is True
    assert not client.uploads
    assert client.rpc_calls[-1][0]=="finish_scientific_job_error"
