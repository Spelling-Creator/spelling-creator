---
title: Server rendering
---

# Server rendering

Three kinds of page are rendered on the server before the browser runs any
JavaScript, and then hydrated in place:

| Route            | Data the server fetches   | Rendered for |
| ---------------- | ------------------------- | ------------ |
| `/hub`           | `fetchPublishedLessons()` | Everyone     |
| `/hub/:id`       | `fetchLesson(id)`         | Everyone     |
| `/hub/:id/<tab>` | `fetchLesson(id)`         | Everyone     |
| `/users/:id`     | `fetchUserProfile(id)`    | Everyone     |

Everything else (`/`, `/editor`, `/library`, `/settings`, `/login`,
`/oauth/authorize`, `/moderation`) is served as the static SPA shell.

Both hosts do this: the Cloudflare Worker (`handleFrontend` in
`apps/api/src/routes/render.js`) and the self-hosted Node entry
(`apps/api/src/node/server.js`) call the same `shouldServerRender` /
`serverRender` pair from `apps/api/src/routes/ssr.js`.

The data is loaded the way the browser loads it, through core's own client,
from the origin the page is being served at. Neither host can reach that
origin over the network from inside itself. Cloudflare does not route a
Worker's fetch to its own hostname back into the Worker; it sends it on to the
zone's origin server, and this site has no origin server behind the Worker, so
the request dies as a 522. On the Node host behind the compose stack's
gateway, the public address names a port only the gateway listens on. So both
hosts answer any request to the origin they are currently serving in-process,
with the app's own handler, and only send other origins over the network. That
is `apps/api/src/lib/selfFetch.js`, which the Worker installs in `src/index.js`
and the Node entry in `src/node/server.js`. Without it, every render fails with
"SSR data/shell failed" and falls back to the shell. The hosted MCP server's
tools hit the same wall from the other side: they call the API from the HubMcp
Durable Object, where no Worker request is being served, so they register the
API origin as a standing route that is always answered in-process (see
[Remote mode](../mcp-server/remote-mode.md)). The one exception is
`/rest/v1` and `/auth/v1`, which the app never serves: on an origin that also
fronts PostgREST and GoTrue, those still go over the network to them.

A lesson's tabs (`/hub/:id/practice`, `/discussion`, `/proposals`,
`/proposals/:prId`, `/history`; see [Pages & routing](./pages-and-routing.md#a-lessons-tabs))
are all the same lesson, so one `fetchLesson` serves all of them and the tab
decides what to draw with it. `LESSON_PATH` names those forms rather than
matching any extra segment, so it and the SPA's route table agree about what a
lesson URL is: a wildcard would let `/hub/:id/anything` through, costing a
lesson fetch and a full render to produce a page that isn't one. Adding a tab
means editing both. The pattern itself lives in `apps/api/src/routes/spa.js`,
the server's copy of the route table, and `ssr.js` imports it (with `HUB_PATH`
and `PROFILE_PATH`), so the code deciding a path is a lesson and the code
deciding it is [a page at all](./pages-and-routing.md#unknown-paths) cannot
disagree. `LessonLayout` seeds its state from that payload and the tab reads it
through `useLesson()`, so no tab fetches the lesson a second time.

Matching the tabs is **not** optional. The service worker's `navigateFallback`
denylist excludes the whole of `/hub/*` from the precached shell (`WORKER_PATHS`
in `apps/web/vite.config.js`) precisely because the server answers those paths
itself. A tab that this route failed to match would be excluded from the shell
_and_ left unrendered: online it falls through to the SPA shell and still works,
offline there is nothing to fall through to and it fails outright. The two lists
have to stay in step, and both say so in a comment.

The bootstrap payload is keyed by the exact `url.pathname` the server rendered,
and `useServerData` only hands it to a page still on that path, so following a
tab link releases it and the layout keeps serving its own state, which is the
behavior you want.

## Why only these three

Because their primary content is a **public read**. The Supabase session lives
in `localStorage` behind PKCE and is invisible to a server, so the render is
always anonymous; the personalized parts of the page (the account menu, an
author's Edit/Delete controls, whether you follow a profile) fill in when the
client hydrates. No session ever has to move to a cookie, which is what keeps
this tractable. A private draft 404s on the server for the same reason, and its
author sees it after hydration, when their own authenticated fetch runs.

`fetchLatestLessons` and `fetchUserActivity` can't be server-rendered at all:
they parse Atom with `DOMParser`, and live in `@spelling-creator/core/browser/feeds`.
Both are dashboard content, so hydrating them is correct.

## How it fits together

```text
apps/web/src/entry-server.jsx     the app, built for workerd (`build:ssr` -> dist-ssr/)
apps/web/src/lib/ssr.jsx          the client/server handoff (SsrProvider, useServerData, useSiteOrigin)
apps/api/src/routes/ssr.js        the server route: match, fetch, render, splice
apps/api/src/routes/spa.js        the route table, and the asset/shell/404 fall-through
```

1. The frontend handler asks `shouldServerRender`: a `GET` whose `Accept`
   includes `text/html`, to one of the routes above, without the prerender
   browser's `__prerender` flag.
2. `serverRender` configures core from the server's own bindings (so
   `hasSupabase()` agrees with what the client will compute), fetches the page's
   data (through the very same `@spelling-creator/core` modules the browser
   calls, so the two paths can't drift) and calls `render()` from the server
   bundle.
3. `render()` returns `{ head, body }`. React hoists `<title>`/`<meta>` to the
   front of its output when rendering a subtree rather than a whole document, so
   they're split off and spliced into the real `<head>`; a scraper won't read an
   `og:` tag it finds in the body. The stream is read to the end rather than
   streamed out, so the status and the head are settled before a byte is sent.
4. The server injects the body into `<div id="root">` and serializes the data
   into `window.__SSR__`. The response is sent with `Cache-Control: no-cache`
   and an `X-Rendered: ssr` header, which is the quickest way to tell a rendered
   page from the plain shell.
5. `src/main.jsx` reads that, deletes it from `window`, and calls `hydrateRoot`
   instead of `createRoot`.

**Failure at request time is always soft.** A failed data fetch or a render
error falls through to the static shell, which is what the app served before any
of this existed. A missing server bundle is not a runtime case: `ssr.js`
imports it statically, so the Worker fails to bundle without it, which is why
every script that reaches wrangler builds it first.

The one failure treated as an answer rather than a breakdown is a 404 from the
API: core's fetch errors carry the HTTP status, so `/hub/<deleted-id>` is
answered with the shell under a real `404` instead of a page insisting forever
that it exists (a "soft 404", which is what gets junk URLs indexed). A private
draft takes the same path on purpose: the render is anonymous, the API reports
a draft exactly like a missing lesson, and the SPA never reads the status, so
the draft's author still reaches it after hydration through their own
authenticated fetch. A path that isn't a route at all is still 404ed outright,
without a render ([Unknown paths](./pages-and-routing.md#unknown-paths)).

## Page metadata

`src/lib/seo.jsx` exports a `<DocumentMeta>` component, not a hook. React 19
hoists `<title>`, `<meta>` and `<link>` into `<head>` from anywhere in the tree,
so page metadata is ordinary JSX, which is exactly what makes it work under
SSR, where an effect that writes into `document.head` never runs.

JSON-LD is deliberately _not_ hoisted: React only hoists `<script>` when it's
`async`, which is meaningless for a non-executable type. `<JsonLd>` renders in
place, which search engines accept. The same file builds the lesson and hub
schemas (`buildLessonCourseSchema`, `buildLessonListSchema`).

## Things that had to change to make it work

- **`index.html`'s site-wide social defaults are stripped** on a rendered page
  (its `<title>`, `description`, `og:*` and `twitter:*` tags), before the page's
  own tags go in. Otherwise a scraper reading the _first_ `og:title` would get
  the generic one. The default tags carry a `data-seo-default` marker and are
  removed by it, because the Chromium prerenderer removes the same set from a
  live DOM in which the page's own React-hoisted tags already sit, where
  matching by tag name would take the page's tags too.
- **The service worker must not answer these navigations.** `navigateFallback`
  would otherwise serve the precached shell and the server would never be asked,
  silently disabling SSR for exactly the returning visitors whose browsers have
  the shell cached. The routes are in `WORKER_PATHS` in
  `apps/web/vite.config.js`; see [Installable app & offline use](./pwa-and-offline.md#navigation-fallback-and-the-paths-it-must-not-touch).
- **`ColorSchemeProvider` doesn't read `localStorage`/`matchMedia` during
  render.** The server can't, and a hydrating client has to render the same
  thing the server did: the theme toggle shows a sun or a moon, so this is
  markup, not just a CSS variable. The stored choice is adopted in a layout
  effect, after hydration but before paint. Page colors were already correct
  before paint via the inline script in `index.html`.
- **`RichText` sanitizes only in the browser.** DOMPurify needs a real DOM, so
  the rich-text branch renders nothing on the server and appears immediately
  after mount. Rendering the _unsanitized_ HTML server-side is not an
  alternative: React never re-checks `dangerouslySetInnerHTML` during
  hydration, so whatever the server wrote is what the reader keeps. A profile
  bio still reaches crawlers, as the page's meta description.
- **Translations get an instance per render.** `entry-server.jsx` creates a
  fresh i18next instance from `baseConfig` in `src/lib/i18n.js` with `lng: "en"`,
  because module scope in a Worker is shared by concurrent requests. See
  [Internationalization](./internationalization.md#the-server-render).
- **`src/main.jsx` and `src/entry-server.jsx` must stay structurally in step.**
  Anything that renders DOM has to appear in both, in the same order. Sonner's
  `<Toaster>` renders an empty `<section>` even with no toasts, so it's in both;
  `ServiceWorkerPrompt` renders `null` and is browser-only, so it isn't.
- **Splicing uses function replacements.** Everything spliced into the shell
  carries user text, and in a string replacement `$'` and friends are
  substitution syntax, so a lesson titled `$'` would duplicate the rest of the
  page.

## What SSR replaced, and what it didn't

`apps/api/src/routes/render.js` uses headless Chromium (the `BROWSER` binding in
`apps/api/wrangler.jsonc`) for two unrelated jobs:

- **`prerender()`**: an HTML snapshot for about 30 crawler user-agents
  (`CRAWLER_UA`). SSR replaces this for the routes above. It's still used for
  `/` (whose content is auth-gated, so an anonymous render is only ever the
  marketing splash) and for any SSR attempt that fails. The Node host has no
  Chromium and skips this step.
- **`ogImage()`**: live 1200x630 screenshots for link previews. **Unaffected.**
  SSR cannot take a screenshot, so the binding stays.

## Build order

The server imports a build artifact, so `apps/web` must be built before the
Worker is bundled:

```bash
pnpm build          # client -> apps/web/dist, server -> apps/web/dist-ssr
pnpm run deploy     # runs the above, then the docs build, then the API's deploy
```

`apps/web`'s `build` script is the client only and `build:ssr` is the server.
In `turbo.json`, the API's `test` task depends on `build:ssr` and its `bundle`
task on both, and `pnpm dev:api` and `pnpm run deploy` build both before
starting wrangler (see [Turborepo](../getting-started.md#turborepo)). In the
Workers test
project, the pool runs against a test-only entry
(`apps/api/src/collab-room.test-worker.js`) that doesn't import the route table;
the Node tests do import `ssr.js`, which is why the bundle has to exist.

The server build stubs out modules it can never run. `SSR_UNREACHABLE` in
`apps/web/vite.config.js` lists them: the export engine, the git engine, the
editor, moderation, login and OAuth pages, and the on-device model engines
(translation, summary, import and read-aloud). They are all reached only
through a dynamic `import()`, so the stub never has named exports to fail to
provide; reaching one at render time throws, which means the route table and
that list disagree.

## Local development

`pnpm dev:web` (the Vite dev server) does **not** server-render; there is no
Worker in front of it, so every route arrives as the plain SPA shell and mounts
with `createRoot`. To exercise SSR, run `pnpm dev:api`. It builds both halves
of the web app (replayed from the Turborepo cache when nothing changed), then
serves the built assets in `apps/web/dist` through the real Worker. It does not
watch `apps/web`, so run it again after changing the app.
