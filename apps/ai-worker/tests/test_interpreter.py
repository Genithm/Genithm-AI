from __future__ import annotations

import pytest

from genithm_ai_worker.interpreter import (
    EVIDENCE_SCHEMA_VERSION,
    INTERPRETATION_SCHEMA_VERSION,
    build_interpretation_input,
    evidence_ids,
    validate_interpretation_shape,
)


def _evidence() -> dict:
    return {
        "schema_version": EVIDENCE_SCHEMA_VERSION,
        "resource_type": "scientific_job",
        "resource_id": "11111111-1111-1111-1111-111111111111",
        "facts": [
            {"id": "status", "label": "Execution status", "value": "completed"},
            {"id": "tool", "label": "Tool", "value": {"id": "mafft", "version": "7.526"}},
            {"id": "result_summary", "label": "Result summary", "value": {"sequence_count": 4, "aligned_length": 105}},
        ],
    }


def _interpretation() -> dict:
    return {
        "schema_version": INTERPRETATION_SCHEMA_VERSION,
        "summary": "The recorded alignment completed and contains four sequences.",
        "findings": [
            {
                "statement": "The authoritative job status is completed.",
                "evidence_ids": ["status"],
            },
            {
                "statement": "The recorded result summary contains four sequences and an aligned length of 105.",
                "evidence_ids": ["result_summary"],
            },
        ],
        "limitations": ["This interpretation does not rerun the alignment or add external biological claims."],
    }


def test_evidence_ids_requires_unique_well_formed_facts() -> None:
    assert evidence_ids(_evidence()) == {"status", "tool", "result_summary"}
    bad = _evidence()
    bad["facts"].append({"id": "status", "label": "Duplicate", "value": "x"})
    with pytest.raises(ValueError, match="unique"):
        evidence_ids(bad)


def test_build_input_marks_evidence_as_untrusted_data() -> None:
    text = build_interpretation_input(_evidence())
    assert "untrusted data" in text
    assert "interpret only these facts" in text
    assert '"result_summary"' in text


def test_valid_interpretation_must_anchor_findings_to_evidence() -> None:
    interpretation = _interpretation()
    assert validate_interpretation_shape(interpretation, _evidence()) is interpretation


def test_unknown_evidence_reference_is_rejected() -> None:
    interpretation = _interpretation()
    interpretation["findings"][0]["evidence_ids"] = ["invented_fact"]
    with pytest.raises(ValueError, match="unknown evidence"):
        validate_interpretation_shape(interpretation, _evidence())


def test_interpretation_rejects_unexpected_fields() -> None:
    interpretation = _interpretation()
    interpretation["confidence"] = 0.99
    with pytest.raises(ValueError, match="unexpected fields"):
        validate_interpretation_shape(interpretation, _evidence())


def test_interpretation_requires_findings_and_evidence_references() -> None:
    interpretation = _interpretation()
    interpretation["findings"] = []
    with pytest.raises(ValueError, match="findings"):
        validate_interpretation_shape(interpretation, _evidence())

    interpretation = _interpretation()
    interpretation["findings"][0]["evidence_ids"] = []
    with pytest.raises(ValueError, match="evidence references"):
        validate_interpretation_shape(interpretation, _evidence())
