---
title: Images
---

# Images

For how to use this, see [Pictures](../../guide/images.md).

This page covers the image search dialog (Pixabay, Wikimedia Commons and
Wikidata's picks) and how a picture's credit is stored apart from its caption.
For how image bytes are stored and uploaded, see
[Lesson images](../lesson-images.md).

## Search images

**Search images** on a section opens `ImageSearchDialog.jsx`, which searches
for free images and inserts the one you pick as an image block. It has two
sources, switched with the toggle at the top: [Pixabay](https://pixabay.com)
and [Wikimedia Commons](https://commons.wikimedia.org). Both work the same way
from there: search, click a result, and it is inserted with its
[credit](#image-credits) set to the attribution the source asks for and an
empty caption.

Each source sits behind the same small interface in `ImageSearchDialog.jsx`
(`search`, `resolve`, `credit`, `alt`, and a `needsToken` flag), so the
dialog's flow doesn't care which one is selected. Whatever `resolve` returns is
decoded to bytes (`decodeDataUrl`) and stored by content hash with
`storeImageBytes`, like any other image, so the exporters never see where a
picture came from.

Replacing a picture through **Replace > Search online** keeps its caption and
swaps in the new picture's credit (`SectionCard.jsx`).

### Pixabay

Pixabay goes through the companion Worker (`apps/api`, the `imageSearch` and
`imageFetch` modes in `apps/api/src/routes/ai.js`) rather than being called
directly, which:

- keeps the Pixabay API key server-side (it is never shipped to the browser),
- puts the requests behind the Worker's per-IP rate limit (a token bucket of 60
  requests a minute, shared with the AI modes), and
- works around Pixabay's image CDN sending no CORS headers: the browser can't
  read an image's bytes itself, so the Worker downloads the chosen image and
  returns it as a data URL.

The flow:

1. Type a search term; a [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/)
   token (the same widget as the AI dialogs) is sent with the request.
2. The Worker verifies the token, calls the Pixabay API with `mode:
   "imageSearch"`, and returns normalized hits (preview/webformat URLs, size,
   tags). It edge-caches the Pixabay response for 24 hours (`cacheTtl: 86400`),
   which both satisfies Pixabay's caching requirement and keeps requests well
   under Pixabay's own limit of 100 a minute. If Pixabay does answer 429, the
   Worker says "Image search is busy" and when to retry.
3. Click a result; the app calls the Worker again with `mode: "imageFetch"`,
   which downloads that image and returns it as a data URL.
4. The image is inserted with the credit `Image by {user} from Pixabay`, or
   `Image from Pixabay` when there's no user name
   (`imageSearch.providers.pixabay.*` in `editorTools.json`).

Each Worker call consumes its single-use Turnstile token, so the widget is reset
to mint a fresh one between searching and inserting. This source needs the same
`VITE_API_URL` / `VITE_TURNSTILE_SITE_KEY` as the AI features, plus a
`PIXABAY_API_KEY` secret **on the Worker** (`wrangler secret put PIXABAY_API_KEY`).
Without a site key the dialog shows "VITE_TURNSTILE_SITE_KEY is not configured."

### Wikimedia Commons

Commons is called straight from the browser
(`@spelling-creator/core/browser/commonsImages`). Its API answers anonymous
cross-origin requests and its image CDN sends CORS headers, so there is no key,
no Worker and no Turnstile challenge. The MCP server's `search_images` searches
Commons too, with the same shared plumbing (`@spelling-creator/core/wikimedia`).

Every Commons file is licensed on its own, so each result carries its author
and license, and the credit is built from them:
`Image (by {author}, {license}) via Wikimedia Commons`.

### Wikidata's pictures come first

When the search names one particular thing ("lion", "Paris", "Great Pyramid of
Giza"), the results open with the pictures [Wikidata](https://www.wikidata.org)
lists for it, each with a badge saying what it is (`imageSearch.wikidataRoles`):
**Main picture**, **From above**, **At night**, **Panorama**, **Inside**,
**Montage**, **Where it lives**, **Map**, **Area map**, **Flag**, **Coat of
arms**, **Logo** and **Structure**. A line above the grid names the item they
are from, with its description, so a search that landed on the wrong "Mercury"
says so before anyone picks from it.

Those pictures were chosen by the people describing that thing on Wikidata, so
they are usually a better first offer than whatever a full-text search of
Commons ranks highest. They are ordinary Commons files, so everything after the
search (the download, the credit) is the same code. A picture that is also in
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
still shows Commons' own results and says nothing about it. The lookup is three
small requests (a name search, one query, and a Commons lookup of the files),
made alongside the Commons search rather than before it, with a budget of four
seconds for all three (`PICKS_BUDGET_MS` and `wikidataPickPages` in
`packages/core/src/wikimedia.js`, which both apps use). A query service under
load costs the picks, never the search.

A file Wikidata names may have been renamed on Commons since, with a redirect
left behind, or be spelled with different capitals. The lookup asks Commons to
follow redirects and maps each title through the renames Commons reports, so
the picture still shows under its current name.

The shared Wikidata plumbing (searching names, running queries, reading Commons
file names out of query results) is `packages/core/src/wikidata.js`, which the
[fact check](./fact-checking.md) uses too.

## Image credits

A picture in a lesson (an image block, or the picture on a
[VAKT activity](./vakt-activities.md)) has two text fields: the `caption`,
which the author writes, and the `credit`, the attribution the picture's
license asks for. Search and the MCP server's `add_image` fill in the credit
and leave the caption empty; a picture uploaded from the author's device starts
with no credit.

### Why they're separate

The credit used to be written into the caption. That meant:

- [read aloud](./interactive-mode.md) spoke the license to the speller in the
  middle of a lesson,
- the picture's alt text was its license rather than a description,
- [lesson translation](./lesson-translation.md) machine-translated
  photographers' names,
- [lesson summaries](./lesson-summaries.md) had to skip captions altogether,
  and
- an author who rewrote the caption deleted the credit with it.

Now each feature takes only the part it needs: the caption is shown, used as
alt text, read aloud, translated and given to the summarizer; the credit is
only ever displayed or printed, in smaller type (in the DOCX, 8pt gray).

Emptying the credit in the editor asks first, and the question waits until the
field loses focus (`ContentBlock.jsx`), so clearing it to type a correction
doesn't set it off. Replacing a picture from a file clears the credit; replacing
it from a search swaps in the new one. Both keep the caption.

### Lessons from before credits had their own field

Older lessons still have the credit at the end of the caption. They aren't
rewritten in storage: that would show up as an edit to every picture in
[version history](../version-history.md), and could race collaborators in a
live session. Instead the split happens when a lesson is read
(`imageCaptionParts` in `packages/core/src/imageCredit.js`).

It only recognizes the credit lines this app wrote itself, at the very end of a
caption:

- `Image (by {author}, {license}) via Wikimedia Commons`, and the older
  `Image by {author} via Wikimedia Commons`
- `Image by {user} from Pixabay` and `Image from Pixabay`

Anything the author wrote in front of it becomes the caption, so
`A red panda resting. Image (by ...) via Wikimedia Commons` reads as that
caption plus that credit, and so does a credit the author put in brackets
(`Lions (Image from Pixabay)`). A caption that merely starts with "Image of..."
or "Image (cute) of..." is left alone.

A block with a `credit` field, even an empty one, is never split again: an
empty credit means someone removed it on purpose. The first time either field
of an older picture is edited, both are written back as separate fields.

Most of the app reads a picture through `imageCaptionParts`. Two places hand
the stored block to something else, and split it first with
`withSeparateCredit`:

- **The MCP server's view of a lesson** (`presentDoc` in
  `packages/core/src/lessonBuild.js`, behind `get_lesson` and the live
  session's reader). An assistant is told to keep the attribution out of the
  caption and pass `credit` through, so shown a combined caption it would drop
  the attribution.
- **Three-way merges** (`git/merge.js`). Without it, a caption edit on one side
  and a credit fix on the other would both change `caption`, and both add
  `credit`, and come out as conflicts.

### In a Word document

The exporter gives the credit its own paragraph style (`S2C Credit`), next to
the caption's `S2C Caption`, and DOCX import reads both back by style (see
[Formatting, footnotes & sources](./formatting-and-footnotes.md)). The `S2C`
prefix is a historical name that stays so Word round trips keep working.

The lesson title also carries an unformatted character style, `S2C Lesson
Title`, which nobody sees. It tells the importer the file is from after credits
had their own paragraph, so a picture with no credit paragraph comes back with
an empty credit and a credit that was removed on purpose stays removed. A
document without it was exported before credits existed: its credit is inside
the caption paragraph and is split as above.
