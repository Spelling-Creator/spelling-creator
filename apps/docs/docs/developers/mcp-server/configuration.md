---
title: Configuration
---

# Configuration

These variables configure the **stdio server** only (local setup and the `.mcpb`
bundle); see [Local setup](./setup.md). [Remote mode](./remote-mode.md) needs no
client-side configuration at all; the OAuth flow replaces all of it, and the
Worker takes its equivalents from `apps/api/wrangler.jsonc`.

Everything is optional except a credential. Set them in the environment or the
MCP client's `env` block. A local `apps/mcp/.env` also works for `pnpm start`
and `pnpm login` (variables already in the environment win). The annotated
template is `apps/mcp/.env.example`; the code that reads them is
`apps/mcp/src/config.js`.

| Variable                             | Default                                                                                                  | Purpose                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `SPELLING_CREATOR_API_URL`           | `https://spellingcreator.org`                                                                            | Worker API base (use `http://localhost:8787` against `pnpm dev:api`).            |
| `SUPABASE_REFRESH_TOKEN`             | (none)                                                                                                   | Long-lived credential; refreshed automatically.                                  |
| `SUPABASE_ACCESS_TOKEN`              | (none)                                                                                                   | Short-lived session JWT (about 1 hour), used as-is.                              |
| `SPELLING_CREATOR_SESSION_FILE`      | `$XDG_CONFIG_HOME/spelling-creator-mcp/session.json`, else `~/.config/spelling-creator-mcp/session.json` | Where the `login` helper saves the session and where rotated tokens are written. |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | the production project                                                                                   | Override only for a fork.                                                        |

## Which credential wins

`createAuth` in `src/auth.js` resolves credentials in this order:

1. **`SUPABASE_REFRESH_TOKEN`.** Supabase rotates the refresh token on every
   use, so an env token is only a seed. After the first refresh the server
   writes the rotated token to the session file, tagged with the seed it came
   from. On the next start, if the env token still matches that seed, the
   server continues from the file's newer token; if you paste in a different
   env token, it starts a fresh chain. This is also how the `.mcpb` bundle keeps
   working after the token from its install dialog has been rotated away.
2. **`SUPABASE_ACCESS_TOKEN`** on its own: used until it expires, then tools fail
   with a "sign in again" error.
3. **The session file** from the `login` helper, when neither variable is set.

The bundle's install dialog maps onto these: its required **Supabase refresh
token** field becomes `SUPABASE_REFRESH_TOKEN` and its optional **Hub API URL**
becomes `SPELLING_CREATOR_API_URL` (see `user_config` and `server.mcp_config` in
`apps/mcp/manifest.json`).
