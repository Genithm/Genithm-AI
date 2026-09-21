from genithm_ai_worker.providers import OpenAICompatibleProvider, ProviderConfig


def test_deepseek_chat_completions_uses_json_object_mode(monkeypatch):
    captured = {}

    def fake_request(url, *, method, headers, payload, timeout, max_bytes=2 * 1024 * 1024):
        captured.update(
            {
                "url": url,
                "method": method,
                "headers": headers,
                "payload": payload,
                "timeout": timeout,
                "max_bytes": max_bytes,
            }
        )
        return {
            "choices": [
                {
                    "message": {
                        "content": '{"schema_version":"ai-plan-v1","intent":"clarification_required","summary":"Which sequence should I use?","limitations":[],"action":null}'
                    }
                }
            ]
        }

    monkeypatch.setattr("genithm_ai_worker.providers.JsonHttpClient.request", fake_request)

    provider = OpenAICompatibleProvider(
        ProviderConfig(
            name="deepseek",
            api_key="secret",
            endpoint="https://api.deepseek.com/chat/completions",
            model="deepseek-flash",
            protocol="chat_completions",
        ),
        timeout_seconds=30,
    )

    result = provider.structured_response(
        instructions="Return JSON only.",
        input_text="Build a tree.",
        schema_name="genithm_ai_plan_v1",
        schema={"type": "object"},
    )

    assert captured["url"] == "https://api.deepseek.com/chat/completions"
    assert captured["payload"]["model"] == "deepseek-flash"
    assert captured["payload"]["response_format"] == {"type": "json_object"}
    assert "json_schema" not in captured["payload"]["response_format"]
    assert result["output"][0]["content"][0]["type"] == "output_text"


def test_non_deepseek_chat_provider_keeps_strict_json_schema(monkeypatch):
    captured = {}

    def fake_request(_url, *, method, headers, payload, timeout, max_bytes=2 * 1024 * 1024):
        captured["payload"] = payload
        return {"choices": [{"message": {"content": "{}"}}]}

    monkeypatch.setattr("genithm_ai_worker.providers.JsonHttpClient.request", fake_request)

    provider = OpenAICompatibleProvider(
        ProviderConfig(
            name="openai",
            api_key="secret",
            endpoint="https://api.example.com/v1/chat/completions",
            model="test-model",
            protocol="chat_completions",
        ),
        timeout_seconds=30,
    )
    provider.structured_response(
        instructions="Return JSON only.",
        input_text="test",
        schema_name="test_schema",
        schema={"type": "object"},
    )

    assert captured["payload"]["response_format"]["type"] == "json_schema"
    assert captured["payload"]["response_format"]["json_schema"]["strict"] is True
