#!/usr/bin/env python3
"""Render data/*.json into index.html between AUTO:* markers (in-place)."""
from __future__ import annotations
import json, re, html
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "index.html"
ACTIVITIES = ROOT / "data" / "activities.json"
BULLETINS = ROOT / "data" / "bulletins.json"

MAX_TIMELINE = 6   # show last N activities
TICKER_LOOPS = 2   # repeat ticker items for seamless marquee

def esc(s: str) -> str:
    return html.escape(s, quote=True)

def render_timeline(events: list[dict]) -> str:
    last = events[-MAX_TIMELINE:]
    out = []
    for e in last:
        out.append(
            f'        <div class="ev">\n'
            f'          <div class="date">{esc(e["date"])}</div>\n'
            f'          <div>\n'
            f'            <h4>{esc(e["title"])}</h4>\n'
            f'            <p>{esc(e["body"])}</p>\n'
            f'            <span class="tag">{esc(e["tag"])}</span>\n'
            f'          </div>\n'
            f'        </div>'
        )
    return "\n".join(out)

def render_ticker(items: list[str]) -> str:
    spans = "\n".join(f'      <span>{esc(s)}</span>' for s in items)
    return "\n".join([spans] * TICKER_LOOPS)

def replace_block(text: str, name: str, payload: str) -> str:
    pattern = re.compile(
        rf'(<!-- AUTO:{name}:START -->)(.*?)(<!-- AUTO:{name}:END -->)',
        re.DOTALL,
    )
    if not pattern.search(text):
        raise SystemExit(f"marker AUTO:{name} not found in index.html")
    return pattern.sub(rf'\1\n{payload}\n\3', text)

def main() -> None:
    activities = json.loads(ACTIVITIES.read_text(encoding="utf-8"))["events"]
    bulletins = json.loads(BULLETINS.read_text(encoding="utf-8"))["items"]
    text = INDEX.read_text(encoding="utf-8")
    text = replace_block(text, "TIMELINE", render_timeline(activities))
    text = replace_block(text, "TICKER", render_ticker(bulletins))
    INDEX.write_text(text, encoding="utf-8")
    print(f"rendered: {len(activities)} activities, {len(bulletins)} bulletins")

if __name__ == "__main__":
    main()
