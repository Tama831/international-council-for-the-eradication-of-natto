// Shared helpers: CORS, JSON, rate limit, Turnstile verification.

export const ALLOWED_ORIGINS = new Set([
  "https://tama831.github.io",
  "https://natto-5hv.pages.dev",
]);

export function corsHeaders(originHeader: string | null): Record<string, string> {
  const allowed = originHeader && ALLOWED_ORIGINS.has(originHeader) ? originHeader : "*";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
    },
  });
}

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Hex-encode an ArrayBuffer. */
function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Generate a 32-byte random hex token (64 chars). */
export function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return hex(bytes.buffer);
}

/**
 * Per-IP rate limiter using a sliding fixed-window in KV.
 * Returns true if the request is allowed; false if rate-limited.
 *
 * Default: 5 requests per IP per hour.
 */
export async function checkRateLimit(
  kv: KVNamespace,
  ip: string,
  opts: { limit?: number; windowSec?: number; bucket?: string } = {},
): Promise<{ ok: boolean; remaining: number }> {
  const limit = opts.limit ?? 5;
  const windowSec = opts.windowSec ?? 3600;
  const bucket = opts.bucket ?? "rl";
  if (!ip) return { ok: true, remaining: limit }; // best effort
  const window = Math.floor(Date.now() / 1000 / windowSec);
  const key = `${bucket}:${ip}:${window}`;
  const cur = parseInt((await kv.get(key)) || "0", 10);
  if (cur >= limit) return { ok: false, remaining: 0 };
  await kv.put(key, String(cur + 1), { expirationTtl: windowSec * 2 });
  return { ok: true, remaining: limit - (cur + 1) };
}

/**
 * Verify a Cloudflare Turnstile token. No-op (returns true) if secret is empty,
 * so the feature can be enabled later by setting TURNSTILE_SECRET_KEY env var.
 */
export async function verifyTurnstile(
  token: string,
  secret: string,
  ip: string,
): Promise<boolean> {
  if (!secret) return true; // disabled
  if (!token) return false;
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret, response: token, remoteip: ip || "" }),
  });
  if (!r.ok) return false;
  const j = (await r.json()) as { success?: boolean };
  return !!j.success;
}

/** Send a transactional email via Brevo. Throws on non-2xx. */
export async function sendEmail(
  apiKey: string,
  opts: {
    to: string;
    subject: string;
    text: string;
    senderEmail?: string;
    senderName?: string;
    replyTo?: string;
  },
): Promise<void> {
  const senderEmail = opts.senderEmail ?? "ly.renum@gmail.com";
  const senderName = opts.senderName ?? "国際納豆撲滅協議会 事務局 / ICEN Secretariat";
  const replyTo = opts.replyTo ?? senderEmail;
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: opts.to }],
      replyTo: { email: replyTo },
      subject: opts.subject,
      textContent: opts.text,
    }),
  });
  if (!r.ok) {
    const t = (await r.text()).slice(0, 400);
    throw new Error(`Brevo ${r.status}: ${t}`);
  }
}
