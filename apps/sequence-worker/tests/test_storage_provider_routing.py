from genithm_sequence_worker.runtime import RuntimeConfig, SupabaseRuntimeClient, ValidationJob


def config() -> RuntimeConfig:
    return RuntimeConfig("https://example.supabase.co", "secret")


def job(provider: str) -> ValidationJob:
    return ValidationJob(
        7,
        1,
        "00000000-0000-0000-0000-000000000001",
        "org/project/user/upload/input.fasta",
        8,
        "text/plain",
        provider,
        "sequence-inputs",
    )


def test_download_routes_legacy_upload_to_supabase(monkeypatch):
    client = SupabaseRuntimeClient(config())
    monkeypatch.setattr(client, "_download_supabase", lambda _job: b">x\nACGT")
    monkeypatch.setattr(client, "_download_r2", lambda _job: (_ for _ in ()).throw(AssertionError("R2 should not run")))
    assert client.download(job("supabase")) == b">x\nACGT"


def test_download_routes_new_upload_to_r2(monkeypatch):
    client = SupabaseRuntimeClient(config())
    monkeypatch.setattr(client, "_download_supabase", lambda _job: (_ for _ in ()).throw(AssertionError("Supabase should not run")))
    monkeypatch.setattr(client, "_download_r2", lambda _job: b">x\nACGT")
    assert client.download(job("r2")) == b">x\nACGT"
