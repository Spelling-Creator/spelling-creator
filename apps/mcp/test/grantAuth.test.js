// grantAuth is the remote connection's auth provider. It must read the props
// fresh on every call (one connection outlives many MCP access tokens) and must
// never spend a Supabase refresh token, because the grant's copy is single-use
// and belongs to the Worker's tokenExchangeCallback.

import { test } from "node:test";
import assert from "node:assert/strict";

import { grantAuth } from "../src/worker.js";

const jwt = (exp) =>
  `x.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.y`;
const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

test("hands back whichever access token the current props carry", async () => {
  let props = { supabaseAccessToken: jwt(inAnHour()) };
  const auth = grantAuth(() => props);
  assert.equal(await auth.getAccessToken(), props.supabaseAccessToken);

  props = { supabaseAccessToken: jwt(inAnHour() + 60) };
  assert.equal(await auth.getAccessToken(), props.supabaseAccessToken);
});

test("never refreshes, even with a refresh token in reach", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("grantAuth must not make network calls");
  });
  const auth = grantAuth(() => ({
    supabaseAccessToken: jwt(Math.floor(Date.now() / 1000) - 10),
    supabaseRefreshToken: "single-use",
  }));

  await assert.rejects(auth.getAccessToken(), /expired/);
  assert.equal(await auth.forceRefresh(), null);
  assert.equal(fetch.mock.callCount(), 0);
});

test("asks for a reconnect when there is no session at all", async () => {
  await assert.rejects(
    grantAuth(() => undefined).getAccessToken(),
    /Reconnect/,
  );
});
