#!/usr/bin/env python3
"""Post a tweet via the CF Pages /api/auto-post admin endpoint.

Usage:
    python3 scripts/post_x.py --kind=activity
    python3 scripts/post_x.py --kind=bulletin
    python3 scripts/post_x.py --kind=raw --text="custom text..."

Env required (sourced from /home/tama/ai-agent-team/.env via update.sh):
    ICEN_ADMIN_KEY     — must match the value set as a Secret in CF Pages

The tweet text is composed from the latest activity / latest bulletin
(stored in data/*.json) so the X account stays in sync with the site.
Failure is logged but does not crash the calling pipeline.
"""
from __future__ import annotations
import argparse, json, os, sys, urllib.request, urllib.error, hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENDPOINT = os.environ.get("ICEN_AUTO_POST_URL", "https://natto-5hv.pages.dev/api/auto-post")
HASHTAG = "#粘り断つべし"
SITE_URL = "https://natto-5hv.pages.dev"


def weighted_len(s: str) -> int:
    """Approximate X's character counter: CJK+full-width = 2, else = 1."""
    n = 0
    for ch in s:
        # CJK / Hiragana / Katakana / full-width punctuation roughly
        if ord(ch) > 0x3000:
            n += 2
        else:
            n += 1
    return n


def trim_to_weighted(s: str, limit: int) -> str:
    if weighted_len(s) <= limit:
        return s
    cut = []
    n = 0
    for ch in s:
        w = 2 if ord(ch) > 0x3000 else 1
        if n + w + 1 > limit:
            break
        cut.append(ch)
        n += w
    return "".join(cut).rstrip() + "…"


def build_activity_tweet() -> tuple[str, str]:
    data = json.loads((ROOT / "data" / "activities.json").read_text(encoding="utf-8"))
    latest = data["events"][-1]
    title = latest["title"]
    body = latest["body"]
    # X budget: full URL counts as ~23 weighted, hashtag ~14, "活動報告 ─ " ~10,
    # newlines small. Reserve ~50 weighted for surrounding chrome → body limit ~150.
    body_short = trim_to_weighted(body, 130)
    text = f"活動報告 ─ {title}\n\n{body_short}\n\n→ {SITE_URL}\n{HASHTAG}"
    if weighted_len(text) > 280:
        # Fallback: drop body
        text = f"活動報告 ─ {title}\n\n→ {SITE_URL}\n{HASHTAG}"
    idem = "act:" + hashlib.sha1((latest["date"] + "|" + title).encode("utf-8")).hexdigest()[:16]
    return text, idem


def build_bulletin_tweet() -> tuple[str, str]:
    data = json.loads((ROOT / "data" / "bulletins.json").read_text(encoding="utf-8"))
    latest = data["items"][-1]
    text = f"{latest}\n\n→ {SITE_URL}\n{HASHTAG}"
    text = trim_to_weighted(text, 275)
    idem = "bul:" + hashlib.sha1(latest.encode("utf-8")).hexdigest()[:16]
    return text, idem


def post(text: str, idempotency_key: str | None = None) -> dict:
    key = os.environ.get("ICEN_ADMIN_KEY")
    if not key:
        raise SystemExit("ICEN_ADMIN_KEY not set in environment")
    body = {"text": text}
    if idempotency_key:
        body["idempotency_key"] = idempotency_key
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        msg = e.read().decode("utf-8", errors="replace")[:300]
        raise SystemExit(f"auto-post HTTP {e.code}: {msg}")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--kind", choices=["activity", "bulletin", "raw"], required=True)
    p.add_argument("--text", help="for --kind=raw, the tweet text")
    args = p.parse_args()

    if args.kind == "activity":
        text, idem = build_activity_tweet()
    elif args.kind == "bulletin":
        text, idem = build_bulletin_tweet()
    else:
        if not args.text:
            raise SystemExit("--text required for --kind=raw")
        text = args.text
        idem = "raw:" + hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]

    print(f"posting ({weighted_len(text)} weighted-chars):\n{text}\n---")
    res = post(text, idempotency_key=idem)
    print("result:", json.dumps(res, ensure_ascii=False))


if __name__ == "__main__":
    main()
