from genithm_ai_worker.interpreter import evidence_ids


def test_evidence_requires_valid_schema_version():
    evidence = {
        "schema_version": "wrong-version",
        "facts": [{"id": "fact-1", "label": "length", "value": 10}],
    }

    try:
        evidence_ids(evidence)
    except ValueError as exc:
        assert "schema version" in str(exc)
    else:
        raise AssertionError("invalid evidence schema was accepted")


def test_evidence_fact_ids_must_be_unique():
    evidence = {
        "schema_version": "ai-evidence-v1",
        "facts": [
            {"id": "same-id", "label": "first", "value": 1},
            {"id": "same-id", "label": "second", "value": 2},
        ],
    }

    try:
        evidence_ids(evidence)
    except ValueError as exc:
        assert "unique" in str(exc)
    else:
        raise AssertionError("duplicate evidence IDs were accepted")
