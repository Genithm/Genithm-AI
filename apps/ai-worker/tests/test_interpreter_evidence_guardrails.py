from genithm_ai_worker.interpreter import validate_interpretation_shape


def _evidence():
    return {
        "schema_version": "ai-evidence-v1",
        "facts": [
            {"id": "fact-1", "label": "sequence_length", "value": 100},
        ],
    }


def test_interpretation_requires_existing_evidence_ids():
    interpretation = {
        "schema_version": "ai-interpretation-v1",
        "summary": "A recorded fact was observed.",
        "findings": [
            {"statement": "Length was recorded.", "evidence_ids": ["missing-fact"]}
        ],
        "limitations": [],
    }

    try:
        validate_interpretation_shape(interpretation, _evidence())
    except ValueError as exc:
        assert "unknown evidence" in str(exc)
    else:
        raise AssertionError("unknown evidence reference was accepted")


def test_interpretation_accepts_supported_evidence_reference():
    interpretation = {
        "schema_version": "ai-interpretation-v1",
        "summary": "A recorded fact was observed.",
        "findings": [
            {"statement": "Length was recorded.", "evidence_ids": ["fact-1"]}
        ],
        "limitations": [],
    }

    assert validate_interpretation_shape(interpretation, _evidence()) == interpretation
