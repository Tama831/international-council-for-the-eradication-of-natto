// POST /api/apply — receive an ICEN membership application, send satirical
// auto-reply via Brevo, and persist ONLY {email -> {app_no, first_at, count, last_seen}}
// in Workers KV (binding name: ICEN_KV).
//
// Required env / bindings:
//   ICEN_KV          — KV namespace binding
//   BREVO_API_KEY    — Brevo (Sendinblue) Transactional Email API key
// Optional:
//   ICEN_SENDER_EMAIL  (default: ly.renum@gmail.com — must be a Brevo-verified sender)
//   ICEN_SENDER_NAME   (default: 国際納豆撲滅協議会 事務局 / ICEN Secretariat)
//   REPLY_TO_EMAIL     (default: same as sender)

import { REPLY_FIRST, REPLY_REPEAT } from "./_templates";

interface Env {
  ICEN_KV: KVNamespace;
  BREVO_API_KEY: string;
  ICEN_SENDER_EMAIL?: string;
  ICEN_SENDER_NAME?: string;
  REPLY_TO_EMAIL?: string;
}

const ALLOWED_ORIGINS = new Set([
  "https://tama831.github.io",
]);

function corsHeaders(originHeader: string | null): Record<string, string> {
  const allowed = originHeader && ALLOWED_ORIGINS.has(originHeader)
    ? originHeader
    : "*";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
    },
  });
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const REQUIRED_FIELDS = ["name", "region", "breakfast_main", "hate_reason", "signature"] as const;

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("Origin")),
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, detail: "invalid JSON" }, 400, origin);
  }

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

  const senderEmail = env.ICEN_SENDER_EMAIL ?? "ly.renum@gmail.com";
  const senderName = env.ICEN_SENDER_NAME ?? "国際納豆撲滅協議会 事務局 / ICEN Secretariat";
  const replyTo = env.REPLY_TO_EMAIL ?? senderEmail;

  let brevoStatus = 0;
  let brevoErr = "";
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": env.BREVO_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: [{ email }],
        replyTo: { email: replyTo },
        subject,
        textContent: text,
      }),
    });
    brevoStatus = r.status;
    if (!r.ok) brevoErr = (await r.text()).slice(0, 400);
  } catch (e) {
    brevoErr = e instanceof Error ? e.message : String(e);
  }

  if (brevoErr) {
    console.error("brevo error", brevoStatus, brevoErr);
    return jsonResponse(
      { ok: false, detail: `mail send failed (${brevoStatus || "network"})` },
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
