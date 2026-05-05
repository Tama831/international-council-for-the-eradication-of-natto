// POST /api/x-debug — admin-only fingerprint check for X_* env vars.
// Returns first 4 + last 4 chars + length of each, so we can compare
// with X Developer Portal values WITHOUT exposing the secrets in chat.

import { jsonResponse, corsHeaders } from "./_lib";

interface Env {
  ICEN_ADMIN_KEY?: string;
  X_API_KEY?: string;
  X_API_KEY_SECRET?: string;
  X_ACCESS_TOKEN?: string;
  X_ACCESS_TOKEN_SECRET?: string;
}

function fp(v: string | undefined): string | null {
  if (!v) return null;
  if (v.length <= 8) return `(len=${v.length}) ${v[0]}…${v.slice(-1)}`;
  return `(len=${v.length}) ${v.slice(0, 4)}…${v.slice(-4)}`;
}

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const expected = env.ICEN_ADMIN_KEY ? `Bearer ${env.ICEN_ADMIN_KEY}` : "";
  if (!expected || request.headers.get("Authorization") !== expected) {
    return jsonResponse({ ok: false, detail: "unauthorized" }, 401, null);
  }
  return jsonResponse({
    ok: true,
    fingerprints: {
      X_API_KEY:             fp(env.X_API_KEY),
      X_API_KEY_SECRET:      fp(env.X_API_KEY_SECRET),
      X_ACCESS_TOKEN:        fp(env.X_ACCESS_TOKEN),
      X_ACCESS_TOKEN_SECRET: fp(env.X_ACCESS_TOKEN_SECRET),
    },
    note: "Compare each (len=N, first4…last4) with the corresponding value visible in X Developer Portal > Keys and tokens. Trailing whitespace will show up in the length.",
  }, 200, null);
};
