#!/usr/bin/env python3
"""Render data/activities.json -> feed.xml (RSS 2.0).

RSS aggregators (Inoreader / Feedly / Mastodon RSS bots) pick this up
and surface new ICEN bulletins to their subscribers, multiplying reach
without active promotion.
"""
from __future__ import annotations
import json, html, datetime as dt
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ACTIVITIES = ROOT / "data" / "activities.json"
OUT = ROOT / "feed.xml"

SITE = "https://natto-5hv.pages.dev"
TITLE = "国際納豆撲滅協議会 — 活動報告 / ICEN Communiqués"
DESC = "1972年京都密約より半世紀。架空の国際機関による活動報告(パロディ)。"
MAX = 25


def to_rfc822(date_str: str) -> str:
    """Convert YYYY.MM.DD → RFC-822 date (assume noon JST)."""
    d = dt.datetime.strptime(date_str, "%Y.%m.%d").replace(
        hour=12, tzinfo=dt.timezone(dt.timedelta(hours=9)),
    )
    return d.strftime("%a, %d %b %Y %H:%M:%S %z")


def main() -> None:
    data = json.loads(ACTIVITIES.read_text(encoding="utf-8"))
    events = list(reversed(data["events"]))[:MAX]

    items = []
    for e in events:
        guid = f"{SITE}/#{html.escape(e['date'])}-{html.escape(e['title'])}"
        items.append(f"""    <item>
      <title>{html.escape(e['title'])}</title>
      <link>{SITE}/#activities</link>
      <guid isPermaLink="false">{guid}</guid>
      <pubDate>{to_rfc822(e['date'])}</pubDate>
      <category>{html.escape(e.get('tag', 'Communiqué'))}</category>
      <description>{html.escape(e['body'])}</description>
    </item>""")

    last_build = dt.datetime.now(dt.timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")
    feed = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>{html.escape(TITLE)}</title>
    <link>{SITE}/</link>
    <atom:link href="{SITE}/feed.xml" rel="self" type="application/rss+xml" />
    <description>{html.escape(DESC)}</description>
    <language>ja</language>
    <lastBuildDate>{last_build}</lastBuildDate>
    <generator>ICEN render_feed.py</generator>
{chr(10).join(items)}
  </channel>
</rss>
"""
    OUT.write_text(feed, encoding="utf-8")
    print(f"rendered feed.xml: {len(events)} items")


if __name__ == "__main__":
    main()
