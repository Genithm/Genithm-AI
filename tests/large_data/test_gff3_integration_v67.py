"""V67 real isolated PostgreSQL/S3 API acceptance for whole-file GFF3 feature QC."""
from __future__ import annotations
import gzip
import hashlib
from psycopg.types.json import Jsonb
from app.large_data.worker import process_one
from app.large_data.quality_report import check_digest, seal_report
from test_file_intake_v47 import heartbeat, uploaded, report
from conftest import connect

GFF3=(b"##gff-version 3\n"
      b"chr1\tannotator\tgene\t1\t100\t.\t+\t.\tID=private-gene-1\n"
      b"chr1\tannotator\tmRNA\t5\t90\t.\t+\t.\tID=private-rna;Parent=private-gene-1\n"
      b"chr1\tannotator\texon\t5\t40\t.\t+\t.\tID=private-exon;Parent=private-rna\n"
      b"chr1\tannotator\tCDS\t10\t40\t.\t+\t0\tID=private-cds\n"
      b"chr2\tannotator\tgene\t1\t5\t.\t-\t.\tID=private-secret-gene\n")
ROOT="/api/v1/large-data"

def test_real_s3_owner_scoped_gff3_and_numeric_report(env):
    e=env
    worker=heartbeat(e)
    data=gzip.compress(GFF3)
    sid=uploaded(e,data,"annotations.gff3.gz")
    assert report(e,sid).status_code==409
    assert process_one(e["c"],worker,universal=True)
    response=report(e,sid)
    assert response.status_code==200,response.text
    result=response.json()["report"]
    check_digest(result)
    assert result["source_sha256"]==hashlib.sha256(data).hexdigest()
    assert result["scientific_scope"]=="full_gff3_feature_qc"
    assert result["intake"]["inspection"]=="complete_gff3"
    assert result["metrics"]["feature_rows"]==5
    assert result["metrics"]["gene_features"]==2
    assert result["metrics"]["transcript_features"]==1
    assert result["metrics"]["exon_features"]==1
    assert result["metrics"]["cds_features"]==1
    assert result["metrics"]["contigs_seen"]==2
    assert result["metrics"]["expanded_bytes"]==len(GFF3)
    assert "private-" not in response.text and "chr1" not in response.text
    dl=e["api"].get(ROOT+"/uploads/"+sid+"/quality-report?format=tsv",headers=e["headers"])
    assert dl.status_code==200,dl.text
    assert "gene_features\t2" in dl.text and "feature_rows\t5" in dl.text
    assert "private-" not in dl.text
    assert e["api"].get(ROOT+"/uploads/"+sid+"/quality-report?format=tsv",
                        headers={"Authorization":"Bearer outsider-token"}).status_code==404

def test_invalid_gff3_automatically_rejected_and_preserve_unchanged(env):
    e=env
    worker=heartbeat(e)
    corrupt=b"##gff-version 3\nchr1\ttool\tgene\t0\t10\t.\t+\t.\tID=invalid\n"
    sid=uploaded(e,corrupt,"invalid.gff3")
    assert process_one(e["c"],worker,universal=True)
    state=e["api"].get(ROOT+"/uploads/"+sid,headers=e["headers"]).json()
    assert state["state"]=="rejected" and state["error_code"]=="format_invalid"
    assert report(e,sid).status_code==409
    saved=uploaded(e,corrupt,"preserved.gff3",mode="preserve")
    assert process_one(e["c"],worker,universal=True)
    older=report(e,saved).json()["report"]
    assert older["metrics"] is None and older["scientific_scope"]=="bytes_only"
    assert older["intake"]["inspection"]=="integrity_only"

def test_resealed_tampered_gff3_summary_blocks_export(env):
    e=env
    worker=heartbeat(e)
    sid=uploaded(e,GFF3,"tamper.gff3")
    assert process_one(e["c"],worker,universal=True)
    original=report(e,sid).json()["report"]
    changed=dict(original)
    changed["metrics"]=dict(original["metrics"])
    changed["metrics"]["gene_features"]+=10
    changed.pop("report_sha256")
    with connect() as db:
        db.execute("update public.large_data_uploads set summary=%s where id=%s",
                   [Jsonb(seal_report(changed)),sid])
    assert report(e,sid).status_code==409
    assert e["api"].get(ROOT+"/uploads/"+sid+"/quality-report?format=tsv",
                         headers=e["headers"]).status_code==409
