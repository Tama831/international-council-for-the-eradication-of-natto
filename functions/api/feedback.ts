// POST /api/feedback — generic feedback intake (translation fixes, bugs, suggestions).
// No data persistence; just relays to ICEN_ALERT_EMAIL via Brevo.

import {
  jsonResponse,
  corsHeaders,
  checkRateLimit,
  verifyTurnstile,
  sendEmail,
  maybeAlert,
} from "./_lib";

interface Env {
  ICEN_KV: KVNamespace;
  BREVO_API_KEY: string;
  ICEN_SENDER_EMAIL?: string;
  ICEN_SENDER_NAME?: string;
  ICEN_ALERT_EMAIL?: string;
  TURNSTILE_SECRET_KEY?: string;
}

const ALLOWED_CATEGORIES = new Set([
  "translation",
  "bug",
  "feedback",
  "other",
]);

const CATEGORY_LABEL: Record<string, string> = {
  translation: "翻訳の修正提案 / Translation correction",
  bug: "バグ報告 / Bug report",
  feedback: "感想・提案 / Comment / suggestion",
  other: "その他 / Other",
};

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const ip = request.headers.get("CF-Connecting-IP") || "";

  const rl = await checkRateLimit(env.ICEN_KV, ip, { limit: 3, windowSec: 3600, bucket: "rl-fb" });
  if (!rl.ok) {
    await maybeAlert(env, "rate-limit-fb", 5, `IP ${ip} hit /api/feedback rate limit (>3/h).`);
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

  // Honeypot
  if (typeof body.affiliation === "string" && body.affiliation.trim() !== "") {
    await maybeAlert(env, "honeypot-fb", 5, `Honeypot triggered on /api/feedback from IP ${ip}.`);
    return jsonResponse({ ok: true, message: "送信いたしました。" }, 200, origin);
  }

  const tsToken = String(body["cf-turnstile-response"] ?? "");
  const tsOk = await verifyTurnstile(tsToken, env.TURNSTILE_SECRET_KEY ?? "", ip);
  if (!tsOk) {
    await maybeAlert(env, "captcha-fail-fb", 30, `CAPTCHA failed for /api/feedback from IP ${ip}.`);
    return jsonResponse({ ok: false, detail: "captcha failed" }, 403, origin);
  }

  const category = String(body.category ?? "feedback").trim();
  if (!ALLOWED_CATEGORIES.has(category)) {
    return jsonResponse({ ok: false, detail: "invalid category" }, 400, origin);
  }

  const message = String(body.message ?? "").trim();
  if (!message || message.length < 5 || message.length > 4000) {
    return jsonResponse({ ok: false, detail: "message must be 5-4000 chars" }, 400, origin);
  }

  // Optional contact info; we DON'T store it, only echo it in the email body.
  const fromName = String(body.name ?? "").trim().slice(0, 100);
  const fromContact = String(body.contact ?? "").trim().slice(0, 200);
  const lang = String(body.lang ?? "").trim().slice(0, 30);

  const text = [
    `Category: ${CATEGORY_LABEL[category]}`,
    lang ? `Language tag: ${lang}` : "",
    fromName ? `From: ${fromName}` : "From: (anonymous)",
    fromContact ? `Reply-to (optional): ${fromContact}` : "",
    `IP hint: ${ip || "(unknown)"}`,
    "",
    "──── message ────",
    message,
    "──── end ────",
    "",
    "(This message was sent via the ICEN public feedback form.",
    " No data was stored; only this email was relayed.)",
  ].filter(Boolean).join("\n");

  try {
    if (!env.ICEN_ALERT_EMAIL) {
      console.error("feedback received but ICEN_ALERT_EMAIL not set — dropping");
      return jsonResponse({ ok: false, detail: "feedback channel not configured" }, 503, origin);
    }
    await sendEmail(env.BREVO_API_KEY, {
      to: env.ICEN_ALERT_EMAIL,
      subject: `[ICEN feedback] ${CATEGORY_LABEL[category]}${lang ? ` (${lang})` : ""}`,
      text,
      senderEmail: env.ICEN_SENDER_EMAIL,
      senderName: env.ICEN_SENDER_NAME,
      replyTo: fromContact && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fromContact) ? fromContact : undefined,
    });
  } catch (e) {
    console.error("feedback mail failed:", e);
    return jsonResponse({ ok: false, detail: "mail send failed" }, 502, origin);
  }

  return jsonResponse(
    {
      ok: true,
      message: "ご意見を受信いたしました。誠にありがとうございました。",
    },
    200,
    origin,
  );
};
