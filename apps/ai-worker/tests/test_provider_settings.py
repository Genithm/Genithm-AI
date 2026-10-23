import pytest
from genithm_ai_worker.runtime import Settings

def _base(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL","https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY","sb_secret_test")
    monkeypatch.setenv("GEMINI_API_KEY","test-google-key")
    monkeypatch.setenv("GROQ_API_KEY","test-groq-key")
    monkeypatch.delenv("GENITHM_GEMINI_MODEL",raising=False)
    monkeypatch.delenv("GENITHM_GROQ_MODEL",raising=False)

def test_primary_gemini_and_secondary_groq(monkeypatch):
    _base(monkeypatch)
    s=Settings.from_env()
    assert (s.primary.name,s.primary.model)==("gemini","gemini-3.8-flash")
    assert s.primary.endpoint.startswith("https://generativelanguage.googleapis.com/")
    assert s.backup and s.backup.name=="groq"
    assert s.backup.model=="llama-3.3-70b-versatile"

def test_groq_unavailable_means_explicit_primary_only(monkeypatch):
    _base(monkeypatch)
    monkeypatch.delenv("GROQ_API_KEY")
    assert Settings.from_env().backup is None

def test_no_legacy_credential_fallback(monkeypatch):
    _base(monkeypatch)
    monkeypatch.delenv("GEMINI_API_KEY")
    monkeypatch.setenv("OPENROUTER_API_KEY","old")
    monkeypatch.setenv("GENITHM_AI_PRIMARY_API_KEY","old")
    with pytest.raises(ValueError, match="key"):
        Settings.from_env()

def test_custom_model_selection(monkeypatch):
    _base(monkeypatch)
    monkeypatch.setenv("GENITHM_GEMINI_MODEL","gemini-3.7-flash")
    monkeypatch.setenv("GENITHM_GROQ_MODEL","llama-3.3-70b-versatile")
    s=Settings.from_env()
    assert s.primary.model=="gemini-3.7-flash" and s.backup.model=="llama-3.3-70b-versatile"
