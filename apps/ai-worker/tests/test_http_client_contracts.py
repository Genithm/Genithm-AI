from genithm_ai_worker.runtime import JsonHttpClient, ProviderHttpError


def test_json_http_client_rejects_oversized_payloads_from_provider(monkeypatch):
    class Response:
        def read(self, size):
            return b"x" * (size + 1)

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    def fake_urlopen(*_args, **_kwargs):
        return Response()

    monkeypatch.setattr("genithm_ai_worker.runtime.urlopen", fake_urlopen)

    try:
        JsonHttpClient.request(
            "https://example.com",
            method="POST",
            headers={},
            payload={},
            timeout=1,
            max_bytes=8,
        )
    except ProviderHttpError as exc:
        assert "size limit" in str(exc)
        assert exc.retryable is False
    else:
        raise AssertionError("oversized provider response was accepted")
