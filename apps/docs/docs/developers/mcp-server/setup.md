---
title: Local setup
description: "Running the stdio MCP server locally: installing, signing in for a Supabase session, and pointing Claude Desktop or Claude Code at it."
---

# Local setup (stdio)

For the ways a user connects, including the hosted connector, see
[Connect an AI assistant](../../guide/ai-assistants/connect.md).

If a client supports remote MCP servers (claude.ai, Claude Desktop, Cursor and
others), connecting to `https://spellingcreator.org/mcp` is simpler: add it,
approve in the browser, done, with no token to manage. See
[Remote (hosted) mode](./remote-mode.md). The steps below are for running the
server yourself over stdio, for local development, a client that only supports
local servers, or a [self-hosted](../self-hosting.md) API (which doesn't serve
`/mcp`).

## 1. Install

From the monorepo root:

```bash
pnpm install
```

## 2. Sign in (get a token)

Publishing happens as a real hub user, so the server needs a Supabase session.
The account also needs a **display name** (set it once in the web app's
Settings) or publishing is rejected.

```bash
pnpm --filter @spelling-creator/mcp login   # or, from the root: pnpm mcp:login
```

This emails a one-time code, verifies it, and saves a session to
`~/.config/spelling-creator-mcp/session.json` (or under `$XDG_CONFIG_HOME`, or
wherever `SPELLING_CREATOR_SESSION_FILE` points), written with `0600`
permissions. The server reads that file and **auto-refreshes** the short-lived
access token, writing each rotated refresh token back, so it keeps working for
weeks.

> If the sign-in email shows only a magic _link_ and no code, run
> `pnpm --filter @spelling-creator/mcp login -- --paste` instead and paste the
> whole value of the web app's `sb-…-auth-token` localStorage entry (DevTools,
> Application, Local Storage). The helper pulls `access_token` and
> `refresh_token` out of the JSON for you, including the `base64-` prefixed
> form Supabase sometimes stores.

Alternatively, skip the helper and provide a token through the environment:
`SUPABASE_REFRESH_TOKEN` (long-lived, recommended) or `SUPABASE_ACCESS_TOKEN`
(expires in about an hour). See [Configuration](./configuration.md) for how
these interact with the session file.

The server starts without any credentials. Tools that need the hub then fail
with a message saying to sign in, while `create_lesson_file` and `validate_lesson` on
`sections` (both entirely local) still work.

## 3. Connect your assistant

The server runs over stdio. Point the MCP client at `apps/mcp/src/stdio.js`.

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "spelling-creator": {
      "command": "node",
      "args": ["/absolute/path/to/spelling-creator/apps/mcp/src/stdio.js"]
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add spelling-creator -- node /absolute/path/to/spelling-creator/apps/mcp/src/stdio.js
```

Claude Code can also use the hosted server directly:

```bash
claude mcp add --transport http spelling-creator https://spellingcreator.org/mcp
```

If you didn't use the `login` helper, pass the token in the client's `env`
block, for example `"env": { "SUPABASE_REFRESH_TOKEN": "..." }`. To work
against a local API (`pnpm dev:api`), also set
`SPELLING_CREATOR_API_URL=https://api.spelling-creator.localhost`, and
`NODE_EXTRA_CA_CERTS` to the full path of `~/.portless/ca.pem` so Node trusts
the local HTTPS certificate (see
[Local URLs](../getting-started.md#local-urls)).

Then ask the assistant something like: _"Make a lesson about domestic cats with
a reading passage, a spelling list and some questions, and save it as a
draft."_ If you hit a permission error, ask it to run `whoami` first.
