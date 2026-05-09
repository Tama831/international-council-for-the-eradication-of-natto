"""Gmail SMTP sender for ICEN auto-replies.

Requires env vars:
  GMAIL_USER          (sender Gmail address — required)
  GMAIL_APP_PASSWORD  (Gmail App Password — required)
  ICEN_FROM_NAME      (display name, default: 国際納豆撲滅協議会 事務局 / ICEN Secretariat)
"""
from __future__ import annotations
import os, smtplib, ssl
from email.message import EmailMessage
from pathlib import Path

SMTP_HOST = os.environ.get("ICEN_SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("ICEN_SMTP_PORT", "587"))
SMTP_USER = os.environ.get("GMAIL_USER", "")
SMTP_PASS = os.environ.get("GMAIL_APP_PASSWORD", "")
FROM_NAME = os.environ.get("ICEN_FROM_NAME", "国際納豆撲滅協議会 事務局 / ICEN Secretariat")
FROM_ADDR = os.environ.get("ICEN_FROM_ADDR", SMTP_USER)

TPL_DIR = Path(__file__).resolve().parent / "templates"


def _render(name: str, **vars) -> str:
    text = (TPL_DIR / name).read_text(encoding="utf-8")
    for k, v in vars.items():
        text = text.replace(f"{{{{{k}}}}}", str(v))
    return text


def _send(to: str, subject: str, body: str) -> None:
    if not SMTP_USER:
        raise RuntimeError("GMAIL_USER not configured")
    if not SMTP_PASS:
        raise RuntimeError("GMAIL_APP_PASSWORD not configured")
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"{FROM_NAME} <{FROM_ADDR}>"
    msg["To"] = to
    msg["Reply-To"] = FROM_ADDR
    msg.set_content(body)
    ctx = ssl.create_default_context()
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as s:
        s.starttls(context=ctx)
        s.login(SMTP_USER, SMTP_PASS)
        s.send_message(msg)


def send_first_time(*, to: str, app_no: str) -> None:
    body = _render("reply_first.txt", app_no=app_no)
    _send(to, f"【{app_no}】入会申請受理通知 / Acknowledgment of Application", body)


def send_repeat(*, to: str, app_no: str) -> None:
    body = _render("reply_repeat.txt", app_no=app_no)
    _send(to, f"【{app_no}】重複申請に関する通知 / Notice on Duplicate Application", body)
