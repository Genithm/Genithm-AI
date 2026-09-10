from genithm_ai_worker.runtime import Settings


def _base_env(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_test")
    monkeypatch.setenv("GENITHM_AI_PRIMARY_API_KEY", "primary-secret")
    monkeypatch.setenv("GENITHM_AI_PRIMARY_ENDPOINT", "https://primary.example.com/v1/chat/completions")
    monkeypatch.setenv("GENITHM_AI_PRIMARY_MODEL", "primary-model")
    monkeypatch.setenv("GENITHM_AI_BACKUP_API_KEY", "backup-secret")
    monkeypatch.setenv("GENITHM_AI_BACKUP_ENDPOINT", "https://backup.example.com/v1/chat/completions")
    monkeypatch.setenv("GENITHM_AI_BACKUP_MODEL", "backup-model")
    for name in (
        "GENITHM_AI_PRIMARY_PROVIDER",
        "GENITHM_AI_BACKUP_PROVIDER",
        "GENITHM_AI_PRIMARY_PROTOCOL",
        "GENITHM_AI_BACKUP_PROTOCOL",
        "GENITHM_AI_BACKUP_ENABLED",
    ):
        monkeypatch.delenv(name, raising=False)


def test_settings_default_to_qwen_primary_and_deepseek_backup(monkeypatch):
    _base_env(monkeypatch)
    settings = Settings.from_env()
    assert settings.primary.name == "qwen"
    assert settings.primary.protocol == "chat_completions"
    assert settings.backup is not None
    assert settings.backup.name == "deepseek"
    assert settings.backup.protocol == "chat_completions"


def test_settings_can_disable_backup_provider(monkeypatch):
    _base_env(monkeypatch)
    monkeypatch.setenv("GENITHM_AI_BACKUP_ENABLED", "false")
    monkeypatch.delenv("GENITHM_AI_BACKUP_API_KEY", raising=False)
    monkeypatch.delenv("GENITHM_AI_BACKUP_ENDPOINT", raising=False)
    monkeypatch.delenv("GENITHM_AI_BACKUP_MODEL", raising=False)
    settings = Settings.from_env()
    assert settings.primary.name == "qwen"
    assert settings.backup is None
