"""Legacy filename kept for stable CI discovery; verify only approved V49 providers."""
from genithm_ai_worker.providers import ENDPOINTS, OpenAICompatibleProvider, ProviderConfig
import pytest

@pytest.mark.parametrize("name",["gemini","groq"])
def test_provider_wire_format(name,monkeypatch):
    captured={}
    def fake_request(url,*,method,headers,payload,timeout,max_bytes=2*1024*1024):
        captured.update(url=url,headers=headers,payload=payload)
        return {"choices":[{"finish_reason":"stop","message":{"content":'{"status":"ok"}'}}],"model":payload["model"]}
    monkeypatch.setattr("genithm_ai_worker.providers.JsonHttpClient.request",fake_request)
    provider=OpenAICompatibleProvider(
        ProviderConfig(name=name,api_key="test-fixture",endpoint=ENDPOINTS[name],
                       model="gemini-3.8-flash" if name=="gemini" else "openai/gpt-oss-120b",
                       protocol="chat_completions"),timeout_seconds=30)
    result=provider.structured_response(instructions="JSON only",input_text="test",
         schema_name="test_schema",schema={"type":"object","properties":{"status":{"const":"ok"}},"required":["status"],"additionalProperties":False})
    assert captured["url"]==ENDPOINTS[name]
    assert captured["headers"]["Authorization"]=="Bearer test-fixture"
    assert captured["payload"]["response_format"]["type"]==("json_schema" if name=="gemini" else "json_object")
    assert "status" in result["output"][0]["content"][0]["text"]

@pytest.mark.parametrize("name,endpoint",[
    ("openrouter","https://openrouter.ai/api/v1/chat/completions"),
    ("deepseek","https://api.deepseek.com/chat/completions"),
    ("qwen","https://some.vendor.example/v1/chat/completions"),
])
def test_legacy_vendor_rejected(name,endpoint):
    with pytest.raises(ValueError,match="Gemini|Groq"):
        ProviderConfig(name=name,api_key="test",endpoint=endpoint,model="test",protocol="chat_completions")

def test_malformed_structured_answer_rejected(monkeypatch):
    def fake_request(*a,**kw):
        return {"choices":[{"finish_reason":"stop","message":{"content":'{"status":"bad"}'}}]}
    monkeypatch.setattr("genithm_ai_worker.providers.JsonHttpClient.request",fake_request)
    p=OpenAICompatibleProvider(ProviderConfig("gemini","test",ENDPOINTS["gemini"],"gemini-3.8-flash","chat_completions"),timeout_seconds=30)
    with pytest.raises(Exception,match="integrity"):
        p.structured_response(instructions="",input_text="",schema_name="x",
           schema={"type":"object","properties":{"status":{"const":"ok"}},"required":["status"]})
