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
pnpm dev:web      # start the web app's dev server (https://spelling-creator.localhost)
pnpm build        # production build: the client into apps/web/dist, the SSR bundle into apps/web/dist-ssr
pnpm preview      # preview the production build (https://preview.spelling-creator.localhost)
pnpm dev:web:stub # run against the local stub API instead (https://stub.spelling-creator.localhost)
```

The servers get those names from portless; see
[Local URLs](../getting-started.md#local-urls).

Inside `apps/web` the same scripts are plain `pnpm dev`, `pnpm build` and
`pnpm preview`, except that `pnpm build` there is the client only. The SSR
bundle is its own `pnpm build:ssr`, and the root `pnpm build` runs both through
[Turborepo](../getting-started.md#turborepo). The stub mode reads `apps/web/.env.stub` and talks to
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
`packages/core/src/config.ts`. (A self-hosted Node server can also write these
settings into the page at runtime, which takes precedence; see
[How the browser gets its settings](../self-hosting.md#how-the-browser-gets-its-settings).)

```bash
VITE_API_URL=https://your-worker.example.workers.dev   # apps/api Worker endpoint (AI, Pixabay, lesson hub)
VITE_TURNSTILE_SITE_KEY=0x...                           # Cloudflare Turnstile site key
VITE_AI_CHALLENGE=turnstile                             # the AI check: turnstile (default), altcha, or none
VITE_TURNSTILE_SCRIPT_URL=https://api.stub.spelling-creator.localhost/turnstile/v0/api.js  # load Turnstile from here instead of Cloudflare (stub mode only)
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
never receive mail (see `packages/core/src/username.ts`).

`VITE_AI_CHALLENGE` says which check the AI dialogs and Pixabay search show
before a request: Cloudflare Turnstile, an ALTCHA proof of work served by the
API, or none. It has to match the Worker's `AI_CHALLENGE`; see
[Self-hosting](../self-hosting.md#ai) for what each one does.

`VITE_TURNSTILE_SCRIPT_URL` is the one setting `main.jsx` doesn't read. When
it's set, `vite.config.js` swaps it in for Cloudflare's Turnstile script in
`index.html`. Only stub mode sets it (`apps/web/.env.stub`, or the stub's
portless URL under portless), to load the stub API's stand-in widget (see
[Stub API](../stub-api.md#ai-and-turnstile)); a real instance leaves it unset.

There is no `apps/web/.env.example`; the list above is the full set. The root
`.env.example` is for the Docker Compose setup (see
[Self-hosting](../self-hosting.md)).

The app degrades gracefully when a feature is unconfigured:

- On a Turnstile instance without `VITE_TURNSTILE_SITE_KEY`, the **AI** dialogs
  and Pixabay image search still open but say AI isn't set up, and without
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
