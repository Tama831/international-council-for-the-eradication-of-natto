#!/usr/bin/env python3
"""Pick one evergreen tweet (the oldest-posted, or never-posted) and post it
via the CF Pages /api/auto-post admin endpoint.

Maintains a tiny local rotation log at data/evergreen_state.json so the
same tweet doesn't fire two days in a row.

Usage:
    python3 scripts/post_evergreen.py             # pick + post
    python3 scripts/post_evergreen.py --dry-run   # just print which one would be picked

Env required:
    ICEN_ADMIN_KEY  (auto-loaded from /home/tama/ai-agent-team/.env if missing)
"""
from __future__ import annotations
import argparse, json, os, sys
import datetime as dt
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from post_x import post as post_to_x, weighted_len  # reuses the same client

POOL = ROOT / "data" / "evergreen_tweets.json"
STATE = ROOT / "data" / "evergreen_state.json"


def load_state() -> dict:
    if not STATE.exists():
        return {"history": {}}
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except Exception:
        return {"history": {}}


def save_state(state: dict) -> None:
    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def pick_template(pool: list[dict], history: dict) -> dict:
    """Return the entry whose last_posted_at is the oldest (None first)."""
    def key(t):
        ts = history.get(t["id"])
        # entries never posted go first; otherwise sort by ISO timestamp ascending
        return (ts is not None, ts or "")
    return sorted(pool, key=key)[0]


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    pool = json.loads(POOL.read_text(encoding="utf-8"))["templates"]
    state = load_state()
    pick = pick_template(pool, state["history"])

    text = pick["text"]
    print(f"picked: {pick['id']} ({weighted_len(text)} weighted-chars)")
    print(f"---\n{text}\n---")

    if args.dry_run:
        return

    # idempotency: same tweet text in 24h dedupes server-side
    idem = f"evg:{pick['id']}:{dt.date.today().isoformat()}"
    res = post_to_x(text, idempotency_key=idem)
    print("result:", json.dumps(res, ensure_ascii=False))

    if res.get("ok"):
        state["history"][pick["id"]] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        save_state(state)


if __name__ == "__main__":
    main()
