import hashlib

from genithm_source_worker.ncbi import NcbiResponseError, parse_gbseq_xml

XML = b'''<GBSet><GBSeq><GBSeq_length>8</GBSeq_length><GBSeq_definition>Example gene</GBSeq_definition><GBSeq_accession-version>NM_000001.2</GBSeq_accession-version><GBSeq_update-date>01-JAN-2026</GBSeq_update-date><GBSeq_organism>Homo sapiens</GBSeq_organism><GBSeq_sequence>acgtacgt</GBSeq_sequence></GBSeq></GBSet>'''


def test_parse_ncbi_gbseq_record() -> None:
    record = parse_gbseq_xml(XML, database="nucleotide", requested_accession="NM_000001")
    assert record.accession_version == "NM_000001.2"
    assert record.organism == "Homo sapiens"
    assert record.length == 8
    assert record.source_response_sha256 == hashlib.sha256(XML).hexdigest()
    assert record.source_response_bytes == len(XML)
    assert record.fasta_bytes().startswith(b">NM_000001.2 Example gene\nACGTACGT\n")


def test_unversioned_accession_accepts_current_resolved_version() -> None:
    record = parse_gbseq_xml(XML, database="nucleotide", requested_accession="NM_000001")
    assert record.requested_accession == "NM_000001"
    assert record.accession_version == "NM_000001.2"


def test_versioned_accession_must_match_exactly() -> None:
    try:
        parse_gbseq_xml(XML, database="nucleotide", requested_accession="NM_000001.1")
    except NcbiResponseError as exc:
        assert "version" in str(exc)
    else:
        raise AssertionError("expected version mismatch")


def test_length_mismatch_is_rejected() -> None:
    bad = XML.replace(b"<GBSeq_length>8</GBSeq_length>", b"<GBSeq_length>9</GBSeq_length>")
    try:
        parse_gbseq_xml(bad, database="nucleotide", requested_accession="NM_000001")
    except NcbiResponseError as exc:
        assert "length" in str(exc)
    else:
        raise AssertionError("expected length mismatch")
