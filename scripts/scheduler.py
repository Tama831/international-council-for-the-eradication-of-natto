#!/usr/bin/env python3
"""Decide whether (and what) to generate today.

Rules:
  - 定例会議 (Annual Kyoto Summit): held the 3rd Sunday of March for 3 days
    (Sun–Tue). The communiqué is published the FOLLOWING WEDNESDAY (= 3rd Sun + 3).
    On that Wednesday, if no annual entry exists for the current year yet, fire "annual".
  - 通常活動報告: every 23 days from the latest event in data/activities.json.

Output: prints exactly one of: "annual", "regular", "skip" on stdout (always exit 0).
"""
from __future__ import annotations
import json, datetime as dt
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ACTIVITIES = ROOT / "data" / "activities.json"

REGULAR_INTERVAL_DAYS = 23
KYOTO_KEYWORD = "京都密会"


def annual_publish_date(year: int) -> dt.date:
    """Wednesday immediately after the 3rd Sunday of March."""
    march_first = dt.date(year, 3, 1)
    days_to_first_sunday = (6 - march_first.weekday()) % 7  # Mon=0..Sun=6
    first_sunday = march_first + dt.timedelta(days=days_to_first_sunday)
    third_sunday = first_sunday + dt.timedelta(days=14)
    return third_sunday + dt.timedelta(days=3)


def parse_date(s: str) -> dt.date:
    return dt.datetime.strptime(s, "%Y.%m.%d").date()


def has_annual_for_year(events: list[dict], year: int) -> bool:
    return any(
        KYOTO_KEYWORD in e.get("title", "")
        and parse_date(e["date"]).year == year
        for e in events
    )


def main() -> None:
    today = dt.date.today()
    events = json.loads(ACTIVITIES.read_text(encoding="utf-8"))["events"]

    if today == annual_publish_date(today.year) and not has_annual_for_year(events, today.year):
        print("annual")
        return

    last = max(parse_date(e["date"]) for e in events)
    if (today - last).days >= REGULAR_INTERVAL_DAYS:
        print("regular")
        return

    print("skip")


if __name__ == "__main__":
    main()
