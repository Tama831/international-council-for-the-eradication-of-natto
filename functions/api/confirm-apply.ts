// POST /api/confirm-apply — finalize a membership application using a one-time token.
//
// Flow:
//   1. Receive {token}
//   2. Look up confirm-app-token:<token> in KV → email
//   3. If found:
//      - If email already in KV (race / re-click): return phase=repeat with existing app_no
//      - Else: assign new app_no via HMAC, write KV record, send REPLY_FIRST
//   4. Always consume the token (delete it) on success
//   5. If not found: return 404 (expired/invalid)

import { REPLY_FIRST } from "./_templates";
import {
  jsonResponse,
  corsHeaders,
  checkRateLimit,
  sendEmail,
  makeAppNumber,
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
  ICEN_NUMBER_SALT?: string;
}

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const ip = request.headers.get("CF-Connecting-IP") || "";

  const rl = await checkRateLimit(env.ICEN_KV, ip, { limit: 20, windowSec: 3600, bucket: "rl-confapp" });
  if (!rl.ok) {
    return jsonResponse({ ok: false, detail: "rate limit exceeded" }, 429, origin);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, detail: "invalid JSON" }, 400, origin);
  }

  const token = String(body.token ?? "").trim();
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return jsonResponse({ ok: false, detail: "invalid token" }, 400, origin);
  }

  const tokenKey = `confirm-app-token:${token}`;
  const email = await env.ICEN_KV.get(tokenKey);
  if (!email) {
    return jsonResponse({ ok: false, detail: "token expired or invalid" }, 404, origin);
  }

  const senderEmail = env.ICEN_SENDER_EMAIL;
  const senderName = env.ICEN_SENDER_NAME;
  const replyTo = env.REPLY_TO_EMAIL;

  // Race / re-click protection: someone else (or the same user) might have already
  // confirmed this email. Return repeat semantics in that case.
  const existingRaw = await env.ICEN_KV.get(`email:${email}`);
  if (existingRaw) {
    await env.ICEN_KV.delete(tokenKey);
    let appNo = "(unknown)";
    try {
      appNo = (JSON.parse(existingRaw) as { app_no?: string }).app_no ?? appNo;
    } catch { /* tolerate */ }
    return jsonResponse(
      { ok: true, phase: "repeat", application_no: appNo, message: "貴殿の入会申請は既に当協議会にて受理されております。" },
      200,
      origin,
    );
  }

  const now = new Date().toISOString();
  const year = new Date().getUTCFullYear();
  const appNo = await makeAppNumber(email, year, env.ICEN_NUMBER_SALT ?? "", undefined);

  await env.ICEN_KV.put(`email:${email}`, JSON.stringify({
    app_no: appNo, first_at: now, count: 1, last_seen: now,
  }));
  await env.ICEN_KV.delete(tokenKey);

  // Send the formal first-time receipt (per-recipient throttle: cap silently if hit).
  if (await checkRecipientThrottle(env.ICEN_KV, email)) {
    try {
      await sendEmail(env.BREVO_API_KEY, {
        to: email,
        subject: `【${appNo}】入会申請受理通知 / Acknowledgment of Application`,
        text: fillTemplate(REPLY_FIRST, refVars({ app_no: appNo })),
        senderEmail, senderName, replyTo,
      });
    } catch (e) {
      // Record is created; log but don't fail the user-facing flow.
      console.error("REPLY_FIRST mail failed:", e);
    }
  }

  return jsonResponse(
    {
      ok: true,
      phase: "first",
      application_no: appNo,
      first_at: now,
      message: "入会申請を確定いたしました。事務局より受理通知を電子郵便にて送付しております。",
    },
    200,
    origin,
  );
};
