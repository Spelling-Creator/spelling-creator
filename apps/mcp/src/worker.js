// Remote-transport pieces.
//
// The tool layer (tools.js) and API client (api.js) are transport-agnostic, so
// the same lessons-publishing surface also runs remotely, mounted as an MCP
// OAuth route on the existing Cloudflare Worker (apps/api) so any MCP client can
// connect over HTTP with a real "Connect" flow — no token ever pasted by hand.
// See apps/api/src/routes/mcp.js for the Worker-side wiring (the `HubMcp`
// McpAgent + OAuthProvider) and apps/api/src/routes/oauth.js for the consent
// flow that backs it. This module supplies the two remote-specific pieces:
//
//   1. `grantAuth` — hands api.js the Supabase access token carried by the MCP
//      access token the client sent with the current request, in the same
//      getAccessToken()/forceRefresh() shape the stdio provider has, so the
//      whole client works unchanged. It never refreshes anything itself:
//      Supabase refresh tokens are single-use, and the only thing allowed to
//      spend the grant's one is apps/api's `tokenExchangeCallback`.
//   2. `buildMcpServer` — construct a fully-wired McpServer for one connection,
//      given any auth provider (this one, or the stdio one from auth.js).
//
// Local stdio (stdio.js) remains the CLI-first path for users who'd rather run
// the server themselves; this is the additive one-click path for remote clients
// like claude.ai, Claude Desktop, and Cursor.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { createApi } from "./api.js";
import { registerTools, SERVER_INFO } from "./tools.js";
import { LESSON_STANDARDS } from "./standards.js";
import { jwtExpiry, nowSeconds } from "./auth.js";

/**
 * Auth provider for a remote connection (see apps/api/src/routes/mcp.js).
 *
 * `getProps` returns the props of the MCP access token on the request being
 * served, read fresh on every call because one connection outlives many of
 * those tokens. Each carries a Supabase access token minted when the client
 * last refreshed, which outlives the MCP token itself, so it is always still
 * good while the client is.
 *
 * There is deliberately no refresh here. If this spent the grant's Supabase
 * refresh token, the grant would be left holding a used one, Supabase would
 * see it come back on the client's next OAuth refresh, and revoke the whole
 * session, leaving a connection that stays "connected" but fails every call.
 * @param {() => { supabaseAccessToken?: string } | undefined} getProps
 */
export function grantAuth(getProps) {
  async function getAccessToken() {
    const accessToken = getProps()?.supabaseAccessToken;
    if (!accessToken) {
      throw new Error(
        "No Supabase session on this connection. Reconnect and approve access again.",
      );
    }
    const exp = jwtExpiry(accessToken);
    if (exp !== null && exp <= nowSeconds()) {
      throw new Error(
        "This connection's sign-in has expired. Reconnect and approve access again.",
      );
    }
    return accessToken;
  }

  // A 401 from the hub can't be fixed from here; let api.js report it.
  async function forceRefresh() {
    return null;
  }

  return { getAccessToken, forceRefresh };
}

/**
 * Where a connection remembers which live session it is in, backed by a
 * Durable Object's storage so it survives the object hibernating or being
 * evicted between tool calls (see collabTools.js for what is kept).
 * @param {{ get: Function, put: Function, delete: Function }} storage
 */
export function durableSessionStore(storage) {
  const KEY = "spelling-creator:collab-session";
  return {
    get: () => storage.get(KEY).then((v) => v || null),
    set: (handle) => storage.put(KEY, handle),
    clear: () => storage.delete(KEY).then(() => undefined),
  };
}

/**
 * Build a connection-scoped MCP server bound to an auth provider (either
 * `grantAuth` above, for remote, or `createAuth` from auth.js, for stdio).
 * @param {{ apiUrl: string, supabaseUrl: string, supabaseAnonKey: string }} config
 * @param {{ getAccessToken: Function, forceRefresh: Function }} auth
 * @param {{ sessionStore?: { get: Function, set: Function, clear: Function } }} [options]
 */
export function buildMcpServer(config, auth, { sessionStore } = {}) {
  const api = createApi(config, auth);
  const server = new McpServer(SERVER_INFO, {
    instructions: LESSON_STANDARDS,
  });
  registerTools(server, { api, config, sessionStore });
  return server;
}
