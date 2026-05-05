// POST /api/delete-request — initiate a deletion of a stored email record.
//
// Flow:
//   1. Receive {email}
//   2. If email exists in KV, generate a 32-byte token, store token→email
//      with 24h TTL, and email a confirmation link to that address.
//   3. If email does NOT exist, return success anyway (avoid enumeration).
//   4. Always rate-limit per IP (anti-abuse).

import {
  jsonResponse,
  corsHeaders,
  EMAIL_RE,
  newToken,
  checkRateLimit,
  verifyTurnstile,
  sendEmail,
  fillTemplate,
  refVars,
} from "./_lib";
import { DELETE_CONFIRM } from "./_templates";

interface Env {
  ICEN_KV: KVNamespace;
  BREVO_API_KEY: string;
  ICEN_SENDER_EMAIL?: string;
  ICEN_SENDER_NAME?: string;
  REPLY_TO_EMAIL?: string;
  TURNSTILE_SECRET_KEY?: string;
  ICEN_PUBLIC_BASE_URL?: string;
}

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const ip = request.headers.get("CF-Connecting-IP") || "";

  // Rate limit (per-IP, separate bucket from /api/apply).
  const rl = await checkRateLimit(env.ICEN_KV, ip, { limit: 5, windowSec: 3600, bucket: "rl-del" });
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

  // Optional Turnstile verification.
  const tsToken = String(body["cf-turnstile-response"] ?? "");
  const tsOk = await verifyTurnstile(tsToken, env.TURNSTILE_SECRET_KEY ?? "", ip);
  if (!tsOk) return jsonResponse({ ok: false, detail: "captcha failed" }, 403, origin);

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || email.length > 200 || !EMAIL_RE.test(email)) {
    return jsonResponse({ ok: false, detail: "invalid email" }, 400, origin);
  }

  // Generic success message — don't leak whether the email is in our DB.
  const genericOk = {
    ok: true,
    message: "削除請求を受け付けました。当該メールアドレスが当協議会の記録に存在する場合に限り、確認メールを送付いたします。",
  };

  const existingRaw = await env.ICEN_KV.get(`email:${email}`);
  if (!existingRaw) {
    return jsonResponse(genericOk, 200, origin);
  }

  // Token: 24h TTL. Store token -> email mapping.
  const token = newToken();
  await env.ICEN_KV.put(`del-token:${token}`, email, { expirationTtl: 86400 });

  const baseUrl = (env.ICEN_PUBLIC_BASE_URL ?? "https://natto-5hv.pages.dev").replace(/\/$/, "");
  const confirmUrl = `${baseUrl}/confirm-delete.html?t=${encodeURIComponent(token)}`;

  try {
    await sendEmail(env.BREVO_API_KEY, {
      to: email,
      subject: "【ICEN削除請求】確認のお願い / Confirm your deletion request",
      text: fillTemplate(DELETE_CONFIRM, refVars({ confirm_url: confirmUrl })),
      senderEmail: env.ICEN_SENDER_EMAIL,
      senderName: env.ICEN_SENDER_NAME,
      replyTo: env.REPLY_TO_EMAIL,
    });
  } catch (e) {
    console.error("delete-request mail failed:", e);
    return jsonResponse(
      { ok: false, detail: "mail send failed" },
      502,
      origin,
    );
  }

  return jsonResponse(genericOk, 200, origin);
};
