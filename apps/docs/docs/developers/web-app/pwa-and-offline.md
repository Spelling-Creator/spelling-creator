---
title: Installable app & offline use
---

# Installable app & offline use

For how to install the app and what works offline, see
[Install and use offline](../../guide/install-and-offline.md).

The web app ships as a **progressive web app**: it can be installed to a
computer's dock or app list or a phone's home screen, it opens in its own window
with no browser chrome, and the editor keeps working with no network at all.

Offline support is mostly something the app already had. Lessons live in
IndexedDB: every lesson this device holds, their images as binary blobs, and a
git repository per lesson behind version history (see
[Lessons on this device](./local-lessons.md),
[Version history](../version-history.md) and
[Lesson images](../lesson-images.md)). What was missing was the other half:
without a service worker the browser still has to fetch `index.html` and the JS
bundle over the network before any of that stored data can be reached. Precaching
the built shell closes that gap.

## What works offline, and what doesn't

| Works offline                                                   | Needs the network                                  |
| --------------------------------------------------------------- | -------------------------------------------------- |
| Opening the app at any client-side route outside `WORKER_PATHS` | The lesson hub, lesson pages, profiles, comments   |
| Switching between the lessons on this device                    | Publishing a fork's changes as a proposal          |
| Writing, editing, reordering, deleting sections and blocks      | Save to cloud (publishing or a private backup)     |
| Images already in the local image store                         | Image search (Pixabay, Wikimedia Commons)          |
| Version history: commits, browsing, restoring                   | AI text / question / lesson-idea dialogs, AI fixes |
| DOCX export and PDF printing (the export chunk is precached)    | Fact checking                                      |
| Lesson images seen before (cached by hash)                      | Live collaboration                                 |
|                                                                 | Sign-in, Save to Google Docs                       |
|                                                                 | Downloading an on-device model for the first time  |

Everything in the right-hand column already degrades with a clear message when
the feature is unconfigured (see [Getting started](./getting-started.md)); with
no connection they fail the same way rather than being hidden.

## How it's put together

The service worker and the manifest come from
[`vite-plugin-pwa`](https://vite-pwa-org.netlify.app), configured in the
`VitePWA` block of `apps/web/vite.config.js`. It runs in the default
`generateSW` mode, so Workbox writes `dist/sw.js` from the build's own asset
list; nothing has to be kept in sync by hand. `injectRegister` is `null`:
`src/lib/pwa.jsx` registers the worker itself so it can own the update UI.

### Precache

The precache is the built shell, matched by
`globPatterns: ["**/*.{html,js,css,woff2,svg,png,ico}"]`: `index.html`, the
JS/CSS chunks (lazy ones included), the self-hosted Fontsource `.woff2` files,
and the icons. Three things are deliberately left out:

- **`public/home/*.jpg`**, the homepage's feature screenshots (about 490 KB).
  Those are marketing images; they aren't worth an install-time download, so a
  runtime `StaleWhileRevalidate` rule picks them up the first time someone
  actually looks at the homepage. (They're JPEGs, so the glob never matches
  them.)
- **`dist/docs/`**, this documentation site (`globIgnores: ["docs/**"]`).
  `pnpm build:docs` copies the VitePress output in _after_ the web build, and it
  has its own hashed assets and its own pages, none of which belong in the
  app's precache.
- **The ALTCHA widget chunk** (`altchaWidget-*.js`, about 36 KB compressed).
  Only an instance whose AI check is ALTCHA loads it (see
  [Self-hosting](../self-hosting.md#ai)), so precaching it would cost every
  other install a download it never uses, and it is only needed for an AI
  request, which needs the network anyway.

`maximumFileSizeToCacheInBytes` is raised to 4 MiB because the `vendor` chunk is
over Workbox's 2 MiB default on its own. `cleanupOutdatedCaches` is on.

### Navigation fallback, and the paths it must not touch

Client-side routes are answered from the precached `index.html`
(`navigateFallback: "/index.html"`), which is what makes a deep link like
`/editor` or `/library` work with no network. But the Cloudflare Worker in front
of the app answers plenty of paths itself (`run_worker_first` means it sees
every request before the static assets do), and the service worker must not
shadow those with the app shell.

`WORKER_PATHS` at the top of `apps/web/vite.config.js` is that list, passed to
Workbox as `navigateFallbackDenylist`: the [server-rendered routes](./server-rendering.md)
(`/hub`, `/hub/…`, `/users/…`), `/docs`, `/images/…`, `/git/…`, `/collab`,
`/og-image`, the MCP OAuth paths (`/authorize`, `/token`, `/register`, `/mcp`,
`/.well-known/…`), and the SEO endpoints (`sitemap.xml`, `robots.txt`,
`feed.xml`, `spelling-words.json`). Anything not on it is assumed to be a route
in `src/App.jsx`.

The server-rendered routes are on the list for a reason worth spelling out: if
the service worker answers `/hub/abc123` from the precached shell, the Worker is
never asked, and server rendering silently stops happening, for returning
visitors specifically, the only people whose browsers have the shell cached.
Nothing is lost offline, since all three need the network for their data anyway.

It's a **denylist rather than an allowlist** on purpose. Adding a page to
`App.jsx` shouldn't require a matching edit to the build config, and the failure
mode is the gentler one: an unlisted route falls through to the network, which
online still lands on `index.html` via the Worker's frontend fall-through
(`apps/api/src/routes/spa.js`). An over-broad allowlist, by contrast, would have
the service worker confidently answer `/docs/intro` with the React app.

That fall-through _does_ need the matching edit, and for a different reason:
it is what decides whether a path is [a page or a 404](./pages-and-routing.md#unknown-paths).
A route it doesn't know still renders; it just carries the wrong status.

### Runtime caching

| Rule                     | Handler                | Cache           | Why                                                                                             |
| ------------------------ | ---------------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| `/images/<64-hex>`       | `CacheFirst`           | `lesson-images` | Lesson images are addressed by the SHA-256 of their bytes, so a URL's content can never change. |
| Other same-origin images | `StaleWhileRevalidate` | `static-images` | The homepage screenshots: worth keeping, not worth blocking on.                                 |

Both keep entries for 30 days; the lesson-image cache holds up to 300 and the
static one up to 60.

The image rule is matched by a callback rather than a `RegExp`: `VITE_API_URL`
may point at a different origin, and Workbox only applies a `RegExp` route
cross-origin when it matches from the very start of the URL.

`cacheableResponse` accepts status `200` and **not** `0`. Status `0` is an
opaque response, which is what a cross-origin `<img>` the app didn't fetch
itself yields, but opaque means _no status at all_, so a 404 or a 502 looks
exactly like a hit. Under `CacheFirst` that error would then be served from
the cache for the full 30 days with no retry, so a single blip while an image
was still uploading would break it permanently. (Opaque entries are padded to
megabytes apiece for quota accounting too, and the rule allows 300 of them.)

The deployed app gives nothing up for this: the Worker serves both the SPA and
`/images` from the same origin, so the responses are `basic` and carry a real
status. A self-host that points `VITE_API_URL` at a different origin loses
offline images (the browser's own HTTP cache still applies), which is the
right way round from a cache that can poison itself.

Hub listings, profiles and comments are **not** cached. They're user-specific
and change often, and a stale hub is more confusing than an unavailable one.

### Downloaded AI models

The features that run a model in the page with transformers.js save what they
download in a Cache Storage bucket of their own, `transformers-cache`, which
the service worker never touches: natural voices
([interactive mode](./interactive-mode.md)), the summary fallback
([lesson summaries](./lesson-summaries.md)), the translation fallback
([lesson](./lesson-translation.md) and [comment](./comment-translation.md)
translation) and the model behind [Import from text](./document-import.md).
The ONNX runtime's own `.wasm` files go in the same bucket. Between them that
can come to a few gigabytes, and the browser keeps it until something deletes
it.

The **This device** card on the settings page shows the total under
**Downloaded AI models** and has a **Delete models** button, so that space can
be had back without clearing the site's data, which would take every lesson on
the device with it. `packages/core/src/browser/modelCache.ts` does the work:

- `modelCacheBytes()` adds up each entry's `Content-Length`, without reading
  the bodies, for entries that arrived uncompressed. That covers the model
  weights, which Hugging Face sends as they are. An entry with a
  `Content-Encoding` is read for its real size instead: jsDelivr sends the
  ONNX runtime's `.wasm` as brotli, so its `Content-Length` (about 5.5 MB) is
  the compressed size, while the cache holds it decoded. It returns `null`
  when the page can't use Cache Storage at all, and the row is left out then.
- `clearModelCache()` deletes the whole bucket. Nothing else writes to it, so
  there's nothing to pick through.

The row measures again every 5 seconds (`MODEL_SIZE_POLL_MS` in
`SettingsPage.jsx`) while the page is in view, when the tab comes back into
view, and when the dialog opens, because a download keeps going after you leave
the page that started it and another tab can finish one. Only the first
measurement can hide the row; a later read that fails keeps the last size.

Deleting is safe at any time, even mid-download. transformers.js stores each
file whole and opens the bucket by name for every file it loads, so the next
download just starts a new one. A model already loaded in an open page keeps
working from memory; the next page load downloads it again.

Chrome's built-in models (the Translator, LanguageDetector and Summarizer APIs)
belong to the browser, not the site, so they aren't counted or deleted here.
The confirmation dialog says so.

The module hard-codes the bucket name (`MODEL_CACHE_NAME`) instead of importing
transformers.js, which would pull the library into the settings page's bundle.
Its test checks the name against transformers.js's own `env.cacheKey`, so an
upgrade that renames the bucket fails the test instead of leaving the button
deleting nothing.

## Updates

`registerType` is `"prompt"`, not `"autoUpdate"`. Activating a new service
worker reloads the page, and this is an editor; swapping the running build out
from under someone mid-lesson isn't something to do silently.

So `src/lib/pwa.jsx` registers the worker and raises a Sonner toast when a new
build is waiting: _"A new version is available"_ ("Reload to update. Your saved
lessons aren't affected."), with a **Reload** action that calls
`updateServiceWorker(true)`. The toast has no timeout and can be dismissed;
dismissing lets it be offered again at the next check rather than never again
for the life of the tab. That check runs hourly (`UPDATE_CHECK_INTERVAL`), and
only while `navigator.onLine`: an installed PWA's window can stay open for days,
and without a poll it would only notice a deployment on a manual reload.

On a self-hosted instance, a configuration change counts as a new build too.
The Node server writes the instance's settings into `index.html` as it serves
it, and suffixes the shell's precache revision in `sw.js` with a hash of them,
so new settings change the worker and the shell together and arrive through
this same prompt. See
[How the browser gets its settings](../self-hosting.md#how-the-browser-gets-its-settings).

## Installing

`src/lib/useInstallPrompt.js` captures Chromium's `beforeinstallprompt` event
and calls `preventDefault()` on it, which suppresses the browser's own
mini-infobar and lets `InstallAppButton.jsx` put the control in the app. The
event fires before React mounts, so the listener is registered at module scope
and the captured event is held in a small store that components read through
`useSyncExternalStore`. An `appinstalled` listener clears it.

`InstallAppButton` has two callers: the header's utility cluster (an icon with an
**Install app** tooltip, hidden below `sm` along with the rest of that cluster)
and the settings page's **This device** card (an **Install app** button under
**Install the app**). Both render nothing at all unless the app is actually
installable, so on a visit that doesn't qualify, or once the app _is_ installed
(detected via `(display-mode: standalone)` or `navigator.standalone`), the
header and the card are unchanged.

Safari has no equivalent event: on iOS and iPadOS an app is installed through
Share, then **Add to Home Screen**, and there is no API to trigger it or even to
ask whether it's available. There the button is shown on browser sniffing
instead (iPadOS is detected as a "Macintosh" user agent with touch points), and
opens a dialog with the two steps. Chrome, Firefox, Edge and Opera on iOS
(`CriOS`, `FxiOS`, `EdgiOS`, `OPiOS`) are excluded: they are Safari underneath,
but their UI has no "Add to Home Screen" item, and pointing someone at a menu
entry they don't have is worse than saying nothing. Desktop Safari and Firefox
get no button either.

## Signing in from the installed app

A magic link signs in whichever browser opens it, and from an installed app
that's rarely the app itself:

- **iOS and iPadOS** open every emailed link in Safari, and a home screen app's
  storage is separate from Safari's. The PKCE verifier the link needs was saved
  in the app, so Safari can't finish the sign-in, and even if it could, the
  session would land in Safari.
- **Desktop Chrome and Edge** open the link in a normal browser tab. Storage is
  shared with the installed app there, so the sign-in works, but the person is
  left in a browser tab rather than the app window.

So the "Check your email" screen also takes the one-time code from the same
email (`EmailCodeForm.jsx`, labeled **Code from the email**; see
[Hub & accounts](./hub-and-accounts.md)). A code has no redirect, so it signs in
wherever it's typed. The field uses `autocomplete="one-time-code"`, so phones
can offer the code from the email as a keyboard suggestion. An instance using
username and password sign-in has no link to lose.

## The manifest and icons

The manifest is generated from the `manifest` block in `vite.config.js`;
`vite-plugin-pwa` injects the `<link rel="manifest">`. It names the app
"Spelling Lesson Maker" (short name "Spelling"), sets an explicit `id: "/"` so
the install identity survives a change to `start_url`, uses
`display: "standalone"`, and adds two shortcuts: **New lesson** (`/editor`) and
**Lesson hub** (`/hub`).

The tags it doesn't own are written by hand in `apps/web/index.html`:
`theme-color` (twice; a `prefers-color-scheme: dark` variant, `#12131f`, first,
since Safari takes the first match), `mobile-web-app-capable`,
`apple-mobile-web-app-title`, the status-bar style (`black-translucent`), and
`apple-touch-icon`. iOS ignores the manifest's icons and its `display` field
without those.

`theme_color` and `background_color` in the manifest are both `#dee3f3`, as is
the light `theme-color` meta tag. The comments beside them say they track the
light `--background`, since the top of the screen is now the page rather than an
indigo app bar. (They used to be `--primary`, `#4f5fd9`.)

Icons live in `apps/web/public/icons/`. `icon.svg` and `maskable.svg` are the
sources; the PNGs are rasterized from them.

- **`icon.svg` / `icon-192.png` / `icon-512.png`**: purpose `any`. Drawn as is
  by the platform, so they carry their own rounded corners.
- **`maskable.svg` / `maskable-512.png`**: purpose `maskable`. A full-bleed
  square that Android crops to whatever shape the launcher uses, with the glyph
  at 45% so it stays inside the safe zone (the center 80% circle).
- **`apple-touch-icon.png`** (180px): full-bleed for the same reason; iOS
  applies its own rounding.

To regenerate the PNGs after editing an SVG, on macOS:

```bash
cd apps/web/public/icons
sips -s format png icon.svg --out icon-512.png
sips -s format png maskable.svg --out maskable-512.png
```

`sips` rasterizes at the SVG's intrinsic size, so the 192px and 180px variants
need an SVG whose `width`/`height` say so: change those two attributes (the
`viewBox` stays) and convert again.

## Local development

`devOptions.enabled` is `false`, so **no service worker runs under `pnpm dev`**.
That keeps Vite's HMR behaving normally and avoids debugging a stale cache that
only exists on your machine. To exercise the PWA, build and preview:

```bash
pnpm build
pnpm preview
```

The preview runs at `https://preview.spelling-creator.localhost`, served over
HTTPS by portless with its own local certificate (see
[Local URLs](../getting-started.md#local-urls)), so it is a secure context and
the worker registers. It is a different origin from the dev server and from the
old `http://localhost:4173`, so a worker registered at one of those has no
effect here. Chrome DevTools' **Application** panel (**Service Workers** and
**Manifest**) is the fastest way to check registration, and its **Offline**
checkbox to check the fallback. Remember to **Unregister** (or tick _Update on
reload_) between builds; otherwise the previous worker keeps serving the
previous bundle, which is exactly what it's designed to do.
