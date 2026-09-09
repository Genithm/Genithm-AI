VALID_ANALYSIS_STATES = {
    "created",
    "queued",
    "running",
    "completed",
    "failed",
    "cancelled",
}


def test_analysis_lifecycle_states_are_defined():
    assert "created" in VALID_ANALYSIS_STATES
    assert "queued" in VALID_ANALYSIS_STATES
    assert "running" in VALID_ANALYSIS_STATES
    assert "completed" in VALID_ANALYSIS_STATES
    assert "failed" in VALID_ANALYSIS_STATES
    assert "cancelled" in VALID_ANALYSIS_STATES


def test_terminal_states_are_separated_from_active_states():
    terminal = {"completed", "failed", "cancelled"}
    active = VALID_ANALYSIS_STATES - terminal

    assert terminal.isdisjoint(active)
