from genithm_sequence_worker.runtime import RuntimeConfig, SupabaseRuntimeClient, ValidationJob


PAYLOAD = b">x\nACGT\n"


def config() -> RuntimeConfig:
    return RuntimeConfig("https://example.supabase.co", "secret")


def job(provider: str) -> ValidationJob:
    return ValidationJob(
        7,
        1,
        "00000000-0000-0000-0000-000000000001",
        "org/project/user/upload/input.fasta",
        len(PAYLOAD),
        "text/plain",
        provider,
        "sequence-inputs",
    )


def test_download_routes_legacy_upload_to_supabase(monkeypatch):
    client = SupabaseRuntimeClient(config())
    monkeypatch.setattr(client, "_download_supabase", lambda _job: PAYLOAD)
    monkeypatch.setattr(client, "_download_r2", lambda _job: (_ for _ in ()).throw(AssertionError("R2 should not run")))
    assert client.download(job("supabase")) == PAYLOAD


def test_download_routes_new_upload_to_r2(monkeypatch):
    client = SupabaseRuntimeClient(config())
    monkeypatch.setattr(client, "_download_supabase", lambda _job: (_ for _ in ()).throw(AssertionError("Supabase should not run")))
    monkeypatch.setattr(client, "_download_r2", lambda _job: PAYLOAD)
    assert client.download(job("r2")) == PAYLOAD


def test_preview_http_r2_requires_explicit_opt_in():
    secure = RuntimeConfig(
        "https://example.supabase.co",
        "secret",
        r2_endpoint="http://minio:9000",
        r2_access_key_id="access",
        r2_secret_access_key="secret",
        r2_sequence_bucket="bucket",
    )
    assert secure.r2_configured is False

    preview = RuntimeConfig(
        "https://example.supabase.co",
        "secret",
        r2_endpoint="http://minio:9000",
        r2_access_key_id="access",
        r2_secret_access_key="secret",
        r2_sequence_bucket="bucket",
        allow_insecure_r2_endpoint=True,
    )
    assert preview.r2_configured is True
