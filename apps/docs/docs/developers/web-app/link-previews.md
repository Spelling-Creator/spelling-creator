---
title: Link previews
---

# Link previews

Paste a link to a lesson into a chat, a social feed or a forum and the
platform's scraper fetches the page, reads its `og:image` tag and shows the
picture it points at. Every page's tag points at the API's own endpoint:

```text
GET /og-image?path=/hub/<lesson-id>
```

It answers with a 1200x630 PNG, the standard large-image preview shape. The
`<DocumentMeta>` component in `apps/web/src/lib/seo.jsx` writes the tag for the
current path, and `apps/web/index.html` carries a site-wide default pointing at
`path=/` for a page that isn't server-rendered.

The image is a **designed card**, not a screenshot. It used to be one: headless
Chromium loaded the page and photographed its top 630 pixels, which only the
Cloudflare host could do (it needs the Browser Rendering binding) and which
took a browser launch per page. The card is drawn from the page's data in a
few milliseconds, on either host, and shows what a preview should show rather
than whatever happened to be above the fold.

## The cards

`apps/api/src/og/card.js` has one function per kind of page. Each returns an
element tree, which is what Satori lays out (see below).

| Path                      | Card                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/hub/:id` (and its tabs) | The lesson's title, its author, section count and the month it was published, with its first picture on the right when it has one.                          |
| `/users/:id`              | The profile's initials avatar (the same one the profile page draws), the display name, a line of the bio as plain text, and the lesson and follower counts. |
| `/hub`                    | "Lesson hub" and the page's description.                                                                                                                    |
| `/` and anything else     | The site: logo, name and description.                                                                                                                       |

The route (`apps/api/src/routes/og.js`) matches the path against the same
`LESSON_PATH`, `PROFILE_PATH` and `HUB_PATH` patterns that
[server rendering](./server-rendering.md) uses, from `routes/spa.js`, and
fetches the lesson or profile through the same `@spelling-creator/core`
fetchers the browser calls, configured the way `ssr.js` configures them
(`lib/coreConfig.js`). One subrequest back into the same origin, so the card
cannot disagree with the page about what a lesson is called.

The card's colors, radii and type are the web app's light theme, copied from
`globals.css` rather than imported. A scraper caches one picture per link; it
has no theme toggle, and light is what reads on every platform's chrome.

**A page whose data cannot be read gets the site card, not an error.** A deleted
lesson, a private draft, the API being down: all of them produce a valid image.
A scraper that gets a 500 shows nothing, and keeps showing nothing for as long
as it caches the miss. Only a failure to render at all answers 500.

## How a card becomes a PNG

![A card, the element tree from card.js, goes to Satori, which lays it out with the fonts and writes an SVG in which every glyph is already a path. raster.js draws that subset of SVG, and the PNG encoder from @jsquash/png writes the 1200 by 630 result. The card and raster.js are this repo's code; Satori's layout engine, the fonts and the logo come from the host through the #og-runtime import, and everything else is the same on workerd and Node.](../../diagrams/link-preview-pipeline.drawio.svg)

[Satori](https://github.com/vercel/satori) takes an HTML-like element tree
with inline styles, lays it out with a flexbox engine, and writes SVG. It
cannot use system fonts, so the fonts are handed to it as bytes: the app's own
Fraunces and Public Sans, from the same `@fontsource` packages the web app
installs, as `.woff` files (Satori reads TTF, OTF and WOFF, not WOFF2). Latin
and Latin Extended subsets are loaded, which covers the accented letters of
the European languages a title is likely to be in. A glyph outside both, such
as another script or an emoji, is drawn as nothing.

Satori renders text as paths, so the SVG it writes needs no fonts of its own.
`apps/api/src/og/raster.js` draws that SVG, and the PNG encoder the upload
path already ships (`@jsquash/png`) writes the bytes.
`apps/api/src/og/render.js` runs the pipeline. Satori's **standalone** build is
used on both hosts: its default entry carries the layout engine as a base64
string and compiles it at runtime, which the Workers sandbox forbids, while the
standalone one takes an already-compiled module from the caller.

### The rasterizer, and why it is ours

The usual partner for Satori is [resvg](https://github.com/linebender/resvg),
as `@resvg/resvg-wasm`. Its WebAssembly build is 2.5 MB, 0.9 MB compressed,
and a Worker on the free plan may be 3 MB compressed in all. This API was 2.4 MB
before link previews, so resvg does not fit beside it, and the native binding
cannot run on Workers at all.

What Satori writes for these cards is a very small SVG: filled paths (every
glyph is one, and so is every rounded box), plain rects, images from data URIs,
clip paths and rect masks that implement overflow and border radius, and
groups. No strokes, no text elements, no gradients, filters or transforms.
`raster.js` draws exactly that subset, in a few hundred lines of plain
JavaScript that costs the bundle nothing, and refuses anything outside it with
a clear error rather than drawing it wrong. Shapes are filled with the
signed-area accumulation rasterizer that font renderers use (font-rs and its
descendants): each edge deposits the area it sweeps into a buffer, a prefix sum
per row turns that into exact per-pixel coverage, and text comes out
anti-aliased the way a font engine would draw it. Curves and arcs are flattened
to short lines first. Images are drawn with box sampling when shrunk and
bilinear sampling otherwise.

The cards are written to stay inside that subset, and a test checks the SVG
for strokes, transforms and text elements so a change to a card that strays
is caught there rather than as a render failure. The two places it mattered:
the picture's border is a filled box behind the picture rather than a CSS
border (Satori writes a border as a stroked path), and the logo is the PNG
icon the web app ships (`src/og/logo.png`, a copy of
`apps/web/public/icons/icon-192.png`) rather than the SVG one, whose letter is
drawn with strokes.

The same rasterizer runs on both hosts. A self-hosted instance could use the
native `@resvg/resvg-js` binding, but one renderer that the tests exercise
directly beats two that draw differently.

### Why Satori is held at 0.32

`apps/api/package.json` asks for `satori@^0.32.0`, which on a 0.x version
means 0.32 and nothing newer. From 0.33, Satori bundles a HarfBuzz text shaper
into its standalone build and compiles it from embedded bytes at import time.
workerd refuses to compile WebAssembly from bytes, so every render on the
Worker fails ([vercel/satori#878](https://github.com/vercel/satori/issues/878)).
0.32 is the last release that works there, and nothing a card draws needs the
shaper: the OpenType features it adds (ligatures, complex scripts) are not
used, and a title in Latin script shapes the same either way.

[PR #931](https://github.com/vercel/satori/pull/931) adds
`init({ layout, harfbuzz })` and a `satori/harfbuzz.wasm` export, which is the
same arrangement the layout engine already uses. When it is released, the
upgrade is: lift the pin, import that module in `runtime.workerd.js` and read
it off disk in `runtime.node.js`, and pass both modules to `init` in
`render.js`. Until then the layout engine is Yoga, imported as
`satori/yoga.wasm` (later releases call it `satori/layout.wasm`).

### The runtime seam

Where that module, the fonts and the logo come from is the one thing the two
hosts do differently, so it sits behind the `#og-runtime` subpath import in
`apps/api/package.json`, the same arrangement as `#image-codec-wasm` (see
[Lesson images](../lesson-images.md)):

| Host    | Module                      | How it loads them                                                                                                                             |
| ------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| workerd | `src/og/runtime.workerd.js` | Static imports. wrangler hands a `.wasm` import over compiled, and a `.woff` or `.png` as an ArrayBuffer (the Data rule in `wrangler.jsonc`). |
| Node    | `src/og/runtime.node.js`    | Read off disk, the wasm compiled, each resolved through Node's own module resolution so the paths hold wherever pnpm put the packages.        |

`src/og/fonts.js` is the one list of font files; both halves read it, and the
workerd half pairs its static imports with that list by position. The codecs
a card uses come through `#image-codec-wasm`, wrapped once in
`src/og/codecs.js`.

## The lesson's picture

Lesson images are stored as WEBP (see [Lesson images](../lesson-images.md)),
with PNG and JPEG passing through from before that conversion existed.
`apps/api/src/og/picture.js` fetches the lesson's first image block from
`/images/:hash`, decodes it with the matching `@jsquash` codec (the same family
the upload path uses, judged by the file's header rather than the server's
content type), shrinks it to twice the size of the slot it is drawn in, and
encodes it as PNG. One format on the way out keeps the rasterizer to one
decoder, and shrinking first keeps the SVG Satori embeds the bytes into small.
A GIF or an SVG is left out: there is no decoder for the one and no reason to
risk the other.

The limits are about memory. A Worker has 128 MB, a decoded image is four
bytes per pixel, and an 8 MB upload can hold a great many of them. The
dimensions are read from the header before anything is decoded, and an image
over 4096 pixels on a side or 8 million pixels in all is skipped rather than
attempted. A picture that cannot be loaded for any reason means a card without
a picture, never a link without a preview.

## Caching

Responses are cached by path in the [`ResponseCache`](../platform-seam.md)
(Cloudflare's edge cache on the Worker, nothing on a self-hosted instance,
where a reverse proxy does this job) with `Cache-Control: public, max-age=3600`,
like the screenshots were. Rendering is cheap now; the cache is about not
repeating the lesson fetch for every scraper that follows the same link. A
lesson edited within the hour can show its old title in a preview until then,
and the scrapers themselves cache for longer than that anyway.

## Tests

`src/og/og.test.js` runs in the Node project only (`vitest.node.config.js`):
the cards import Satori's engine and the fonts out of `node_modules`, which
vitest-pool-workers cannot resolve, the same limitation `imageConvert.test.js`
has. The rasterizer is plain JavaScript and the same on both hosts, and the
tests exercise it directly: parsing, path flattening, exact coverage of a
half-pixel edge, clipping, masks and images, and that it refuses a stroke, a
transform or a text element. The workerd half of the seam is what `wrangler
deploy --dry-run` resolves, and CI bundles the Worker for exactly that reason
(see [Getting started](../getting-started.md)).
