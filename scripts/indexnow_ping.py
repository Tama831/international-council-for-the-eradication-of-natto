#!/usr/bin/env python3
"""Submit one or more URLs to IndexNow (Bing/Yandex/DuckDuckGo/Seznam).

Usage:
    python3 scripts/indexnow_ping.py                # ping the homepage
    python3 scripts/indexnow_ping.py URL [URL ...]  # ping specific URLs

The IndexNow key is auto-discovered from the first *.txt file at the repo
root whose name looks like a 32-hex API key (matches Bing's spec).
"""
from __future__ import annotations
import json, re, sys, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOST = "natto-5hv.pages.dev"
SITE = f"https://{HOST}"


def find_key() -> str | None:
    """Find the IndexNow key file at repo root (32-hex .txt)."""
    for p in ROOT.glob("*.txt"):
        m = re.fullmatch(r"[0-9a-f]{8,128}", p.stem)
        if m and p.read_text().strip() == p.stem:
            return p.stem
    return None


def ping(urls: list[str]) -> dict:
    key = find_key()
    if not key:
        raise SystemExit("IndexNow key file not found at repo root (looked for [0-9a-f]+.txt)")
    body = {
        "host": HOST,
        "key": key,
        "keyLocation": f"{SITE}/{key}.txt",
        "urlList": urls,
    }
    req = urllib.request.Request(
        "https://api.indexnow.org/IndexNow",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Host": "api.indexnow.org",
            "User-Agent": "ICEN-bot/1.0 (+https://natto-5hv.pages.dev)",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return {"ok": True, "status": r.status, "urls": len(urls)}
    except urllib.error.HTTPError as e:
        body_resp = e.read().decode("utf-8", errors="replace")[:300]
        return {"ok": False, "status": e.code, "reason": str(e.reason), "body": body_resp}
    except urllib.error.URLError as e:
        return {"ok": False, "error": str(e)}


def main() -> None:
    args = sys.argv[1:]
    if args:
        urls = [u if u.startswith("http") else f"{SITE}{u if u.startswith('/') else '/' + u}" for u in args]
    else:
        urls = [f"{SITE}/"]
    print(f"submitting {len(urls)} URL(s) to IndexNow:")
    for u in urls:
        print(f"  {u}")
    res = ping(urls)
    print("result:", json.dumps(res, ensure_ascii=False))
    # IndexNow returns 200/202 on accept; 400-ish for malformed
    if not res.get("ok") and res.get("status", 0) not in (200, 202):
        sys.exit(1)


if __name__ == "__main__":
    main()
