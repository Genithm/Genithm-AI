# V53 — AI provider troubleshooting (October 2026)

Genithm uses **Google AI Studio / Gemini** directly as primary and **GroqCloud** directly as backup. Their API keys remain server-only. No OpenRouter or OpenAI API endpoint is used.

## Why Groq returned HTTP 404

Groq **retired `llama-3.3-70b-versatile` for free/developer accounts on August 16, 2026**. V49–V52 still selected that ID by default. V53 changes the default to **`openai/gpt-oss-120b` hosted by Groq**, a currently documented Groq-supported tool-using model. The **API provider remains Groq**; no OpenAI API key or requests to OpenAI are used. V53 also maps the retired default ID to the replacement when it was cached as `GENITHM_GROQ_MODEL`. Explicit custom Groq model IDs other than that legacy default are not silently changed. Models available depend on the specific Groq account; inspect the list endpoint.

Groq docs: https://console.groq.com/docs/deprecations and https://console.groq.com/docs/models

## Why Gemini fell back

The previous UI displayed only the **last backup failure**. It could not reveal why Gemini failed. The old Gemini first-output timeout was only 8 seconds; slow response, an unavailable model, auth/permissions, 429 quota, connectivity, or malformed/incomplete output could all cause a fallback. **Without the user's actual private Codespace logs, the specific reason is not verified.**

V53 raises default first-output grace to 20 seconds and total request budget to 90 seconds, and logs each provider's **sanitized failure classification**. If both fail, the UI error includes *both* independent causes. It does not log keys, upstream error bodies, prompts or research data.

## Check both accounts in your Codespace

```bash
git switch main && git pull --ff-only
GENITHM_CODESPACES_MODE=chat bash .devcontainer/start.sh
python3 scripts/check_ai_provider_models.py --inference
```

The final command performs one real model-discovery and structured inference test **independently for both accounts**. It consumes a small amount of quota; results indicate the configured models and sanitized reasons if they fail. It tests structured worker inference, not the entire authenticated chat flow. If the web app opens, the Gemini/Groq check may still fail, and this is reported rather than stopping the UI. For the live chat path, send a small greeting after both checks pass. Check `.codespaces-web.log` locally for the event `ai_provider_attempt_failed` (redact any sensitive values before sharing). The Codespaces startup event output will not disclose API keys.

No keys are stored in Supabase tables. Keep `GEMINI_API_KEY` and `GROQ_API_KEY` in GitHub Codespaces repository secrets and STOP/START the Codespace after changing secrets. Set optional `GENITHM_GEMINI_MODEL` / `GENITHM_GROQ_MODEL` only if your account's model catalogue confirms a supported ID.

For scientific work, backup is allowed **only before any visible answer** and not for image attachments (text-only Groq model). Scientific plans still require server validation and explicit researcher approval.
