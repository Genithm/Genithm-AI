from genithm_ai_worker.interpreter import validate_interpretation_shape


def test_interpretation_preserves_limited_evidence_with_limitations():
    evidence = {
        "schema_version": "ai-evidence-v1",
        "facts": [
            {"id": "fact-1", "label": "status", "value": "partial"},
        ],
    }

    interpretation = {
        "schema_version": "ai-interpretation-v1",
        "summary": "Only a recorded partial status is available.",
        "findings": [
            {
                "statement": "The recorded status is partial.",
                "evidence_ids": ["fact-1"],
            }
        ],
        "limitations": ["The snapshot does not contain additional evidence."],
    }

    assert validate_interpretation_shape(interpretation, evidence) == interpretation
