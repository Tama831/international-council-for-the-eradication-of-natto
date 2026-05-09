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

/**
 * Common disposable / temporary email domains. Conservative list — extend if needed.
 */
const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  "mailinator.com", "mailinator.net", "mailinator2.com", "mailinator.org",
  "guerrillamail.com", "guerrillamail.org", "guerrillamail.net", "guerrillamail.biz", "guerrillamail.de",
  "guerrillamailblock.com", "grr.la", "sharklasers.com", "pokemail.net", "spam4.me",
  "10minutemail.com", "10minutemail.net", "10minutemail.org",
  "temp-mail.org", "temp-mail.io", "temp-mail.ru", "tempmail.dev", "tmpmail.org",
  "yopmail.com", "yopmail.fr", "yopmail.net",
  "maildrop.cc", "trashmail.com", "throwawaymail.com", "throwam.com",
  "discard.email", "discardmail.com", "discardmail.de",
  "mailcatch.com", "maildump.org", "minutemail.com",
  "mt2014.com", "moakt.com", "emailondeck.com", "emltmp.com",
  "inboxbear.com", "fakeinbox.com", "tempinbox.com",
  "spamgourmet.com", "spambox.us", "spamfree24.org",
  "getairmail.com", "dispostable.com",
]);

export function isDisposableEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  return DISPOSABLE_DOMAINS.has(email.slice(at + 1).toLowerCase());
}

/**
 * Verify recipient domain has at least one MX record (or A record fallback per RFC 5321).
 * Uses Cloudflare's DNS-over-HTTPS at 1.1.1.1. Caches positive results for 24h.
 *
 * Returns true if mail can probably be delivered to this domain, false otherwise.
 */
export async function checkDomainCanReceive(
  kv: KVNamespace,
  email: string,
): Promise<boolean> {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  if (!domain || !/^[a-z0-9.-]+$/.test(domain)) return false;

  const cacheKey = `mxok:${domain}`;
  const cached = await kv.get(cacheKey);
  if (cached === "1") return true;
  if (cached === "0") return false;

  async function dohQuery(type: "MX" | "A"): Promise<unknown[]> {
    const r = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`,
      { headers: { Accept: "application/dns-json" } },
    );
    if (!r.ok) return [];
    const j = (await r.json()) as { Answer?: unknown[] };
    return j.Answer ?? [];
  }

  let ok = (await dohQuery("MX")).length > 0;
  if (!ok) ok = (await dohQuery("A")).length > 0; // RFC 5321 fallback

  await kv.put(cacheKey, ok ? "1" : "0", {
    expirationTtl: ok ? 86400 : 600, // cache positives 24h, negatives 10min
  });
  return ok;
}

/**
 * Per-recipient daily email cap. Returns true if we can send another email
 * to this recipient today; false if the daily cap has been hit.
 *
 * Uses a UTC-day bucket. Default: 5 emails/recipient/day.
 */
export async function checkRecipientThrottle(
  kv: KVNamespace,
  email: string,
  opts: { limit?: number } = {},
): Promise<boolean> {
  const limit = opts.limit ?? 5;
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key = `recip:${email}:${day}`;
  const cur = parseInt((await kv.get(key)) || "0", 10);
  if (cur >= limit) return false;
  await kv.put(key, String(cur + 1), { expirationTtl: 172800 }); // 2 days
  return true;
}

/**
 * Generate a satirical-looking but unguessable application number from email.
 * Format: ICEN-A-YYYY-XXXX  where XXXX is the first 4 hex chars of HMAC-SHA256(salt, email).
 *
 * Falls back to sequential numbering if salt is empty (backwards compat).
 */
export async function makeAppNumber(
  email: string,
  year: number,
  salt: string,
  fallbackSeq?: number,
): Promise<string> {
  if (!salt) {
    const seq = fallbackSeq ?? 1;
    return `ICEN-A-${year}-${String(seq).padStart(4, "0")}`;
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(email));
  const hex = Array.from(new Uint8Array(sig).slice(0, 2))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `ICEN-A-${year}-${hex}`;
}

/**
 * One-way HMAC-SHA256 hash of an email address using a server-side salt.
 * Used as the KV storage key so the persistent store NEVER contains the
 * plaintext email — even the site operator cannot enumerate the member list.
 *
 * Returns 64-char hex. Returns the input lowercased+trimmed plaintext as
 * a fallback if the salt is empty (legacy mode, for backwards compat).
 */
export async function hashEmail(email: string, salt: string): Promise<string> {
  const norm = email.toLowerCase().trim();
  if (!salt) return norm; // legacy: store plaintext key when salt unset
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(norm));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Build the KV key for an email record. Hashed if salt is set. */
export function emailKey(hashOrEmail: string, salted: boolean): string {
  return salted ? `emailh:${hashOrEmail}` : `email:${hashOrEmail}`;
}

/** Default retention: 90 days. Refreshed on every interaction (apply / repeat). */
export const EMAIL_RECORD_TTL_SEC = 90 * 24 * 3600;

/** Substitute {{key}} placeholders in a template string. */
export function fillTemplate(tpl: string, vars: Record<string, string>): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v);
  }
  return out;
}

/** Returns Q1..Q4 for the given date based on UTC month. */
export function quarterOf(d: Date = new Date()): string {
  return "Q" + (Math.floor(d.getUTCMonth() / 3) + 1);
}

/** Build the standard set of dynamic placeholder values for email refs. */
export function refVars(extra: Record<string, string> = {}): Record<string, string> {
  const now = new Date();
  return {
    year: String(now.getUTCFullYear()),
    quarter: quarterOf(now),
    ...extra,
  };
}

/**
 * Hourly threshold-based alerting. Increments counter for {topic} in current
 * UTC-hour bucket. If counter crosses {threshold}, sends one alert email
 * (deduped per hour via a "alert-sent" marker). Bypasses recipient throttle.
 *
 * Usage example:
 *   await maybeAlert(env, "captcha-fail", 20, `CAPTCHA failed by ${ip}`);
 */
export async function maybeAlert(
  env: {
    ICEN_KV: KVNamespace;
    BREVO_API_KEY: string;
    ICEN_ALERT_EMAIL?: string;
    ICEN_SENDER_EMAIL?: string;
    ICEN_SENDER_NAME?: string;
  },
  topic: string,
  threshold: number,
  detail: string,
): Promise<void> {
  const alertEmail = env.ICEN_ALERT_EMAIL;
  if (!alertEmail) return; // no alert recipient configured — skip
  const hour = Math.floor(Date.now() / 1000 / 3600);
  const counterKey = `alert-cnt:${topic}:${hour}`;
  const sentKey = `alert-sent:${topic}:${hour}`;

  const cur = parseInt((await env.ICEN_KV.get(counterKey)) || "0", 10);
  const next = cur + 1;
  await env.ICEN_KV.put(counterKey, String(next), { expirationTtl: 7200 });

  if (next < threshold) return;
  if (await env.ICEN_KV.get(sentKey)) return; // already alerted this hour

  const hourLabel = new Date().toISOString().slice(0, 13) + ":00 UTC";
  const text = `ICEN backend alert.

Topic:     ${topic}
Threshold: ${threshold}/hour
Observed:  ${next} events in ${hourLabel}

Detail:
  ${detail}

Inspect:
  https://dash.cloudflare.com/?to=/:account/pages/view/natto/deployments
  Cloudflare > Workers & Pages > natto > Functions > Real-time logs

(This alert is silenced for the rest of the hour to avoid spam. Next alert
on this topic can fire after the hour rolls over.)
`;
  try {
    await sendEmail(env.BREVO_API_KEY, {
      to: alertEmail,
      subject: `[ICEN ALERT] ${topic} threshold crossed (${next}/h)`,
      text,
      senderEmail: env.ICEN_SENDER_EMAIL,
      senderName: env.ICEN_SENDER_NAME,
    });
    await env.ICEN_KV.put(sentKey, "1", { expirationTtl: 7200 });
  } catch (e) {
    console.error("alert send failed:", e);
  }
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
  const senderEmail = opts.senderEmail;
  if (!senderEmail) {
    throw new Error("sendEmail: senderEmail is required (set ICEN_SENDER_EMAIL env var)");
  }
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
