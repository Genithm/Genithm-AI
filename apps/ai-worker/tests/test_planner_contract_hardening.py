from genithm_ai_worker.planner import validate_plan_shape


def test_unsupported_plan_cannot_carry_action():
    plan = {
        "schema_version": "ai-plan-v1",
        "intent": "unsupported",
        "summary": "Needs more information.",
        "limitations": ["Missing required inputs."],
        "action": {"type": "blast", "parameters": {}},
    }

    try:
        validate_plan_shape(plan)
    except ValueError as exc:
        assert "unsupported plan" in str(exc)
    else:
        raise AssertionError("invalid unsupported plan was accepted")


def test_scientific_plan_requires_exact_action_parameters():
    plan = {
        "schema_version": "ai-plan-v1",
        "intent": "scientific_action",
        "summary": "Run a protein annotation workflow.",
        "limitations": [],
        "action": {
            "type": "protein_annotation",
            "parameters": {},
        },
    }

    try:
        validate_plan_shape(plan)
    except ValueError as exc:
        assert "parameters" in str(exc)
    else:
        raise AssertionError("invalid scientific plan was accepted")
