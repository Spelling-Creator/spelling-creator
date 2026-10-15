// The Worker's token endpoint makes a client reconnect only when Supabase says
// the session itself is over. These pin down how a refusal is read: GoTrue's
// error_code decides, never the HTTP status alone, because a bad anon key is a
// 4xx too and has nothing to do with anyone's session.

import { test } from "node:test";
import assert from "node:assert/strict";

import { refreshSupabaseSession, sessionHasEnded } from "../src/auth.js";

const config = {
  supabaseUrl: "https://example.supabase.co",
  supabaseAnonKey: "anon",
};

function refuseWith(t, status, body) {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(body, { status }),
  );
}

test("a reused refresh token reads as an ended session", async (t) => {
  refuseWith(
    t,
    400,
    JSON.stringify({
      code: 400,
      error_code: "refresh_token_already_used",
      msg: "Invalid Refresh Token: Already Used",
    }),
  );
  const error = await refreshSupabaseSession(config, "used").catch((e) => e);
  assert.equal(error.status, 400);
  assert.equal(error.errorCode, "refresh_token_already_used");
  assert.equal(sessionHasEnded(error), true);
});

test("a rejected anon key does not", async (t) => {
  refuseWith(t, 401, JSON.stringify({ message: "Invalid API key" }));
  const error = await refreshSupabaseSession(config, "fine").catch((e) => e);
  assert.equal(error.status, 401);
  assert.equal(sessionHasEnded(error), false);
});

test("nor does a refusal that isn't JSON", async (t) => {
  refuseWith(t, 502, "Bad Gateway");
  const error = await refreshSupabaseSession(config, "fine").catch((e) => e);
  assert.equal(error.errorCode, undefined);
  assert.equal(sessionHasEnded(error), false);
});
