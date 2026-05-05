// POST /api/apply — entry point for ICEN membership application.
//
// Double opt-in flow:
//   1. Validate Turnstile, rate limit, honeypot, fields, disposable+MX checks
//   2. If email already in KV (already-confirmed) → send REPLY_REPEAT and return phase=repeat
//   3. Otherwise → generate token, store confirm-app-token:<t>=email (24h TTL),
//      send REPLY_CONFIRM_APPLY, return phase=confirmation-pending
//
// The actual application record + final receipt are created in /api/confirm-apply.

import { REPLY_REPEAT, REPLY_CONFIRM_APPLY } from "./_templates";
import {
  jsonResponse,
  corsHeaders,
  EMAIL_RE,
  newToken,
  checkRateLimit,
  verifyTurnstile,
  sendEmail,
  isDisposableEmail,
  checkDomainCanReceive,
  checkRecipientThrottle,
  fillTemplate,
  refVars,
} from "./_lib";

interface Env {
  ICEN_KV: KVNamespace;
  BREVO_API_KEY: string;
  ICEN_SENDER_EMAIL?: string;
  ICEN_SENDER_NAME?: string;
  REPLY_TO_EMAIL?: string;
  TURNSTILE_SECRET_KEY?: string;
  ICEN_PUBLIC_BASE_URL?: string;
}

const REQUIRED_FIELDS = ["name", "region", "breakfast_main", "hate_reason", "signature"] as const;

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const ip = request.headers.get("CF-Connecting-IP") || "";

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

  // Honeypot — bots that fill all fields trip this.
  if (typeof body.affiliation === "string" && body.affiliation.trim() !== "") {
    return jsonResponse(
      { ok: true, phase: "confirmation-pending", message: "確認メールを送付しました。" },
      200,
      origin,
    );
  }

  // Turnstile (no-op if TURNSTILE_SECRET_KEY is unset).
  const tsToken = String(body["cf-turnstile-response"] ?? "");
  const tsOk = await verifyTurnstile(tsToken, env.TURNSTILE_SECRET_KEY ?? "", ip);
  if (!tsOk) return jsonResponse({ ok: false, detail: "captcha failed" }, 403, origin);

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || email.length > 200 || !EMAIL_RE.test(email)) {
    return jsonResponse({ ok: false, detail: "invalid email" }, 400, origin);
  }
  if (isDisposableEmail(email)) {
    return jsonResponse(
      { ok: false, detail: "use-once / disposable email addresses are not accepted" },
      400,
      origin,
    );
  }
  for (const f of REQUIRED_FIELDS) {
    const v = String(body[f] ?? "").trim();
    if (!v || v.length > 200) {
      return jsonResponse({ ok: false, detail: `missing or invalid: ${f}` }, 400, origin);
    }
  }

  // DNS MX/A pre-check (Brevo budget protection).
  if (!(await checkDomainCanReceive(env.ICEN_KV, email))) {
    return jsonResponse(
      { ok: false, detail: "recipient domain cannot receive mail (no MX/A record)" },
      400,
      origin,
    );
  }

  const senderEmail = env.ICEN_SENDER_EMAIL;
  const senderName = env.ICEN_SENDER_NAME;
  const replyTo = env.REPLY_TO_EMAIL;

  // Already-confirmed?
  const existingRaw = await env.ICEN_KV.get(`email:${email}`);
  if (existingRaw) {
    let appNo = "(unknown)";
    try {
      const ex = JSON.parse(existingRaw) as { app_no?: string; count?: number };
      appNo = ex.app_no ?? appNo;
      ex.count = (ex.count || 1) + 1;
      (ex as Record<string, unknown>).last_seen = new Date().toISOString();
      await env.ICEN_KV.put(`email:${email}`, JSON.stringify(ex));
    } catch { /* tolerate */ }

    if (!(await checkRecipientThrottle(env.ICEN_KV, email))) {
      // Silently cap: pretend success to the user, skip the actual send.
      return jsonResponse(
        { ok: true, phase: "repeat", application_no: appNo, message: "貴殿の入会申請は既に当協議会にて受理しております。" },
        200,
        origin,
      );
    }

    try {
      await sendEmail(env.BREVO_API_KEY, {
        to: email,
        subject: `【${appNo}】重複申請に関する通知 / Notice on Duplicate Application`,
        text: fillTemplate(REPLY_REPEAT, refVars({ app_no: appNo })),
        senderEmail, senderName, replyTo,
      });
    } catch (e) {
      console.error("REPLY_REPEAT mail failed:", e);
      return jsonResponse({ ok: false, detail: "mail send failed" }, 502, origin);
    }
    return jsonResponse(
      { ok: true, phase: "repeat", application_no: appNo, message: "貴殿の入会申請は既に当協議会にて受理しております。確認通知を再送いたしました。" },
      200,
      origin,
    );
  }

  // New email — send confirmation link with token.
  const token = newToken();
  await env.ICEN_KV.put(`confirm-app-token:${token}`, email, { expirationTtl: 86400 });

  const baseUrl = (env.ICEN_PUBLIC_BASE_URL ?? "https://natto-5hv.pages.dev").replace(/\/$/, "");
  const confirmUrl = `${baseUrl}/confirm-apply.html?t=${encodeURIComponent(token)}`;

  if (!(await checkRecipientThrottle(env.ICEN_KV, email))) {
    // Silently cap on excess.
    return jsonResponse(
      { ok: true, phase: "confirmation-pending", message: "確認メールを送付しました。リンクをクリックして申請を確定してください。" },
      200,
      origin,
    );
  }

  try {
    await sendEmail(env.BREVO_API_KEY, {
      to: email,
      subject: "【ICEN】入会申請確認のお願い / Please confirm your application",
      text: fillTemplate(REPLY_CONFIRM_APPLY, refVars({ confirm_url: confirmUrl })),
      senderEmail, senderName, replyTo,
    });
  } catch (e) {
    console.error("REPLY_CONFIRM_APPLY mail failed:", e);
    return jsonResponse({ ok: false, detail: "mail send failed" }, 502, origin);
  }

  return jsonResponse(
    {
      ok: true,
      phase: "confirmation-pending",
      message: "確認メールを送付しました。メール内のリンクをクリックすると申請が確定し、申請番号が発番されます。",
    },
    200,
    origin,
  );
};
