"""Read-quality reports through real isolated PostgreSQL/S3 and production routes."""
from __future__ import annotations
import gzip
import json
from uuid import uuid4
import pytest
from conftest import connect
from test_integration import age_links
from test_pair_integration import pe, ready_file, sources, enqueue
from app.large_data.pair_worker import process_pair
from app.large_data.quality_profile import BIN_ENDS
from app.large_data.quality_report import check_digest


def report(e, kind, uid, token="owner-token", fmt="json"):
    return e["api"].get(f"/api/v1/large-data/{kind}/{uid}/quality-report?format={fmt}", headers={"Authorization":"Bearer "+token})


def test_single_report_survives_database_roundtrip_and_is_loaded_on_demand(env):
    e=env
    raw=b"@PRIVATE_READ\nACGTN\n+\nI5!II\n@ANOTHER_PRIVATE_READ\nNN\n+\n!!\n"
    uid=ready_file(e,gzip.compress(raw),fmt="fastq.gz")
    response=report(e,"uploads",uid)
    assert response.status_code==200,response.text
    envelope=response.json(); check_digest(envelope["report"])
    p=envelope["report"]["metrics"]["quality_profile"]
    assert p["undefined_gc_reads"]==1 and p["read_mean_phred_counts"][0]==1
    assert p["positions"][0][2]==2 and p["positions"][0][3]==40
    assert response.headers["cache-control"]=="no-store"
    assert response.headers["x-content-type-options"]=="nosniff"
    tsv=report(e,"uploads",uid,fmt="tsv")
    assert tsv.status_code==200 and "positions" in tsv.text
    for text in [response.text,tsv.text]:
        assert "PRIVATE_READ" not in text and "I5!II" not in text and "storage_key" not in text
    for route in [f"/uploads/{uid}",f"/projects/{e['project']}"]:
        text=e["api"].get("/api/v1/large-data"+route,headers=e["headers"]).text
        assert "quality_profile_available" in text and '"positions"' not in text
    for token in ["other-token","viewer-token","outsider-token"]:
        assert report(e,"uploads",uid,token).status_code==404
    assert report(e,"uploads",uid,"forged-token").status_code==401
    with connect() as db:
        db.execute("delete from public.organization_members where user_id=%s and organization_id=%s",[e["owner"],e["org"]])
    assert report(e,"uploads",uid).status_code==404


def test_pair_report_scoped_historical_and_tamper_rejection(pe):
    e=pe; a,b=sources(e); pid=enqueue(e,a,b).json()["id"]
    assert report(e,"pairs",pid).status_code==409
    assert process_pair(e["c"],str(uuid4()))
    response=report(e,"pairs",pid); assert response.status_code==200,response.text
    envelope=response.json(); check_digest(envelope["report"])
    assert envelope["sources_available"] is True
    assert envelope["report"]["source_ids"]==[a,b]
    assert envelope["report"]["mates"][0]["quality_profile"]["positions"][0][3]==40
    assert envelope["report"]["mates"][1]["quality_profile"]["positions"][0][3]==20
    for token in ["other-token","viewer-token","outsider-token"]:
        assert report(e,"pairs",pid,token).status_code==404
    age_links(a)
    assert e["api"].post(f"/api/v1/large-data/uploads/{a}/abort",json={},headers=e["headers"]).status_code==200
    historical=report(e,"pairs",pid).json()
    assert historical["sources_available"] is False
    assert historical["report"]==envelope["report"]
    with connect() as db:
        db.execute("update public.large_data_pairs set summary=jsonb_set(summary,'{mates,0,mean_phred}','0'::jsonb) where id=%s",[pid])
    failed=report(e,"pairs",pid)
    assert failed.status_code==409 and "quality_report_integrity_failed" in failed.text
    assert '"positions"' not in failed.text


def test_full_65_bin_pair_fits_existing_jsonb_storage_contract(pe):
    e=pe; ids=[]
    # All 65 length ranges, including the exact 1 MiB per-read boundary. Actual
    # bytes are uploaded and scanned; neither profiles nor hashes are fixtures.
    for mate in (1,2):
        chunks=[]
        for i,n in enumerate(BIN_ENDS):
            seq=(b"ACGTN"*((n+4)//5))[:n]
            qual=(b"I" if mate==1 else b"5")*n
            chunks.append(f"@range-{i}/{mate}\n".encode()+seq+b"\n+\n"+qual+b"\n")
        ids.append(ready_file(e,b"".join(chunks)))
    pid=enqueue(e,*ids).json()["id"]
    assert process_pair(e["c"],str(uuid4()))
    response=report(e,"pairs",pid); assert response.status_code==200,response.text
    result=response.json()["report"]; check_digest(result)
    for metric in result["mates"]:
        p=metric["quality_profile"]
        assert len(p["positions"])==len(p["read_lengths"])==65
        assert sum(row[2] for row in p["positions"])==sum(BIN_ENDS)
        assert all(row[2]==1 for row in p["read_lengths"])
    with connect() as db:
        size=db.execute("select pg_column_size(summary) from public.large_data_pairs where id=%s",[pid]).fetchone()[0]
    assert size<=65536


def test_old_reports_do_not_acquire_invented_profiles(env):
    e=env;uid=ready_file(e,b"@read\nAC\n+\nII\n")
    with connect() as db:
        db.execute("update public.large_data_uploads set summary=(summary-'report_sha256') #- '{metrics,quality_profile}' where id=%s",[uid])
    response=report(e,"uploads",uid)
    assert response.status_code==409 and "quality_profile_not_available" in response.text
