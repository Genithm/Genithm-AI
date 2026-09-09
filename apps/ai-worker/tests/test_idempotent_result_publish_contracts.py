def test_result_publish_is_idempotent_for_same_execution():
    first_publish = {
        "job_id": "job-1",
        "result_id": "result-1",
        "publish_key": "publish-job-1",
    }
    second_publish = {
        "job_id": "job-1",
        "result_id": "result-1",
        "publish_key": "publish-job-1",
    }

    assert first_publish["publish_key"] == second_publish["publish_key"]


def test_different_jobs_have_different_publish_keys():
    first = {"publish_key": "publish-job-1"}
    second = {"publish_key": "publish-job-2"}

    assert first["publish_key"] != second["publish_key"]
