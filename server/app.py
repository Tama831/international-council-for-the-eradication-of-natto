"""ICEN application API.

POST /apply  — accepts a membership application, sends a satirical auto-reply,
              persists ONLY (email, application_no, first_at, count, last_seen).
GET  /health — liveness probe.
"""
from __future__ import annotations
import datetime as dt
import logging
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field, field_validator

from store import register_or_lookup
from mail import send_first_time, send_repeat

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("icen")

ALLOWED_ORIGINS = [
    "https://tama831.github.io",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]

app = FastAPI(title="ICEN Application API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["Content-Type"],
)


class Application(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    region: str = Field(min_length=1, max_length=120)
    breakfast_main: str = Field(min_length=1, max_length=40)
    hate_years: int = Field(ge=0, le=120)
    hate_reason: str = Field(min_length=1, max_length=40)
    signature: str = Field(min_length=1, max_length=120)
    email: EmailStr

    @field_validator("name", "region", "signature", mode="before")
    @classmethod
    def _strip(cls, v):
        return v.strip() if isinstance(v, str) else v


@app.get("/health")
def health():
    return {"ok": True, "ts": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}


@app.post("/apply")
def apply(payload: Application):
    is_first, app_no = register_or_lookup(payload.email)
    log.info("apply email=%s app_no=%s first=%s", payload.email, app_no, is_first)
    try:
        if is_first:
            send_first_time(to=payload.email, app_no=app_no)
        else:
            send_repeat(to=payload.email, app_no=app_no)
    except Exception as e:
        log.exception("mail send failed")
        raise HTTPException(status_code=502, detail=f"mail send failed: {e!s}")
    return {
        "ok": True,
        "application_no": app_no,
        "is_first": is_first,
        "message": (
            "貴殿の入会申請を受理いたしました。事務局より受理通知を電子郵便にて送付済。"
            if is_first else
            "貴殿の入会申請は既に当協議会にて受理しております。確認通知を再送いたしました。"
        ),
    }
