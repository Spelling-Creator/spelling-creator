// Signed-in sessions for the stub's people, in the shape supabase-js keeps in
// localStorage. The stub answers sign-in itself (see auth in routes.js), so a
// person can simply log in; these are for scripts that want a browser to start
// out signed in, such as Playwright recordings:
//
//   import { sessionFor, storageKey } from "@spelling-creator/stub-api/sessions";
//   await context.addInitScript(([k, v]) => localStorage.setItem(k, v), [
//     storageKey("https://api.stub.spelling-creator.localhost"),
//     JSON.stringify(sessionFor("daniel")),
//   ]);

import { PEOPLE } from "./people.js";

const b64url = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

// A long way off, so supabase-js never tries to refresh during a session.
const EXPIRES_AT = 4102444800; // 2100-01-01

/** A JWT-shaped access token naming the person. Unsigned: only the stub reads it. */
export function tokenFor(key) {
  const person = PEOPLE[key];
  if (!person) throw new Error(`No stub person called "${key}"`);
  return `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ sub: person.id, role: "authenticated", exp: EXPIRES_AT })}.stub`;
}

/** The session supabase-js would store after this person signed in. */
export function sessionFor(key) {
  const person = PEOPLE[key];
  if (!person) throw new Error(`No stub person called "${key}"`);
  return {
    access_token: tokenFor(key),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: EXPIRES_AT,
    refresh_token: `stub-refresh-${key}`,
    user: {
      id: person.id,
      aud: "authenticated",
      role: "authenticated",
      email: person.email,
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: { display_name: person.displayName },
      created_at: "2026-01-01T00:00:00Z",
    },
  };
}

/**
 * The localStorage key supabase-js keeps its session under, which it derives
 * from the Supabase URL's hostname (see packages/core/src/browser/supabase.js).
 */
export function storageKey(supabaseUrl) {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}
