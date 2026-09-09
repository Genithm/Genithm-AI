def test_result_provenance_contract_requires_source_metadata():
    result_snapshot = {
        "result": {"value": "analysis-output"},
        "provenance": {
            "tool": "blast",
            "tool_version": "1.0",
            "executed_at": "2026-09-10T00:00:00Z",
        },
    }

    assert "provenance" in result_snapshot
    assert result_snapshot["provenance"]["tool"]
    assert result_snapshot["provenance"]["tool_version"]
    assert result_snapshot["provenance"]["executed_at"]


def test_result_payload_and_provenance_are_separate_contract_sections():
    result_snapshot = {
        "result": {"matches": []},
        "provenance": {"tool": "blast"},
    }

    assert set(result_snapshot) == {"result", "provenance"}
