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


def test_clarification_plan_must_not_have_action():
    plan = {
        "schema_version": PLAN_SCHEMA_VERSION,
        "intent": "clarification_required",
        "summary": "Which completed MSA should I use to build the phylogenetic tree?",
        "limitations": ["More than one eligible MSA is available."],
        "action": None,
    }
    assert validate_plan_shape(plan) == plan


def test_clarification_plan_rejects_executable_action():
    with pytest.raises(ValueError):
        validate_plan_shape(
            {
                "schema_version": PLAN_SCHEMA_VERSION,
                "intent": "clarification_required",
                "summary": "Which sequence should I use?",
                "limitations": [],
                "action": {
                    "type": "protein_properties",
                    "parameters": {"sequence_upload_id": "00000000-0000-0000-0000-000000000001"},
                },
            }
        )


def test_conversation_plan_is_non_executable():
    plan = {
        "schema_version": PLAN_SCHEMA_VERSION,
        "intent": "conversation",
        "summary": "A phylogenetic tree represents inferred evolutionary relationships among the supplied sequences.",
        "limitations": [],
        "action": None,
    }
    assert validate_plan_shape(plan) == plan


def test_bounded_msa_phylogeny_workflow_plan():
    plan = {
        "schema_version": PLAN_SCHEMA_VERSION,
        "intent": "scientific_action",
        "summary": "Align the three authorized sequences and then build a phylogenetic tree.",
        "limitations": ["The tree starts only after the MSA completes successfully."],
        "action": {
            "type": "msa_phylogeny_workflow",
            "parameters": {
                "sequence_upload_ids": [
                    "00000000-0000-0000-0000-000000000001",
                    "00000000-0000-0000-0000-000000000002",
                    "00000000-0000-0000-0000-000000000003",
                ]
            },
        },
    }
    assert validate_plan_shape(plan) == plan


@pytest.mark.parametrize("operation,motif,min_aa", [
    ("orf_scan", None, 12),
    ("orf_scan", None, 30),
    ("six_frame_translation", None, 30),
    ("motif_scan", "ATGNR", 30),
    ("motif_scan", "ACGU", 30),
    ("reverse_complement", None, 30),
])
def test_sequence_insights_valid_plan(operation, motif, min_aa):
    plan = {
        "schema_version": PLAN_SCHEMA_VERSION,
        "intent": "scientific_action",
        "summary": "Analyze this authorized nucleotide FASTA.",
        "limitations": ["Results will be produced by the scientific worker."],
        "action": {
            "type": "sequence_insights",
            "parameters": {
                "sequence_upload_id": "00000000-0000-0000-0000-000000000001",
                "operation": operation,
                "motif": motif,
                "min_aa": min_aa,
            },
        },
    }
    assert validate_plan_shape(plan) == plan


@pytest.mark.parametrize("changes", [
    {"operation": "arbitrary_command"},
    {"motif": "ATG", "operation": "orf_scan"},
    {"min_aa": 12, "operation": "reverse_complement"},
    {"operation": "motif_scan", "motif": "AT*"},
    {"operation": "motif_scan", "motif": "atg"},
    {"operation": "motif_scan", "motif": None},
    {"operation": "orf_scan", "min_aa": 0},
    {"operation": "orf_scan", "min_aa": True},
    {"operation": "orf_scan", "min_aa": 1001},
    {"sequence_upload_id": "fake"},
])
def test_sequence_insights_rejects_unsafe_parameters(changes):
    params = {
        "sequence_upload_id": "00000000-0000-0000-0000-000000000001",
        "operation": "orf_scan",
        "motif": None,
        "min_aa": 30,
    }
    params.update(changes)
    plan = {
        "schema_version": PLAN_SCHEMA_VERSION,
        "intent": "scientific_action",
        "summary": "Analyze this nucleotide FASTA.",
        "limitations": [],
        "action": {"type": "sequence_insights", "parameters": params},
    }
    with pytest.raises(ValueError):
        validate_plan_shape(plan)


def test_sequence_insights_rejects_extra_fields():
    plan = {
        "schema_version": PLAN_SCHEMA_VERSION,
        "intent": "scientific_action",
        "summary": "Analyze this nucleotide FASTA.",
        "limitations": [],
        "action": {
            "type": "sequence_insights",
            "parameters": {
                "sequence_upload_id": "00000000-0000-0000-0000-000000000001",
                "operation": "orf_scan",
                "motif": None,
                "min_aa": 30,
                "shell": "evil",
            },
        },
    }
    with pytest.raises(ValueError):
        validate_plan_shape(plan)
