"""Tiny stdlib-only Gemini REST client."""
from __future__ import annotations
import json, os, urllib.request, urllib.error

PRIMARY = "gemini-2.5-flash"
FALLBACK = "gemini-2.5-pro"
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"

class GeminiError(RuntimeError):
    pass

def call(prompt: str, *, temperature: float = 1.05, model: str | None = None) -> str:
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise GeminiError("GEMINI_API_KEY not set")
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": 2048,
            "responseMimeType": "application/json",
        },
    }
    last_err: Exception | None = None
    for m in [model] if model else [PRIMARY, FALLBACK]:
        url = ENDPOINT.format(model=m, key=key)
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                payload = json.loads(r.read().decode("utf-8"))
            cands = payload.get("candidates") or []
            if not cands:
                raise GeminiError(f"no candidates ({m}): {payload}")
            parts = cands[0].get("content", {}).get("parts", [])
            text = "".join(p.get("text", "") for p in parts).strip()
            if not text:
                raise GeminiError(f"empty text ({m})")
            return text
        except urllib.error.HTTPError as e:
            last_err = GeminiError(f"{m} HTTP {e.code}: {e.read()[:200]!r}")
        except (urllib.error.URLError, json.JSONDecodeError, GeminiError) as e:
            last_err = e
    raise last_err or GeminiError("unknown")

def parse_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lstrip().lower().startswith("json"):
            text = text.split("\n", 1)[1] if "\n" in text else text
    return json.loads(text)
