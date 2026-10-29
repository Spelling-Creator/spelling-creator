---
title: Lesson images (binary, R2 + IndexedDB)
description: How lesson images are stored as content-hashed binaries in IndexedDB and R2, converted to WEBP, and kept within R2's free tier.
---

# Lesson images (binary, R2 + IndexedDB)

Lesson images are stored as binary, keyed by their SHA-256 content hash, not as
base64 inside the lesson doc. Locally they live as blobs in IndexedDB (so large
drafts aren't capped by `localStorage`'s ~5 MB quota); in the cloud they live in
an R2 bucket. The lesson doc only references images by hash, as
`{ image: { hash, mime, ext } }` on an image block or on a VAKT activity that
carries a picture.

On the device, the blobs sit in the `images` object store (keyed by `hash`) of
the `s2c-lesson-maker` IndexedDB database, next to the lesson library's own
stores (`packages/core/src/browser/imageStore.ts`). The database name is a
historical one and stays as it is, because renaming it would strand every saved
lesson.

Worker endpoints (`apps/api/src/routes/images.js`, registered in
`apps/api/src/app.js`):

- `GET /images/:hash` (and `HEAD`): public; serves the image bytes from R2
  (immutable cache), with whatever content type the stored object has.
- `PUT /images/:hash`: authenticated (Supabase JWT); the body must have an
  `image/*` content type, be at most 8 MB, and hash to `:hash` before it is
  stored. Called on save/publish to upload locally drafted images
  (`packages/core/src/browser/imagesClient.ts`). On the way in, the Worker re-compresses
  raster images to **WEBP** (`convertImageToWebp` in
  `apps/api/src/imageConvert.js`), falling back to the original bytes for
  formats it can't decode or when the WEBP isn't smaller. The key is still the
  original content hash, so dedup and references are unaffected.

The conversion uses [@jsquash](https://github.com/jamsinclair/jSquash)'s WASM
codecs rather than a native dependency like `sharp`, which is what lets the same
code run in the Workers runtime and in Node with no per-platform build step. Each
codec's `init()` is handed an already-compiled `WebAssembly.Module`, so the
Emscripten glue never tries to fetch its binary at runtime; the Workers sandbox
forbids that, and in Node it would resolve against the wrong base.

Where that module comes from is the only per-runtime part, and it sits behind the
`#image-codec-wasm` subpath import (`apps/api/package.json`, `src/codecs/`):
wrangler's bundler resolves the `.wasm` imports on Workers, and Node reads and
compiles them off disk, memoized and deferred so an instance that never receives
an upload doesn't pay for ~700 KB of codecs at startup. It is the same
conditional-import pattern `apps/mcp` uses for its `#standards-md`.

The two halves are verified in different places, because no single runner covers
both. The Node half runs in the API's Node test project; the Workers half is
resolved by wrangler's bundler, which CI exercises with
`pnpm --filter @spelling-creator/api bundle` (a `wrangler deploy --dry-run`).
`@cloudflare/vitest-plugin` cannot resolve a `.wasm` out of `node_modules`. It uses
Vite's module graph, not wrangler's, so the image tests are excluded from that
project (`apps/api/vitest.workers.config.js`) rather than made to limp along in
it.

The browser also tries to do this conversion itself before an image ever reaches
the Worker: `readImageFile` (`packages/core/src/browser/imageFile.ts`)
re-encodes PNG/JPEG picks to WEBP on a canvas (same quality target, same
keep-whichever-is-smaller rule) while it's already decoding the file to measure
its dimensions. This is purely an optimization (it saves upload bandwidth and R2
conversion work for the common case), not a correctness requirement: browsers
without WEBP canvas encoding, GIF/SVG (skipped client-side on purpose, same as
server-side), and any client that skips or fails the step all still land on the
Worker as their original raster type, which converts them exactly as described
above.

Setup:

```bash
# Create the R2 bucket the IMAGES binding points at (see apps/api/wrangler.jsonc).
wrangler r2 bucket create spelling-creator-images

# Secret for the one-time backfill endpoints (below).
wrangler secret put ADMIN_MIGRATE_TOKEN
```

The routes never touch the `IMAGES` binding directly. They ask the
[platform seam](platform-seam.md) for "the image store", which on Cloudflare is
that R2 bucket and on a [self-hosted](self-hosting.md) Node instance is the
S3-compatible bucket named by `S3_BUCKET_IMAGES`. Without either, the image
routes answer 500 and everything else keeps working.

## Migrating existing lessons

Existing cloud lessons (with base64 images inline) are converted by a one-time,
idempotent backfill. It's gated by the `ADMIN_MIGRATE_TOKEN` secret (sent as the
`X-Admin-Token` header) and pages through lessons, uploading each inline image to
R2 and rewriting the doc. `limit` defaults to 25 and is capped at 100:

```bash
# Repeat, passing the returned nextCursor each time, until nextCursor is null.
curl -X POST https://<worker-host>/admin/migrate-images \
  -H "X-Admin-Token: $ADMIN_MIGRATE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"cursor": 0, "limit": 25}'
```

Local lessons migrate automatically on first load (the old `localStorage` doc
moves to IndexedDB, then to the [lesson library](web-app/local-lessons.md); see
`migrateLocalStorage` and `migrateToLibrary` in
`packages/core/src/browser/storage.ts`). Readers tolerate legacy base64
throughout, so the backfill can run any time after deploy. Deploy order: deploy
the Worker (so `/images` exists), then ship the web build, then run the
backfill.

A second, separate backfill **re-compresses images already in R2** to WEBP, for
objects uploaded before the `PUT` handler started converting. It's gated by the
same `ADMIN_MIGRATE_TOKEN` and pages through the bucket with R2's list cursor,
overwriting each PNG/JPEG object at the same key (only when the WEBP is smaller).
It's idempotent (already-WEBP and untranscodable objects are skipped). Each
object is a decode and an encode, so `limit` defaults to 10 and is capped at 50:

```bash
# Repeat, passing the returned nextCursor each time, until nextCursor is null.
curl -X POST https://<worker-host>/admin/backfill-webp \
  -H "X-Admin-Token: $ADMIN_MIGRATE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"limit": 10}'
```

Because `GET /images/:hash` is edge-cached as immutable, a colo that already
cached an object keeps serving the pre-conversion bytes until its cache evicts
it. The handler clears the current colo's entry as it goes; the bytes look the
same either way, so this only delays the size saving.

## Staying within R2's free tier

R2's free tier allows 10 GB-month storage, 1M class-A (write) ops/month, and 10M
class-B (read) ops/month. The design keeps usage well inside these:

- **Class A (writes)** is roughly the number of _distinct_ images, not the
  number of saves.
  Images are content-addressed, so `PUT /images/:hash` first does a `head()`
  (class B) and only `put()`s when the object is missing; the client also caches
  which hashes it has uploaded this session (`imagesClient.ts`), so re-saving a
  lesson uploads nothing new. A picture this device doesn't hold is taken to be
  in R2 already, and cached the same way; one it can't read because IndexedDB
  failed stops the save instead, and isn't cached, so the next save looks again.
  Identical images (across all users/lessons) share one object.
- **Class B (reads)** stays low because `GET /images/:hash` responses are cached
  at Cloudflare's edge (the bytes are immutable, so they're safe to cache
  forever). Repeat views of a popular lesson (and the og-image/prerender
  browser) are served from cache and don't hit R2.
- **Storage** is bounded by global content-hash dedup plus an 8 MB-per-image cap
  (`MAX_IMAGE_BYTES` in `packages/core/src/image.ts`, enforced by the Worker).
  The editor checks the same 8 MB when it saves, before sending a picture
  (`ensureImagesUploaded` in `packages/core/src/browser/imagesClient.ts`), and
  the MCP server checks it before it uploads a Commons picture, in
  `apps/mcp/src/wikimedia.js`.
  This is the one limit without a hard code guard, so set an R2 storage alert in
  the Cloudflare dashboard (Notifications) if you want a heads-up as the bucket
  grows. Cloudflare does not offer a hard spend cap, so monitoring is the safety
  net here.
