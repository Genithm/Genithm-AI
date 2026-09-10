from genithm_ai_worker.evidence_followup import validate_followup_shape


def test_followup_response_cannot_reference_unknown_evidence():
    evidence = {
        "schema_version": "ai-evidence-v1",
        "facts": [{"id": "fact-1", "label": "result", "value": "ok"}],
    }
    response = {
        "schema_version": "ai-evidence-answer-v1",
        "status": "answered",
        "direct_answer": {
            "statement": "The result is supported.",
            "evidence_ids": ["unknown"],
        },
        "supporting_points": [],
        "limitations": [],
    }

    try:
        validate_followup_shape(response, evidence)
    except ValueError as exc:
        assert "evidence" in str(exc)
    else:
        raise AssertionError("unknown evidence reference was accepted")
