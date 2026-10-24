"""Scientific and privacy regression for streaming managed GFF3 annotations (V67)."""
from __future__ import annotations
import gzip
import hashlib
import io
from uuid import uuid4
import pytest
from app.large_data.gff3_scanner import scan_gff3, validate_gff3_metric, METRIC_FIELDS
from app.large_data.file_registry import describe, LEGACY_VERSION, PREVIOUS_VERSION, VERSION
from app.large_data.file_intake import file_report
from app.large_data.policy import LargeDataError
from app.large_data.quality_report import seal_report, report_for_row, report_tsv
from app.large_data.verify import verify_stream

HEADER=b"##gff-version 3\n##sequence-region chr1 1 1000\n"

def feature(chrom="chr1", typ="gene", start=1, end=100, strand="+", phase=".", attributes="ID=secret"):
    return "\t".join([chrom,"tool",typ,str(start),str(end),".",strand,phase,attributes]).encode()+"\n".encode()

def fixture(fasta=False):
    content=HEADER+b"".join((
        feature(),feature(typ="mRNA",start=10,end=90,attributes="ID=transcriptX;Parent=secret"),
        feature(typ="exon",start=10,end=30),feature(typ="CDS",start=13,end=30,phase="0"),
        feature(typ="five_prime_UTR",start=10,end=12),
        feature(typ="repeat_region",start=200,end=250,strand="?",attributes="Name=private%3Bnote"),
        feature(chrom="chr2",start=5,end=7,strand="-")))
    return content+(b"##FASTA\n>chr1 private header\nACGTN\n" if fasta else b"")

def dbrow(raw,filename="study.gff3",mode="auto"):
    digest=hashlib.sha256(raw).hexdigest()
    return dict(id=str(uuid4()),project_id=str(uuid4()),data_format="opaque",
        expected_bytes=len(raw),checked_bytes=len(raw),expected_sha256=digest,
        actual_sha256=digest,original_filename=filename,intake_mode=mode,
        state="ready",relative_path=filename,batch_id=None)

def result(raw,filename="study.gff3",mode="auto",cap=1000000):
    db=dbrow(raw,filename,mode)
    digest,report=verify_stream(io.BytesIO(raw),db,cap)
    db["summary"]=report
    assert digest==hashlib.sha256(raw).hexdigest()
    return db,report

def test_actual_seven_features_correct_one_based_spans_and_no_private_values():
    db,report=result(fixture())
    m=report["metrics"]
    assert report["scientific_scope"]=="full_gff3_feature_qc"
    assert m["feature_rows"]==7 and m["contigs_seen"]==2
    assert (m["gene_features"],m["transcript_features"],m["exon_features"],
            m["cds_features"],m["utr_features"],m["other_features"])==(2,1,1,1,1,1)
    assert (m["plus_features"],m["minus_features"],m["unknown_strand_features"])==(5,1,1)
    assert m["phased_cds_rows"]==1 and m["unphased_cds_rows"]==0
    assert m["total_feature_span_bp"]==100+81+21+18+3+51+3
    assert m["minimum_feature_bp"]==3 and m["maximum_feature_bp"]==100
    assert m["expanded_bytes"]==len(fixture())
    assert report["intake"]["inspection"]=="complete_gff3"
    assert report["intake"]["registry_version"]==VERSION
    assert set(m)==METRIC_FIELDS
    assert m["sampling"] is False and m["attributes_interpreted"] is False
    validate_gff3_metric(m,len(fixture()))
    assert file_report(db)["report"]["metrics"]==report_for_row(db)["report"]["metrics"]
    tsv=report_tsv(report_for_row(db))
    assert "gene_features\t2" in tsv and "mean_feature_bp\t" in tsv
    assert "secret" not in str(report)+tsv and "chr1" not in str(report)+tsv

@pytest.mark.parametrize("filename",("study.gff3","study.gff3.gz","study.gff3.bgz","study.gff3.bgzf"))
def test_whole_file_gzip_and_embedded_fasta_are_bounded_and_not_inferred(filename):
    source=fixture(fasta=True)
    raw=gzip.compress(source) if filename!="study.gff3" else source
    db,report=result(raw,filename)
    assert report["metrics"]["embedded_fasta"] is True
    assert report["metrics"]["embedded_fasta_validated"] is False
    assert report["metrics"]["feature_rows"]==7
    assert report["metrics"]["expanded_bytes"]==len(source)
    assert report["source_sha256"]==hashlib.sha256(raw).hexdigest()
    assert file_report(db)["report"]["metrics"]["feature_rows"]==7

def test_empty_gff3_has_zero_features_and_no_invented_mean():
    db,report=result(b"##gff-version 3\n")
    m=report["metrics"]
    assert m["feature_rows"]==m["total_feature_span_bp"]==m["contigs_seen"]==0
    assert m["mean_feature_bp"] is None
    assert "feature_rows\t0" in report_tsv(report_for_row(db))

def test_version2_gff3_reports_remain_integrity_only_and_vcf_scanner_is_unchanged():
    assert describe("study.gff3",registry_version=LEGACY_VERSION)["available_inspection"]=="integrity_only"
    assert describe("study.gff3",registry_version=PREVIOUS_VERSION)["available_inspection"]=="integrity_only"
    assert describe("study.gff3",registry_version=VERSION)["available_inspection"]=="complete_gff3"
    assert describe("study.gff",registry_version=VERSION)["available_inspection"]=="integrity_only"
    assert describe("study.gtf",registry_version=VERSION)["available_inspection"]=="integrity_only"
    for version in (PREVIOUS_VERSION,VERSION):
        assert describe("study.vcf",registry_version=version)["available_inspection"]=="complete_vcf"
    db,report=result(fixture(),mode="preserve")
    assert report["metrics"] is None and report["scientific_scope"]=="bytes_only"
    old=dict(report);old["intake"]=dict(report["intake"])
    old["intake"]["registry_version"]=PREVIOUS_VERSION
    old["intake"]["name_hint"]=describe("study.gff3",registry_version=PREVIOUS_VERSION)
    old["intake"]["mode"]="auto"
    old["intake"]["warnings"]=[]
    old.pop("report_sha256")
    db["intake_mode"]="auto"
    db["summary"]=seal_report(old)
    assert file_report(db)["report"]["scientific_scope"]=="bytes_only"

@pytest.mark.parametrize("bad",(
    b"",b"##gff-version 2\n",HEADER+b"##gff-version 3\n",
    HEADER+feature(start=0),HEADER+feature(start=-1),
    HEADER+feature(start=20,end=19),HEADER+feature(strand="!"),
    HEADER+feature(phase="3"),HEADER+feature(attributes="IDbad"),
    HEADER+feature(attributes="ID=bad%0"),HEADER+feature(attributes="ID=bad%XX"),
    HEADER+feature(attributes="ID=foo;"),HEADER+feature(typ="?"),
    HEADER+feature().replace(b"\t.\t+",b"\tnan\t+"),
    HEADER+feature().replace(b"\t.\t+",b"\t1e999\t+"),
    HEADER+b"chr1\ttool\tgene\t1\t10\t.\t+\t.\n",
    HEADER+b"##FASTA\nACGT\n",HEADER+feature()+b"\x00",
))
def test_malformed_gff3_fails_closed(bad):
    with pytest.raises(LargeDataError,match="format_invalid"):
        scan_gff3(io.BytesIO(bad),len(bad)+100)

def test_bounded_streaming_truncation_and_gzip_bomb():
    raw=fixture()
    with pytest.raises(LargeDataError,match="resource_limit"):
        result(gzip.compress(raw),"study.gff3.gz",cap=64)
    with pytest.raises(LargeDataError,match="format_invalid"):
        result(gzip.compress(raw)[:-4],"study.gff3.gz")
    class NoReadAll(io.BytesIO):
        def read(self,n=-1):
            assert n!=-1,"GFF3 scanner cannot read entire object in one call"
            return super().read(n)
    many=HEADER+feature()*10000
    assert scan_gff3(NoReadAll(many),len(many))["feature_rows"]==10000
    with pytest.raises(LargeDataError,match="resource_limit"):
        scan_gff3(io.BytesIO(HEADER+b"x"*2000),70)

def test_resealed_tampering_breaks_summarized_report_validation():
    db,report=result(fixture())
    modified=dict(report);modified["metrics"]=dict(report["metrics"])
    modified["metrics"]["gene_features"]+=1
    modified.pop("report_sha256")
    db["summary"]=seal_report(modified)
    with pytest.raises(LargeDataError,match="integrity_failed"):
        file_report(db)
    with pytest.raises(LargeDataError,match="integrity_failed"):
        report_for_row(db)

def test_private_source_and_attributes_not_in_artifacts():
    raw=HEADER+feature(attributes="Name=secret-person-X")
    db,report=result(raw)
    text=str(report)+report_tsv(report_for_row(db))
    assert "secret-person-X" not in text
    assert "chr1" not in text
    assert report["metrics"]["attributes_interpreted"] is False
