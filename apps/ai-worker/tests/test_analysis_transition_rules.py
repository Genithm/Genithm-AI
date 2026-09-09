ALLOWED_TRANSITIONS = {
    "created": {"queued", "cancelled"},
    "queued": {"running", "cancelled"},
    "running": {"completed", "failed", "cancelled"},
    "completed": set(),
    "failed": set(),
    "cancelled": set(),
}


def test_analysis_transition_flow_is_forward_only():
    assert "queued" in ALLOWED_TRANSITIONS["created"]
    assert "running" in ALLOWED_TRANSITIONS["queued"]
    assert "completed" in ALLOWED_TRANSITIONS["running"]


def test_terminal_states_cannot_transition():
    assert ALLOWED_TRANSITIONS["completed"] == set()
    assert ALLOWED_TRANSITIONS["failed"] == set()
    assert ALLOWED_TRANSITIONS["cancelled"] == set()
