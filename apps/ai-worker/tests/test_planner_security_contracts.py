from genithm_ai_worker.planner import SYSTEM_INSTRUCTIONS


def test_planner_has_execution_boundary_instructions():
    assert "do NOT execute tools" in SYSTEM_INSTRUCTIONS
    assert "Never invent" in SYSTEM_INSTRUCTIONS
    assert "User approval is required" in SYSTEM_INSTRUCTIONS
