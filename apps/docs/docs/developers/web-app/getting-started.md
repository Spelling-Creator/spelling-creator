---
title: Getting started
---

# Getting started

For a walkthrough of making a lesson in the app, see
[Your first lesson](../../guide/getting-started.md). For the whole monorepo
(the API, the MCP server, the docs), see [Getting started](../getting-started.md).

From the repository root:

```bash
pnpm install
pnpm dev:web      # start the web app's dev server (http://localhost:5173)
pnpm build        # production build: the client into apps/web/dist, the SSR bundle into apps/web/dist-ssr
pnpm preview      # preview the production build
pnpm dev:web:stub # run against the local stub API instead (http://127.0.0.1:5180)
```

Inside `apps/web` the same scripts are plain `pnpm dev`, `pnpm build` and
`pnpm preview`. The stub mode reads `apps/web/.env.stub` and talks to
`apps/stub-api` (start it with `pnpm dev:stub`); see [Stub API](../stub-api.md).

The PWA service worker is a production concern and is switched off under
the dev server (`devOptions: { enabled: false }` in `vite.config.js`), so HMR
behaves normally; use `pnpm build && pnpm preview` to exercise it (see
[Installable app & offline use](./pwa-and-offline.md)).

## Environment variables

Optional features are configured in `apps/web/.env`; Vite reads env files from
the package holding `vite.config.js`, not from the monorepo root, and exposes
only `VITE_`-prefixed vars to client code. `apps/web/src/main.jsx` is the only
place that reads them, and hands them to `configureCore` in
`packages/core/src/config.js`:

```bash
VITE_API_URL=https://your-worker.example.workers.dev   # apps/api Worker endpoint (AI, Pixabay, lesson hub)
VITE_TURNSTILE_SITE_KEY=0x...                           # Cloudflare Turnstile site key
VITE_GOOGLE_CLIENT_ID=...apps.googleusercontent.com     # OAuth client for Save to Google Docs
VITE_SUPABASE_URL=https://xxxx.supabase.co              # Supabase project URL (sign-in)
VITE_SUPABASE_ANON_KEY=eyJ...                           # Supabase anon (public) key
VITE_AUTH_MODE=magic-link                               # magic-link (default), password, or both
VITE_USERNAME_DOMAIN=users.example.invalid              # domain for username sign-in (default users.noreply.invalid)
```

`VITE_AUTH_MODE` chooses how people sign in: an emailed magic link (the
default), a password, or either. Password accounts are registered with a
username, for instances with no mail server, and signing in takes a username
or an address; the username is turned into a synthetic email address under
`VITE_USERNAME_DOMAIN`, which defaults to a reserved `.invalid` domain that can
never receive mail (see `packages/core/src/username.js`).

There is no `apps/web/.env.example`; the list above is the full set. The root
`.env.example` is for the Docker Compose setup (see
[Self-hosting](../self-hosting.md)).

The app degrades gracefully when a feature is unconfigured:

- Without `VITE_TURNSTILE_SITE_KEY` the **AI** dialogs and Pixabay image search
  still open but show "VITE_TURNSTILE_SITE_KEY is not configured.", and without
  `VITE_API_URL` their requests fail. Wikimedia Commons search needs neither.
- Without `VITE_API_URL` the **Lesson hub** shows "The lesson hub is not
  configured (VITE_API_URL is missing)."
- Without `VITE_GOOGLE_CLIENT_ID` the **Save to Google Docs** menu item is
  hidden.
- Without `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` sign-in is disabled
  (the login page explains this); browsing the hub still works.
- The **Save to cloud** menu needs both the API and Supabase
  (`showPublish = hasApi() && authEnabled` in `EditorPage.jsx`), so it is hidden
  when either is missing.

The editor itself, version history and the Word/PDF exports need none of
these.

The Supabase **anon key** is designed to be shipped to the browser. Keep the
**service-role key** and **JWT secret** on the Worker only, never in `VITE_*`
vars, which are bundled into the client.
