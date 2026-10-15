---
title: Remote (hosted) mode
---

# Remote (hosted) mode

For the steps a user follows to connect, see
[Connect an AI assistant](../../guide/ai-assistants/connect.md).

An MCP client pointed at `https://spellingcreator.org/mcp` connects over
Streamable HTTP with a real OAuth 2.1 flow: no token to copy, paste or store.
This is the recommended way to connect any client that supports remote MCP
servers (claude.ai, Claude Desktop, Cursor and others); the local
[stdio setup](./setup.md) remains the path for development and for clients that
only run local servers.

## How it works

1. The client discovers the server's OAuth metadata and registers itself
   automatically (RFC 7591 Dynamic Client Registration at `/register`), so there
   is nothing to set up on the user's end.
2. It opens the user's browser at `/authorize`. The Worker parses the request,
   stores it in KV under a random, single-use state token that lives for 10
   minutes, and redirects to an ordinary page of the web app,
   `/oauth/authorize?state=…`. If the user isn't signed in, that page offers the
   same magic-link sign-in as `/login`, with the link routed back to the same
   page and the email's code accepted in place.
3. The consent screen shows which client is connecting and what it can do, and
   the user chooses **Approve** or **Deny**. Approving requires a display name;
   without one the Worker answers 403.
4. The client receives its own access/refresh token pair (scope `lessons`) and
   starts calling tools. No Supabase token is ever shown to the user or passed
   to the client; the grant holds the user's Supabase session and the server
   calls the hub's normal endpoints with it.

The tool layer (`src/tools.js`) and API client (`src/api.js`) are the exact same
code the [stdio server](./setup.md) uses: the same tools, the same validation,
the same author attribution. That includes the [live session](./live-sessions.md)
tools: `HubMcp` hibernates between tool calls and rebuilds its server on the way
back, so the one thing those tools must remember (which session the connection
is in) is kept in the Durable Object's own storage rather than in the server.

There is no page in the web app that lists or revokes a user's grants yet. A
user disconnects by removing the connector in their client.

## Worker-side implementation

The whole thing is implemented in `apps/api`, not `apps/mcp`; the MCP package
only supplies the remote-specific pieces the Worker composes:

- **`src/worker.js`** (`@spelling-creator/mcp/worker`): `buildMcpServer`
  (build a connection-scoped `McpServer` given any auth provider), `grantAuth`
  (an auth provider that reads the Supabase access token from the current
  request's MCP token, with the same `getAccessToken()`/`forceRefresh()` shape
  the stdio auth provider has, but which never refreshes anything) and
  `durableSessionStore` (the live-session handle, kept in a Durable Object's
  storage so it survives hibernation).
- **`src/auth.js`** (`@spelling-creator/mcp/auth`): `refreshSupabaseSession`,
  the plain Supabase refresh-token exchange shared by the stdio server and the
  Worker's token refresh (below).

On the Worker side (`apps/api`):

- **`src/routes/mcp.js`** wires up
  [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider)
  with `HubMcp` (an `McpAgent` from the Cloudflare Agents SDK, one per MCP
  connection) as the `/mcp` API handler, and the existing Hono `app` as the
  `defaultHandler` for everything else. `src/index.js` builds this
  `OAuthProvider` per request (cheap, no I/O) so its callback can close over the
  request's `env`. Supabase is the upstream identity: a grant's `props` carry a
  Supabase session captured at consent time, and a `tokenExchangeCallback`
  rotates it in step with the MCP client's own OAuth token refresh. MCP access
  tokens live 45 minutes (`MCP_ACCESS_TOKEN_TTL`), a little shorter than
  Supabase's roughly one-hour JWT, so the Supabase access token an MCP token
  carries is still good for as long as the MCP token is.

  That callback is the only code that spends the Supabase refresh token, and it
  stays in the grant: each MCP access token carries the Supabase access token
  alone. Supabase refresh tokens are single-use, and when a used one is sent
  again Supabase treats it as stolen and revokes the whole session. So if the
  Durable Object refreshed on its own, the grant would be left holding a used
  token, the client's next refresh would kill the session, and the connector
  would stay "connected" while every tool call failed until the user
  reconnected by hand. For the same reason `HubMcp` overrides `setName` (the
  call every request reaches it through) to pick up the props of each new MCP
  token, since `McpAgent` on its own only reads them when the object starts.
  When the session can never refresh again (the grant has no refresh token,
  or Supabase answers with one of the codes `sessionHasEnded` in
  `src/auth.js` lists, such as `refresh_token_already_used`), the callback
  answers `invalid_grant` rather than a 500, so the client asks the user to
  reconnect instead of retrying. Other failures, such as Supabase being
  unreachable or rejecting the anon key, stay 500s, because they say nothing
  about the user's session and making everyone reconnect would not fix them.

- **`src/routes/oauth.js`** implements the consent flow's three endpoints:
  `GET /authorize` (parse the client's request, stash it, redirect to the
  consent page), `GET /oauth/request` (the consent page's data for a state
  token: client name, redirect URI, scope) and `POST /oauth/approve` (verify the
  user's Supabase session and display name, then complete the authorization with
  the session as the grant's `props`). They're registered on the Hono app by
  `registerOAuthConsentRoutes`. `/token`, `/register` and the discovery metadata
  are implemented by the OAuthProvider library.
- The consent page is `apps/web/src/pages/OAuthAuthorizePage.jsx`, an ordinary
  route (`/oauth/authorize`) of the SPA. It calls the two `/oauth/*` endpoints
  through `@spelling-creator/core/mcpOAuth`.

### Infrastructure

Deploying this needs a KV namespace for the OAuth provider's grant, token and
client storage (also used for the consent flow's short-lived pending-request
state, reached through `oauthStateStore` in `src/platform/`) and a Durable
Object binding for `HubMcp`. Both are declared in `apps/api/wrangler.jsonc`:

- `kv_namespaces`: `OAUTH_KV`, already filled in for production. For your own
  Cloudflare account, create one with `wrangler kv namespace create OAUTH_KV`
  and put the returned id there.
- `durable_objects`: `MCP_OBJECT` bound to the `HubMcp` class (the binding name
  `McpAgent.serve()` looks for by default), with its SQLite migration (tag
  `v2`).

No new secrets are needed. Approving reuses `verifySupabaseUser` (which uses the
existing `SUPABASE_SERVICE_ROLE_KEY` secret), and the server's config
(`mcpConfig` in `src/routes/mcp.js`) reads the `SUPABASE_URL`,
`SUPABASE_ANON_KEY` and `SPELLING_CREATOR_API_URL` vars already in
`wrangler.jsonc`.

The remote endpoint ships with the Worker: the deploy workflow
(`.github/workflows/deploy.yml`) runs on pushes to `main` that touch
`apps/mcp/**` among other paths, so a change to the tools reaches
`spellingcreator.org/mcp` on the next deploy. The `.mcpb` bundle, by contrast,
is released by hand (see [Packaging the bundle](./packaging.md)).

The Node entry point for [self-hosting](../self-hosting.md)
(`apps/api/src/node/server.js`) doesn't serve `/mcp`, since it needs Durable
Objects; self-hosters use the stdio server instead.

### A note on the `agents` dependency

`apps/api` depends on `agents` (the Cloudflare Agents SDK, for `McpAgent`) and
`@cloudflare/workers-oauth-provider`. One of `agents`' own transitive
dependencies, `@cfworker/json-schema`, probes `self.location` at module load to
pick a default base URI and throws on Workers' `location` global under this
Worker's compatibility settings, crashing the whole Worker before any request
is handled. Because the crash happens while Cloudflare evaluates the script's
top-level scope, the _upload_ fails too, with error code 10021: the deploy never
produces a broken version, it just refuses.

This is patched via `pnpm patch` to fall back to the library's own safe default
instead of throwing; `pnpm install` applies it automatically.

Three patches are needed, not one, because two of `agents`' other dependencies
**inline** their own copy of `@cfworker/json-schema` into their published
bundles. A `patchedDependencies` entry only rewrites the package pnpm installs,
so it cannot reach a copy baked into someone else's `dist/`:

| Patch                                               | Fixes                                           |
| --------------------------------------------------- | ----------------------------------------------- |
| `patches/@cfworker__json-schema@4.1.1.patch`        | the real package                                |
| `patches/@modelcontextprotocol__client@2.0.0.patch` | its copy in `dist/cfWorkerProvider-*.{mjs,cjs}` |
| `patches/@modelcontextprotocol__server@2.0.0.patch` | its copy in `dist/cfWorkerProvider-*.{mjs,cjs}` |

All three are registered under `patchedDependencies` in `pnpm-workspace.yaml`.

Two traps when this resurfaces after a dependency bump. First, the stack trace
points at a path like
`node_modules/.pnpm/@modelcontextprotocol+client@2.0.0/node_modules/node_modules/.pnpm/@cfworker+json-schema@4.1.1/…`
that does not exist in your tree; it is a sourcemap path from the upstream
package's own build machine, and it is what gives the inlining away. Second, the
patched copies live in `.pnpm` directories carrying a `_patch_hash=` suffix, so
a path _without_ that suffix is an unpatched copy.

To check the fix actually reaches the shipped bundle rather than trusting the
install, bundle the Worker (the same dry run CI does, written to
`apps/api/dist`; like CI, it needs the web app built first) and search the
output; every hit should be inside a `try`:

```bash
pnpm --filter @spelling-creator/api bundle
rg -c 'initialBaseURI[0-9]* = typeof self' apps/api/dist/index.js   # expect no matches
```
