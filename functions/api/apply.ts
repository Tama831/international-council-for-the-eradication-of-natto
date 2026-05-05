// POST /api/apply — receive an ICEN membership application, send satirical
// auto-reply via Brevo, and persist ONLY {email -> {app_no, first_at, count, last_seen}}
// in Workers KV (binding name: ICEN_KV).
//
// Required env / bindings:
//   ICEN_KV          — KV namespace binding
//   BREVO_API_KEY    — Brevo Transactional Email API key
// Optional:
//   ICEN_SENDER_EMAIL    (default: ly.renum@gmail.com — must be Brevo-verified)
//   ICEN_SENDER_NAME     (default: 国際納豆撲滅協議会 事務局 / ICEN Secretariat)
//   REPLY_TO_EMAIL       (default: same as sender)
//   TURNSTILE_SECRET_KEY (if set, server validates 'cf-turnstile-response' field)

import { REPLY_FIRST, REPLY_REPEAT } from "./_templates";
import {
  jsonResponse,
  corsHeaders,
  EMAIL_RE,
  checkRateLimit,
  verifyTurnstile,
  sendEmail,
} from "./_lib";

interface Env {
  ICEN_KV: KVNamespace;
  BREVO_API_KEY: string;
  ICEN_SENDER_EMAIL?: string;
  ICEN_SENDER_NAME?: string;
  REPLY_TO_EMAIL?: string;
  TURNSTILE_SECRET_KEY?: string;
}

const REQUIRED_FIELDS = ["name", "region", "breakfast_main", "hate_reason", "signature"] as const;

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const ip = request.headers.get("CF-Connecting-IP") || "";

  // Per-IP rate limit (5/hour). Returns 429 if exceeded.
  const rl = await checkRateLimit(env.ICEN_KV, ip, { limit: 5, windowSec: 3600, bucket: "rl-apply" });
  if (!rl.ok) {
    return jsonResponse(
      { ok: false, detail: "rate limit exceeded — try again in an hour" },
      429,
      origin,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, detail: "invalid JSON" }, 400, origin);
  }

  // Honeypot: humans don't fill it; bots that auto-fill all fields trip this.
  if (typeof body.affiliation === "string" && body.affiliation.trim() !== "") {
    return jsonResponse(
      { ok: true, application_no: "ICEN-A-0000-0000", is_first: false, message: "受理いたしました。" },
      200,
      origin,
    );
  }

  // Optional Turnstile verification (no-op if TURNSTILE_SECRET_KEY is unset).
  const tsToken = String(body["cf-turnstile-response"] ?? "");
  const tsOk = await verifyTurnstile(tsToken, env.TURNSTILE_SECRET_KEY ?? "", ip);
  if (!tsOk) return jsonResponse({ ok: false, detail: "captcha failed" }, 403, origin);

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || email.length > 200 || !EMAIL_RE.test(email)) {
    return jsonResponse({ ok: false, detail: "invalid email" }, 400, origin);
  }
  for (const f of REQUIRED_FIELDS) {
    const v = String(body[f] ?? "").trim();
    if (!v || v.length > 200) {
      return jsonResponse({ ok: false, detail: `missing or invalid: ${f}` }, 400, origin);
    }
  }

  // Lookup or assign application number (KV-backed; minimal data only).
  const key = `email:${email}`;
  const now = new Date().toISOString();
  let appNo: string;
  let isFirst: boolean;

  const existingRaw = await env.ICEN_KV.get(key);
  if (existingRaw) {
    isFirst = false;
    const existing = JSON.parse(existingRaw) as { app_no: string; first_at: string; count: number; last_seen: string };
    appNo = existing.app_no;
    existing.count = (existing.count || 1) + 1;
    existing.last_seen = now;
    await env.ICEN_KV.put(key, JSON.stringify(existing));
  } else {
    isFirst = true;
    const seqRaw = await env.ICEN_KV.get("seq:next");
    const seq = seqRaw ? parseInt(seqRaw, 10) : 1;
    const year = new Date().getUTCFullYear();
    appNo = `ICEN-A-${year}-${String(seq).padStart(4, "0")}`;
    await env.ICEN_KV.put("seq:next", String(seq + 1));
    await env.ICEN_KV.put(key, JSON.stringify({
      app_no: appNo, first_at: now, count: 1, last_seen: now,
    }));
  }

  // Send via Brevo.
  const subject = isFirst
    ? `【${appNo}】入会申請受理通知 / Acknowledgment of Application`
    : `【${appNo}】重複申請に関する通知 / Notice on Duplicate Application`;
  const text = (isFirst ? REPLY_FIRST : REPLY_REPEAT).replace(/\{\{app_no\}\}/g, appNo);

  try {
    await sendEmail(env.BREVO_API_KEY, {
      to: email,
      subject,
      text,
      senderEmail: env.ICEN_SENDER_EMAIL,
      senderName: env.ICEN_SENDER_NAME,
      replyTo: env.REPLY_TO_EMAIL,
    });
  } catch (e) {
    console.error("apply mail failed:", e);
    return jsonResponse(
      { ok: false, detail: "mail send failed" },
      502,
      origin,
    );
  }

  return jsonResponse(
    {
      ok: true,
      application_no: appNo,
      is_first: isFirst,
      message: isFirst
        ? "貴殿の入会申請を受理いたしました。事務局より受理通知を電子郵便にて送付済。"
        : "貴殿の入会申請は既に当協議会にて受理しております。確認通知を再送いたしました。",
    },
    200,
    origin,
  );
};
