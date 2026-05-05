// POST /api/auto-post — admin endpoint that publishes a tweet to X.
//
// Auth:  Authorization: Bearer ${ICEN_ADMIN_KEY}
// Body:  {"text": "..."}     (≤280 weighted-chars; caller is responsible)
//
// Required env (all CF Pages Secrets):
//   ICEN_ADMIN_KEY        — long random shared secret with the Hetzner cron
//   X_API_KEY             — Consumer Key  (a.k.a. API Key)
//   X_API_KEY_SECRET      — Consumer Secret
//   X_ACCESS_TOKEN        — User access token
//   X_ACCESS_TOKEN_SECRET — User access token secret

import { jsonResponse, corsHeaders } from "./_lib";

interface Env {
  ICEN_KV: KVNamespace;
  ICEN_ADMIN_KEY?: string;
  X_API_KEY?: string;
  X_API_KEY_SECRET?: string;
  X_ACCESS_TOKEN?: string;
  X_ACCESS_TOKEN_SECRET?: string;
}

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // 1. Auth
  const expected = env.ICEN_ADMIN_KEY ? `Bearer ${env.ICEN_ADMIN_KEY}` : "";
  if (!expected || request.headers.get("Authorization") !== expected) {
    return jsonResponse({ ok: false, detail: "unauthorized" }, 401, null);
  }

  // 2. Validate env
  const k1 = env.X_API_KEY, k2 = env.X_API_KEY_SECRET, k3 = env.X_ACCESS_TOKEN, k4 = env.X_ACCESS_TOKEN_SECRET;
  if (!k1 || !k2 || !k3 || !k4) {
    return jsonResponse({ ok: false, detail: "X_* keys not configured" }, 500, null);
  }

  // 3. Body
  let body: { text?: string; idempotency_key?: string };
  try { body = await request.json(); }
  catch { return jsonResponse({ ok: false, detail: "invalid JSON" }, 400, null); }
  const text = String(body.text || "").trim();
  if (!text || text.length > 4000) {
    return jsonResponse({ ok: false, detail: "text required, max 4000 chars" }, 400, null);
  }

  // 4. Idempotency: if caller passes a key, refuse to post the same one twice within 24h.
  if (body.idempotency_key) {
    const seenKey = `tweet-idem:${body.idempotency_key}`;
    const seen = await env.ICEN_KV.get(seenKey);
    if (seen) {
      return jsonResponse({ ok: true, deduped: true, tweet_id: seen, idempotency_key: body.idempotency_key }, 200, null);
    }
  }

  // 5. OAuth 1.0a sign + post
  let tweetId: string;
  try {
    tweetId = await postTweet({ k1, k2, k3, k4 }, text);
  } catch (e) {
    console.error("X post failed:", e);
    return jsonResponse({ ok: false, detail: `x post failed: ${e instanceof Error ? e.message : String(e)}` }, 502, null);
  }

  if (body.idempotency_key) {
    await env.ICEN_KV.put(`tweet-idem:${body.idempotency_key}`, tweetId, { expirationTtl: 86400 });
  }
  return jsonResponse({ ok: true, tweet_id: tweetId }, 200, null);
};

// ─── OAuth 1.0a + X API v2 ───────────────────────────────────────────

interface Keys { k1: string; k2: string; k3: string; k4: string }

function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) =>
    "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function hmacSha1(keyStr: string, baseStr: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(keyStr),
    { name: "HMAC", hash: "SHA-1" },
    false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(baseStr));
  return bytesToBase64(new Uint8Array(sig));
}

async function postTweet(keys: Keys, text: string): Promise<string> {
  const url = "https://api.x.com/2/tweets";
  const method = "POST";

  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = Array.from(nonceBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: keys.k1,
    oauth_token: keys.k3,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_nonce: nonce,
    oauth_version: "1.0",
  };

  // For v2 endpoints with JSON body, the JSON body is NOT included in the
  // signature base string — only the OAuth params and any URL query params.
  const sortedParams = Object.entries(oauthParams)
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const baseString = `${method}&${rfc3986(url)}&${rfc3986(sortedParams)}`;
  const signingKey = `${rfc3986(keys.k2)}&${rfc3986(keys.k4)}`;
  oauthParams.oauth_signature = await hmacSha1(signingKey, baseString);

  const authHeader = "OAuth " + Object.entries(oauthParams)
    .map(([k, v]) => `${rfc3986(k)}="${rfc3986(v)}"`)
    .join(", ");

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  const respText = await r.text();
  if (!r.ok) {
    throw new Error(`HTTP ${r.status}: ${respText.slice(0, 300)}`);
  }
  let parsed: { data?: { id?: string } };
  try { parsed = JSON.parse(respText); } catch { throw new Error(`bad JSON: ${respText.slice(0, 200)}`); }
  return parsed.data?.id || "(unknown)";
}
