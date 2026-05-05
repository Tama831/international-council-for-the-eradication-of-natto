"""ICEN application store.

Persists ONLY {email -> {app_no, first_at, count, last_seen}}.
No name / region / hate_reason / etc. is retained.
"""
from __future__ import annotations
import json, os, fcntl
import datetime as dt
from pathlib import Path
from typing import Tuple

DATA_DIR = Path(os.environ.get("ICEN_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
APPS_FILE = DATA_DIR / "applications.json"
LOCK_FILE = DATA_DIR / ".applications.lock"


def _load() -> dict:
    if not APPS_FILE.exists():
        return {"by_email": {}, "next_seq": 1}
    return json.loads(APPS_FILE.read_text(encoding="utf-8"))


def _save(data: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = APPS_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(APPS_FILE)


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def register_or_lookup(email: str) -> Tuple[bool, str]:
    """Returns (is_first_time, application_no).

    Atomic via flock on a sidecar file. Stores only email + minimal metadata.
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    LOCK_FILE.touch()
    with LOCK_FILE.open("w") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            data = _load()
            email_lc = email.lower().strip()
            now = _now_iso()
            if email_lc in data["by_email"]:
                row = data["by_email"][email_lc]
                row["count"] = int(row.get("count", 1)) + 1
                row["last_seen"] = now
                _save(data)
                return False, row["app_no"]
            seq = int(data.get("next_seq", 1))
            year = dt.date.today().year
            app_no = f"ICEN-A-{year}-{seq:04d}"
            data["by_email"][email_lc] = {
                "app_no": app_no,
                "first_at": now,
                "count": 1,
                "last_seen": now,
            }
            data["next_seq"] = seq + 1
            _save(data)
            return True, app_no
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)
