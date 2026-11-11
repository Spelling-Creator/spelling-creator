---
title: The rewrite (apps/web-next)
description: "The web app is being rewritten in apps/web-next on React Router's framework mode: why, how the two apps share one site while it happens, how a route moves, and how to run and test the new one."
---

# The rewrite (apps/web-next)

The web app is being rewritten, a route at a time, in `apps/web-next`. The
old app in `apps/web` keeps serving every page that has not moved yet, and
the two share one site until the last page has. This page is the map of
that: what the new app is, how the hand-over works, and what moving a route
involves.

## Why

The old app grew three ways of producing a page (a hand-rolled server render
on the Worker for the hub, lesson and profile pages, a headless-Chromium
prerender for crawlers on the rest, and the plain single-page app), and kept
its hardest logic in effect-heavy React hooks: a live collaboration session,
a lesson's version history and a letterboard session each lived in a hook of
a dozen `useState` and `useRef` calls, tangled with how React renders. The
decision record in [Frontend migration](../frontend-migration.md) settled on
staying with React, and that still holds; what changes is everything around
it.

The rewrite was prepared in two steps before the new app existed, and both
are what make it tractable:

1. **The sessions moved out of React into core.** Live collaboration,
   version history, the letterboard host and read-aloud are framework-free
   objects in `@spelling-creator/core/browser/*` now, each with a store and
   tests of its own; see [Sessions outside React](./project-structure.md#sessions-outside-react).
   Either app reads one through a single `useSyncExternalStore` call.
2. **The browser tests became the spec.** [End-to-end tests](./end-to-end-tests.md)
   drive the old app through its main flows against the stub API. Every flow
   there has to pass against the new app before the old one goes.

## What the new app is

`apps/web-next` is TypeScript on [React Router](https://reactrouter.com) in
framework mode (v8), built by Vite 8 like the old app. The differences that
matter:

| Old app                                                                                            | New app                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JavaScript with JSDoc                                                                              | TypeScript, with React Router's generated route types (`./+types/<route>`)                                                                                     |
| A route table in `App.jsx`, restated in `apps/api/src/routes/spa.js` and `vite.config.js`          | One route table, `app/routes.ts`, that the router, the type generator and the server all read                                                                  |
| Three rendering paths                                                                              | One: every route renders on the server. A public page's loader fetches its data; a personal page renders its shell and finishes in the browser                 |
| Data handed to a page through `window.__SSR__` and `useServerData`                                 | A `loader` per route; the page reads `loaderData`                                                                                                              |
| `<DocumentMeta>` components, with the shell's default tags stripped by the server                  | A `meta` export per route (`lib/seo.ts` builds the common set), including the page's JSON-LD                                                                   |
| Configuration from `import.meta.env` in `main.jsx`, or `window.__CONFIG__` on a self-hosted server | The host passes its configuration into the request context (`lib/host.ts`); the root route configures core with it and writes it into the page for the browser |

The source tree, as far as it goes today:

```
app/
  root.tsx              the document, the providers (color scheme, tooltips, auth, the display-name gate, the toaster), the configuration seam
  routes.ts             the route table
  entry.client.tsx      configure core, then hydrate
  entry.server.tsx      render one request; re-exports what the hosts call
  routes/
    shell.tsx           the layout route: AppHeader around every page, and the error boundary that keeps the chrome
    hub.tsx             /hub
    profile.tsx         /users/:id
    not-found.tsx       the catch-all: a 404 on a document request, the hand-over on a client navigation (see below)
  components/
    layout/             AppShell, AppHeader, PageBar, PageBody (as in the old app)
    ui/                 the shadcn/ui primitives, in TypeScript
    ...                 the shared components the pages so far need
  lib/
    config.ts           the build's VITE_* values and the browser's merge with what the host wrote
    host.ts             the request-context key a host passes its configuration under
    routes.ts           which paths this app serves, for the Worker
    seo.ts              pageMeta, jsonLd and the schema.org builders
    i18n.ts             the i18next setup: an instance per server render, one for the browser
    auth.tsx, colorScheme.tsx, useStore.ts, useInstallPrompt.ts, format.ts, errors.ts, site.ts
  locales/en/*.json     the same namespaces as the old app
  styles/globals.css    the same stylesheet
```

The icons and the homepage's screenshots stay in `apps/web/public` (they are
Git LFS files, and two copies would be two to keep in step); the new app's
Vite config points its `publicDir` there.

## How the two apps share the site

The Worker (and the self-hosted Node server) serves one directory of static
files, `apps/web/dist`, and decides per request which app answers a page.

- **Which app serves a path** is `isNextPath` in `apps/web-next/app/lib/routes.ts`.
  The Worker reaches it through the server build (`build.entry.module.isNextPath`)
  rather than importing the file, so the list lives with the app it describes.
  A path on the list goes to the new app's request handler; everything else
  goes where it always did.
- **The new app's static files** are copied into `apps/web/dist` after the
  old app's build, by `apps/web-next/scripts/copy-to-web.mjs`, the way the
  docs are copied into `dist/docs`. Names cannot collide: every file under
  `assets/` carries a content hash.
- **The server build** (`apps/web-next/build/server/index.js`) is bundled for
  workerd with nothing left to resolve at runtime, like the old app's
  `dist-ssr`. `entry.server.tsx` re-exports `createRequestHandler`,
  `RouterContextProvider` and the host context key, so the Worker drives the
  app through the build's own copy of React Router and never imports it
  itself. One copy of React, one of the router, whichever host is serving.
- **Links from the new app to pages the old app still serves** go through
  the catch-all route. A client-side navigation to `/editor`, say, matches
  `routes/not-found.tsx`, whose `clientLoader` asks the browser to load the
  document and never resolves; the Worker then answers it with the old app.
  No link in the app has to know which side of the line its target is on.
- **The old app's service worker** answers navigations from its precached
  shell unless a path is on its denylist (`WORKER_PATHS` in
  `apps/web/vite.config.js`). `/hub` and `/users` are there already; a route
  moving later has to be added, or returning visitors keep getting the old
  page.

The Worker's side is `apps/api/src/routes/next.js`: `shouldServeNext` asks
`isNextPath` about the request (with a `.data` suffix stripped, which is how
a client navigation asks for a page's data), and `serveNext` runs the
request handler with the host's settings in the context. `handleFrontend`
in `routes/render.js` calls it before the old server render, and the Node
entry's `frontend` does the same. The settings a host passes are only the
ones it knows: the Worker's bindings for the API origin, the Supabase
project and the sign-in mode; on the Node server the same browser settings
it writes into the old app's shell. Anything left out keeps the build's
value, so the Turnstile site key and the Google client id the deploy bakes
in survive. `node/next.test.js` pins the hand-off down from the Node entry,
and the profile cases in `node/ssr.test.js` now run against the new app.

The deploy builds both apps (`.github/workflows/deploy.yml` injects the
`VITE_*` values into each app's `.env` and ships `apps/web-next/build` beside
the old app's `dist` and `dist-ssr`), and the Docker image does the same
(`Dockerfile`). `turbo.json` builds the new app before the API's tests and
the Worker bundle, both of which import it.

## Moving a route

1. Write the route module under `app/routes/` and list it in `app/routes.ts`.
   Its `loader` fetches what the server can (public reads, through the same
   core functions the browser calls); a page whose content is personal
   exports a `clientLoader` and a `HydrateFallback` (a skeleton) instead.
   Export `meta` for its title, social tags and JSON-LD, and
   `ErrorBoundary` as `RouteErrorBoundary`.
2. Read the old file's history first (`git log --follow apps/web/src/...`).
   The old app has several hundred commits of fixes and few tests; a comment
   that explains an odd line is usually the record of one.
3. Add the path to `NEXT_PATHS` in `app/lib/routes.ts`, and to
   `WORKER_PATHS` in `apps/web/vite.config.js` if it is not covered there.
4. Add the route's specs to `NEXT_SPECS` in `apps/web/playwright.config.ts`,
   the `web-next` project's list, and watch them pass against the new app
   (see [End-to-end tests](./end-to-end-tests.md#two-apps-two-projects)).
5. Delete the old route's files, and whatever only they used.

## Running it

```bash
pnpm dev:next            # the new app's dev server (https://next.spelling-creator.localhost)
pnpm dev:next:stub       # the same, against the stub API (https://next.stub.spelling-creator.localhost)
pnpm --filter @spelling-creator/web-next typecheck   # react-router typegen, then tsc
pnpm --filter @spelling-creator/web-next build       # client and server builds into build/
```

The dev server renders on the server too (React Router runs the loaders in
Node), so a page's server render is exercised without the Worker. With
`PORTLESS=0` the stub-mode server is on `http://127.0.0.1:5181`, next to the
old app's 5180, so both can run against one stub.

`pnpm build` at the root builds both apps and copies the new one's files
into `apps/web/dist`; `turbo.json` orders the copy after the old build,
which empties that directory.
