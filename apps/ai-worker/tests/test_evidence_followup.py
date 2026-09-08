from __future__ import annotations

import pytest

from genithm_ai_worker.evidence_followup import (
    FOLLOWUP_SCHEMA_VERSION,
    build_followup_input,
    validate_followup_shape,
)
from genithm_ai_worker.interpreter import EVIDENCE_SCHEMA_VERSION


def _evidence() -> dict:
    return {
        "schema_version": EVIDENCE_SCHEMA_VERSION,
        "resource_type": "blast_job",
        "resource_id": "11111111-1111-1111-1111-111111111111",
        "facts": [
            {"id": "status", "label": "BLAST status", "value": "completed"},
            {"id": "result_summary", "label": "Result summary", "value": {"hit_count": 3}},
        ],
    }


def test_followup_input_marks_question_and_evidence_untrusted() -> None:
    text = build_followup_input("How many hits were recorded?", _evidence())
    assert "untrusted data" in text
    assert "answer only from the supplied evidence" in text
    assert "How many hits were recorded?" in text


def test_answered_followup_requires_known_evidence_ids() -> None:
    answer = {
        "schema_version": FOLLOWUP_SCHEMA_VERSION,
        "status": "answered",
        "direct_answer": {"statement": "Three hits were recorded.", "evidence_ids": ["result_summary"]},
        "supporting_points": [],
        "limitations": [],
    }
    assert validate_followup_shape(answer, _evidence()) is answer

    answer["direct_answer"]["evidence_ids"] = ["invented"]
    with pytest.raises(ValueError, match="unknown evidence"):
        validate_followup_shape(answer, _evidence())


def test_insufficient_evidence_cannot_smuggle_grounded_claims() -> None:
    answer = {
        "schema_version": FOLLOWUP_SCHEMA_VERSION,
        "status": "insufficient_evidence",
        "direct_answer": {"statement": "The recorded evidence does not establish protein function.", "evidence_ids": []},
        "supporting_points": [],
        "limitations": ["No protein-function evidence is present in this frozen snapshot."],
    }
    assert validate_followup_shape(answer, _evidence()) is answer

    answer["supporting_points"] = [{"statement": "Function is kinase.", "evidence_ids": ["status"]}]
    with pytest.raises(ValueError, match="cannot contain grounded claims"):
        validate_followup_shape(answer, _evidence())


def test_answered_followup_cannot_be_uncited() -> None:
    answer = {
        "schema_version": FOLLOWUP_SCHEMA_VERSION,
        "status": "answered",
        "direct_answer": {"statement": "Completed.", "evidence_ids": []},
        "supporting_points": [],
        "limitations": [],
    }
    with pytest.raises(ValueError, match="requires evidence"):
        validate_followup_shape(answer, _evidence())
