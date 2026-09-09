from genithm_ai_worker.runtime import _first_row


def test_first_row_accepts_supabase_single_row_shape():
    assert _first_row({"id": 1}) == {"id": 1}


def test_first_row_accepts_supabase_list_shape():
    assert _first_row([{"id": 1}]) == {"id": 1}


def test_first_row_handles_empty_claim_queue():
    assert _first_row([]) is None
    assert _first_row(None) is None
