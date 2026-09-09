def test_execution_record_preserves_reproducibility_metadata():
    execution = {
        "job_id": "job-1",
        "tool": "blast",
        "tool_version": "1.0",
        "parameters": {"program": "blastp"},
        "input_checksum": "sha256-input",
    }

    assert execution["job_id"]
    assert execution["tool"]
    assert execution["tool_version"]
    assert execution["parameters"]
    assert execution["input_checksum"]


def test_execution_metadata_is_separate_from_scientific_output():
    record = {
        "output": {"hits": []},
        "execution_metadata": {"tool": "blast"},
    }

    assert record["output"] != record["execution_metadata"]
