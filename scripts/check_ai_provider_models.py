#!/usr/bin/env python3
"""Read-only model preflight; does not generate inference or disclose credentials."""
import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

def check(name, key_env, model_env, url, header, prefix=""):
    key = os.environ.get(key_env, "").strip()
    model = os.environ.get(model_env, "").strip()
    if not key or not model:
        raise ValueError(f"{name}: {key_env} and {model_env} must be configured")
    req = Request(url, headers={header: prefix + key, "Accept": "application/json"})
    try:
        with urlopen(req, timeout=12) as resp:
            result = json.load(resp)
    except (HTTPError, URLError, TimeoutError, ValueError):
        raise RuntimeError(f"{name}: unable to verify model availability (check API key and network)") from None
    identifiers = {str(x.get("name",x.get("id",""))).removeprefix("models/") for x in result.get("models",result.get("data",[]))}
    if model not in identifiers:
        raise RuntimeError(f"{name}: model is not available in this account")
    print(f"{name} account provides model {model}")

if __name__ == "__main__":
    try:
        check("Google AI Studio","GEMINI_API_KEY","GENITHM_GEMINI_MODEL",
              "https://generativelanguage.googleapis.com/v1beta/models","x-goog-api-key")
        check("Groq","GROQ_API_KEY","GENITHM_GROQ_MODEL",
              "https://api.groq.com/openai/v1/models","Authorization","Bearer ")
    except (ValueError,RuntimeError) as error:
        print(str(error),file=sys.stderr)
        raise SystemExit(2)
