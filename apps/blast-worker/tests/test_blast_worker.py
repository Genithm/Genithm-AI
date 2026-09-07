from __future__ import annotations

from genithm_blast_worker.ncbi_blast import BlastSubmission, NcbiBlastClient, parse_search_info, parse_submission, parse_xml2
from genithm_blast_worker.runtime import BlastJob, process_one


def test_parse_submission_and_status() -> None:
    submission = parse_submission(b"QBlastInfoBegin\nRID = ABCDE12345\nRTOE = 42\nQBlastInfoEnd\n")
    assert submission.rid == "ABCDE12345"
    assert submission.rtoe_seconds == 42
    assert parse_search_info(b"QBlastInfoBegin\nStatus=WAITING\nQBlastInfoEnd") == "WAITING"


def test_parse_xml2_normalizes_top_hit() -> None:
    raw = b'''<?xml version="1.0"?>
<BlastXML2><BlastOutput2><report><Report><program>blastn</program><version>BLASTN 2.17.0+</version>
<search-target><Target><db>core_nt</db></Target></search-target>
<results><Results><search><Search><query-len>100</query-len><hits><Hit><description><HitDescr><id>ref|NM_1.1|</id><title>Example hit</title></HitDescr></description>
<hsps><Hsp><bit-score>200.5</bit-score><evalue>1e-50</evalue><query-from>1</query-from><query-to>90</query-to><hit-from>5</hit-from><hit-to>94</hit-to><identity>81</identity><align-len>90</align-len></Hsp></hsps>
</Hit></hits></Search></search></Results></results></Report></report></BlastOutput2></BlastXML2>'''
    result = parse_xml2(raw, query_sha256="a" * 64, max_targets=20)
    assert result.blast_version == "BLASTN 2.17.0+"
    assert result.database_reported == "core_nt"
    assert result.summary["hit_count"] == 1
    assert result.hits[0]["identity_percent"] == 90.0
    assert result.hits[0]["query_coverage_percent"] == 90.0
    assert result.hits[0]["e_value"] == 1e-50


class FakeClient:
    def __init__(self, job: BlastJob) -> None:
        self.job = job
        self.submitted = None
        self.pending = False
        self.errors = []

    def claim(self):
        job, self.job = self.job, None
        return job

    def download_query(self, job):
        return b">query\nACGTACGTACGTACGTACGTACGTACGTACGT\n"

    def finish_submission(self, job, rid, rtoe_seconds):
        self.submitted = (rid, rtoe_seconds)

    def finish_pending(self, job):
        self.pending = True

    def store_result(self, job, data):
        return f"{job.organization_id}/{job.project_id}/{job.job_id}/blast-result.xml"

    def finish_success(self, job, object_path, result):
        raise AssertionError("not expected")

    def finish_error(self, job, error, retry_poll):
        self.errors.append((error, retry_poll))
        return "error"


class FakeBlast:
    def submit(self, **kwargs):
        assert kwargs["program"] == "blastn"
        assert kwargs["database"] == "core_nt"
        assert kwargs["max_targets"] == 20
        return BlastSubmission("RID123456", 18)


def test_submit_stage_propagates_rid() -> None:
    job = BlastJob(1, "submit", "job", "org", "project", "user", "upload", "org/project/user/upload/query.fasta", 40, "a" * 64, "blastn", "core_nt", "10", 20, True, None)
    client = FakeClient(job)
    assert process_one(client, FakeBlast()) is True
    assert client.submitted == ("RID123456", 18)
    assert client.errors == []
