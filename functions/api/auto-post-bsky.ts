// POST /api/auto-post-bsky — admin endpoint for cross-posting to Bluesky.
//
// Activated only when BSKY_HANDLE + BSKY_APP_PASSWORD are set in CF Pages env.
// Same auth as /api/auto-post: Authorization: Bearer ${ICEN_ADMIN_KEY}.
//
// Body: {"text": "..."}   (graphemes ≤ 300; the AT Protocol limit)
//
// Bluesky posting flow:
//   1. POST  https://bsky.social/xrpc/com.atproto.server.createSession
//      body: {identifier: handle, password: appPassword}
//      → { accessJwt, did, ... }
//   2. POST  https://bsky.social/xrpc/com.atproto.repo.createRecord
//      auth: Bearer accessJwt
//      body: {repo: did, collection: "app.bsky.feed.post", record: {$type, text, createdAt}}

import { jsonResponse, corsHeaders } from "./_lib";

interface Env {
  ICEN_KV: KVNamespace;
  ICEN_ADMIN_KEY?: string;
  BSKY_HANDLE?: string;        // e.g. icen.bsky.social
  BSKY_APP_PASSWORD?: string;  // generated under Settings > App Passwords
}

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const expected = env.ICEN_ADMIN_KEY ? `Bearer ${env.ICEN_ADMIN_KEY}` : "";
  if (!expected || request.headers.get("Authorization") !== expected) {
    return jsonResponse({ ok: false, detail: "unauthorized" }, 401, null);
  }
  if (!env.BSKY_HANDLE || !env.BSKY_APP_PASSWORD) {
    return jsonResponse({ ok: false, detail: "BSKY_HANDLE / BSKY_APP_PASSWORD not configured" }, 503, null);
  }

  let body: { text?: string; idempotency_key?: string };
  try { body = await request.json(); }
  catch { return jsonResponse({ ok: false, detail: "invalid JSON" }, 400, null); }
  const text = String(body.text || "").trim();
  if (!text || text.length > 3000) {
    return jsonResponse({ ok: false, detail: "text required, max 3000 chars" }, 400, null);
  }

  if (body.idempotency_key) {
    const seenKey = `bsky-idem:${body.idempotency_key}`;
    const seen = await env.ICEN_KV.get(seenKey);
    if (seen) {
      return jsonResponse({ ok: true, deduped: true, uri: seen, idempotency_key: body.idempotency_key }, 200, null);
    }
  }

  // 1. Create session
  let session: { accessJwt?: string; did?: string };
  try {
    const r = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: env.BSKY_HANDLE, password: env.BSKY_APP_PASSWORD }),
    });
    if (!r.ok) {
      const t = (await r.text()).slice(0, 300);
      return jsonResponse({ ok: false, detail: `bsky session: HTTP ${r.status}: ${t}` }, 502, null);
    }
    session = await r.json();
  } catch (e) {
    return jsonResponse({ ok: false, detail: `bsky session failed: ${e instanceof Error ? e.message : String(e)}` }, 502, null);
  }
  if (!session.accessJwt || !session.did) {
    return jsonResponse({ ok: false, detail: "bsky session missing accessJwt/did" }, 502, null);
  }

  // 2. Create post record
  const createdAt = new Date().toISOString();
  let postUri: string;
  try {
    const r = await fetch("https://bsky.social/xrpc/com.atproto.repo.createRecord", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.accessJwt}`,
      },
      body: JSON.stringify({
        repo: session.did,
        collection: "app.bsky.feed.post",
        record: {
          $type: "app.bsky.feed.post",
          text,
          createdAt,
        },
      }),
    });
    if (!r.ok) {
      const t = (await r.text()).slice(0, 300);
      return jsonResponse({ ok: false, detail: `bsky post: HTTP ${r.status}: ${t}` }, 502, null);
    }
    const j = (await r.json()) as { uri?: string };
    postUri = j.uri || "(unknown)";
  } catch (e) {
    return jsonResponse({ ok: false, detail: `bsky post failed: ${e instanceof Error ? e.message : String(e)}` }, 502, null);
  }

  if (body.idempotency_key) {
    await env.ICEN_KV.put(`bsky-idem:${body.idempotency_key}`, postUri, { expirationTtl: 86400 });
  }
  return jsonResponse({ ok: true, uri: postUri }, 200, null);
};
