---
title: Search images
---

# Search images

Press **Search images** on any section to open a dialog that searches for free
images and inserts the one you pick as an image block. It has two sources,
switched with the toggle at the top: [Pixabay](https://pixabay.com) and
[Wikimedia Commons](https://commons.wikimedia.org). Both work the same way from
there: search, click a result, and it is inserted with its caption pre-filled
with the attribution the source asks for, editable like any other caption.

Each source sits behind the same small interface in `ImageSearchDialog.jsx`
(`search`, `resolve`, `caption`), so the dialog's flow doesn't care which one is
selected.

## Pixabay

Pixabay goes through the companion Worker (`apps/api`) rather than being called
directly, which:

- keeps the Pixabay API key server-side (it is never shipped to the browser),
- lets the Worker enforce Pixabay's **100 requests/minute** limit centrally, and
- works around Pixabay's image CDN sending no CORS headers: the browser can't
  read an image's bytes itself, so the Worker downloads the chosen image and
  returns it as a data URL that drops straight into the DOCX/PDF export.

The flow:

1. Type a search term; a [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/)
   token (the same widget as the AI dialogs) is sent with the request.
2. The Worker verifies the token, calls the Pixabay API with `mode:
"imageSearch"`, and returns normalised hits (preview/webformat URLs, size,
   tags). It edge-caches the Pixabay response for 24 hours, which both satisfies
   Pixabay's caching requirement and keeps request counts well under the limit.
3. Click a result; the app calls the Worker again with `mode: "imageFetch"`,
   which downloads that image and returns it as a data URL.
4. The image is inserted with the caption `Image by {photographer} from Pixabay`.

Each Worker call consumes its single-use Turnstile token, so the widget is reset
to mint a fresh one between searching and inserting. This source needs the same
`VITE_API_URL` / `VITE_TURNSTILE_SITE_KEY` as the AI features, plus a
`PIXABAY_API_KEY` secret **on the Worker** (`wrangler secret put PIXABAY_API_KEY`).

## Wikimedia Commons

Commons is called straight from the browser
(`@spelling-creator/core/browser/commonsImages`). Its API answers anonymous
cross-origin requests and its image CDN sends CORS headers, so there is no key,
no Worker and no Turnstile challenge. The MCP server's `search_images` searches
Commons too, with the same shared plumbing (`@spelling-creator/core/wikimedia`).

Every Commons file is licensed on its own, so each result carries its author
and licence, and the caption is built from them:
`Image (by {author}, {licence}) via Wikimedia Commons`.

### Wikidata's pictures come first

When the search names one particular thing ("lion", "Paris", "Great Pyramid of
Giza"), the results open with the pictures [Wikidata](https://www.wikidata.org)
lists for it, each with a badge saying what it is: **Main picture**, **From
above**, **At night**, **Map**, **Where it lives**, **Flag**, and so on. A line
above the grid names the item they are from, with its description, so a search
that landed on the wrong "Mercury" says so before anyone picks from it.

Those pictures were chosen by the people describing that thing on Wikidata, so
they are usually a better first offer than whatever a full-text search of
Commons ranks highest. They are ordinary Commons files, so everything after the
search (the download, the caption) is the same code. A picture that is also in
the search's own results isn't shown twice.

How the item is found (`packages/core/src/wikidataMedia.js`):

1. **Only an exact name counts.** `wbsearchentities` matches prefixes, so the
   lookup keeps only items whose label or alias _is_ the search. "Volcano
   erupting" names no one thing and gets no Wikidata pictures, rather than the
   wrong thing's.
2. **The best known match with pictures wins.** Wikidata's search order is a
   poor guide: for "lion" it puts a family name first, and for "Mercury" a car
   brand ahead of the planet. So all the exact matches go into one SPARQL query
   that returns their pictures and how many Wikipedias have a page on each
   (their sitelinks). The lion has 274 and the family name 2.
3. **Pictures are read by property**, in this order: main picture (P18), aerial
   view, night view, panorama, interior, montage, range map, locator map,
   location map, flag, coat of arms, logo, chemical structure. Deprecated
   statements are skipped, and so are ones with an end date (Japan's flag from
   1870 to 1999). At most two of any kind (Japan has five locator maps) and
   eight in all.

Some picture properties are left out on purpose, such as an image of a grave or
a seal: real pictures of the thing, but not ones to put in front of a speller
unasked.

Wikidata is an extra here, not the search. If it is slow or down, the dialog
still shows Commons' own results and says nothing about it. The lookup is two
small requests (a name search, then one query), made alongside the Commons
search rather than before it.

The shared Wikidata plumbing (searching names, running queries, reading Commons
file names out of query results) is `packages/core/src/wikidata.js`, which the
[fact check](./fact-checking.md) uses too.
