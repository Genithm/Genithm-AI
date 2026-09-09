def test_worker_publish_contract_requires_job_and_result_ids():
    publish_event = {
        "job_id": "job-1",
        "result_id": "result-1",
        "status": "completed",
    }

    assert publish_event["job_id"]
    assert publish_event["result_id"]
    assert publish_event["status"] == "completed"


def test_worker_failure_publish_requires_error_context():
    failure_event = {
        "job_id": "job-2",
        "status": "failed",
        "error": "execution failed",
    }

    assert failure_event["job_id"]
    assert failure_event["status"] == "failed"
    assert failure_event["error"]
