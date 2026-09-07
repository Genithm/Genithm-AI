import hashlib
import json

import pytest

from genithm_source_worker.protein_annotation import (
    ProteinAnnotationError,
    SourcePayload,
    normalize_interpro_results,
    parse_single_protein_fasta,
    parse_uniprot_record,
)


def payload(value: object, headers: dict[str, str] | None = None) -> SourcePayload:
    raw = json.dumps(value, separators=(",", ":")).encode()
    return SourcePayload(raw=raw, sha256=hashlib.sha256(raw).hexdigest(), byte_count=len(raw), headers=headers or {})


def test_protein_fasta_parser_requires_single_ascii_record() -> None:
    assert parse_single_protein_fasta(b">NP_1\nacdefg\n") == "ACDEFG"
    with pytest.raises(ProteinAnnotationError, match="exactly one"):
        parse_single_protein_fasta(b">a\nACD\n>b\nEFG\n")
    with pytest.raises(ProteinAnnotationError, match="unsupported"):
        parse_single_protein_fasta(b">a\nACD-EFG\n")


def test_uniprot_record_parsing_preserves_release_and_sequence_hash() -> None:
    sequence = "ACDEFGHIKLMNPQRSTVWY"
    record = parse_uniprot_record(
        payload(
            {
                "primaryAccession": "P04637",
                "uniProtkbId": "P53_HUMAN",
                "entryType": "UniProtKB reviewed (Swiss-Prot)",
                "proteinDescription": {"recommendedName": {"fullName": {"value": "Cellular tumor antigen p53"}}},
                "genes": [{"geneName": {"value": "TP53"}, "synonyms": [{"value": "P53"}]}],
                "organism": {"scientificName": "Homo sapiens"},
                "sequence": {"value": sequence},
            },
            {"x-uniprot-release": "2026_04", "x-uniprot-release-date": "2026-08-01"},
        ),
        "P04637",
    )
    assert record.reviewed is True
    assert record.protein_name == "Cellular tumor antigen p53"
    assert record.gene_names == ["TP53", "P53"]
    assert record.organism_name == "Homo sapiens"
    assert record.release == "2026_04"
    assert record.sequence_sha256 == hashlib.sha256(sequence.encode()).hexdigest()


def test_uniprot_record_must_match_requested_accession() -> None:
    with pytest.raises(ProteinAnnotationError, match="identity"):
        parse_uniprot_record(
            payload({"primaryAccession": "Q00001", "uniProtkbId": "TEST_HUMAN", "sequence": {"value": "ACDE"}}),
            "P00001",
        )


def test_interpro_normalization_keeps_bounded_locations() -> None:
    entries = normalize_interpro_results(
        {
            "count": 1,
            "results": [
                {
                    "metadata": {"accession": "IPR000001", "name": "Example domain", "type": "domain"},
                    "proteins": [
                        {"entry_protein_locations": [{"fragments": [{"start": 10, "end": 50}]}]}
                    ],
                }
            ],
        },
        "interpro",
    )
    assert entries == [{
        "accession": "IPR000001",
        "name": "Example domain",
        "type": "domain",
        "source_database": "interpro",
        "locations": [{"start": 10, "end": 50}],
    }]
