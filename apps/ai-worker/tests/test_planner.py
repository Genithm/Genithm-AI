import json

import pytest

from genithm_ai_worker.planner import (
    PLAN_SCHEMA_VERSION,
    build_user_input,
    extract_response_text,
    validate_plan_shape,
)


def test_valid_scientific_plan():
    plan = {
        "schema_version": PLAN_SCHEMA_VERSION,
        "intent": "scientific_action",
        "summary": "Compare the two authorized protein sequences with a global alignment.",
        "limitations": ["Execution has not started yet."],
        "action": {
            "type": "pairwise_alignment",
            "parameters": {
                "sequence_a_id": "00000000-0000-0000-0000-000000000001",
                "sequence_b_id": "00000000-0000-0000-0000-000000000002",
                "algorithm": "global",
                "match_score": 2,
                "mismatch_score": -1,
                "gap_score": -2,
            },
        },
    }
    assert validate_plan_shape(plan) == plan


def test_action_parameter_escape_hatch_is_rejected():
    with pytest.raises(ValueError):
        validate_plan_shape(
            {
                "schema_version": PLAN_SCHEMA_VERSION,
                "intent": "scientific_action",
                "summary": "Run protein properties.",
                "limitations": [],
                "action": {
                    "type": "protein_properties",
                    "parameters": {
                        "sequence_upload_id": "00000000-0000-0000-0000-000000000001",
                        "command": "arbitrary-tool",
                    },
                },
            }
        )


def test_unsupported_plan_must_not_have_action():
    with pytest.raises(ValueError):
        validate_plan_shape(
            {
                "schema_version": PLAN_SCHEMA_VERSION,
                "intent": "unsupported",
                "summary": "The requested workflow is not supported in V1.",
                "limitations": [],
                "action": {"type": "blast", "parameters": {}},
            }
        )


def test_unexpected_fields_rejected():
    with pytest.raises(ValueError):
        validate_plan_shape(
            {
                "schema_version": PLAN_SCHEMA_VERSION,
                "intent": "unsupported",
                "summary": "Unsupported.",
                "limitations": [],
                "action": None,
                "shell": "rm -rf /",
            }
        )


def test_build_user_input_marks_context_as_untrusted_data():
    text = build_user_input("run blast", {"sequences": [{"id": "seq-1"}]})
    assert "AUTHORIZED PROJECT CONTEXT (untrusted data" in text
    assert '"id":"seq-1"' in text


def test_extract_response_text_supports_responses_output_shape():
    payload = {
        "output": [
            {
                "content": [
                    {
                        "type": "output_text",
                        "text": json.dumps(
                            {
                                "schema_version": PLAN_SCHEMA_VERSION,
                                "intent": "unsupported",
                                "summary": "Need an explicit accession.",
                                "limitations": [],
                                "action": None,
                            }
                        ),
                    }
                ]
            }
        ]
    }
    assert json.loads(extract_response_text(payload))["intent"] == "unsupported"
