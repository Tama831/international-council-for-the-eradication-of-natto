// POST /api/confirm-delete — finalize deletion using a one-time token.
//
// Flow:
//   1. Receive {token}
//   2. Look up del-token:<token> in KV → email
//   3. If found: load email:<email>, delete it + the token, send confirmation email
//   4. If not found: return invalid/expired

import {
  jsonResponse,
  corsHeaders,
  checkRateLimit,
  sendEmail,
  fillTemplate,
  refVars,
} from "./_lib";
import { DELETE_DONE } from "./_templates";

interface Env {
  ICEN_KV: KVNamespace;
  BREVO_API_KEY: string;
  ICEN_SENDER_EMAIL?: string;
  ICEN_SENDER_NAME?: string;
  REPLY_TO_EMAIL?: string;
}

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const ip = request.headers.get("CF-Connecting-IP") || "";

  // Looser limit; token possession itself is the auth.
  const rl = await checkRateLimit(env.ICEN_KV, ip, { limit: 20, windowSec: 3600, bucket: "rl-conf" });
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

  const tokenKey = `del-token:${token}`;
  const email = await env.ICEN_KV.get(tokenKey);
  if (!email) {
    return jsonResponse(
      { ok: false, detail: "token expired or invalid" },
      404,
      origin,
    );
  }

  const emailKey = `email:${email}`;
  const existingRaw = await env.ICEN_KV.get(emailKey);
  let appNo = "(unknown)";
  if (existingRaw) {
    try {
      const existing = JSON.parse(existingRaw) as { app_no?: string };
      appNo = existing.app_no ?? appNo;
    } catch { /* tolerate */ }
  }

  // Delete the application record AND consume the token.
  await env.ICEN_KV.delete(emailKey);
  await env.ICEN_KV.delete(tokenKey);

  const deletedAt = new Date().toISOString();
  try {
    await sendEmail(env.BREVO_API_KEY, {
      to: email,
      subject: `【削除完了】${appNo} / Deletion Completed`,
      text: fillTemplate(DELETE_DONE, refVars({ app_no: appNo, deleted_at: deletedAt })),
      senderEmail: env.ICEN_SENDER_EMAIL,
      senderName: env.ICEN_SENDER_NAME,
      replyTo: env.REPLY_TO_EMAIL,
    });
  } catch (e) {
    // Deletion already done; log but don't fail the request.
    console.error("delete-confirmation mail failed:", e);
  }

  return jsonResponse(
    {
      ok: true,
      message: "削除を完了いたしました。当該メールアドレスに関する記録は永久に失われました。",
      app_no: appNo,
      deleted_at: deletedAt,
    },
    200,
    origin,
  );
};
