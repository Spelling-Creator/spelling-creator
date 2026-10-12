---
title: Export pipeline
---

# Export pipeline

For how to use this, see [Exporting & printing](../../guide/exporting.md) and
[Question blocks](../../guide/question-blocks.md).

1. The lesson state (`{ title, sections: [{ name, blocks: [...] }] }`) is turned
   into a `docx` `Document` in `@spelling-creator/core/browser/docxExport`.
2. **DOCX export** packs that document to a Blob and downloads it.
3. **PDF print** (`@spelling-creator/core/browser/pdfExport`) packs the same
   document, converts it to HTML with `mammoth`, applies print styles, and
   renders it to PDF with `html2pdf.js`. Using one shared document builder keeps
   the two outputs in sync.
4. **Import** (`browser/docxImport`) is the same machinery in the other
   direction (`mammoth` again, this time reading a user's file).
5. **Save to Google Docs** (`browser/googleDrive`) uploads the very same
   `.docx` (see [below](#save-to-google-docs)).
6. **Import from text** reads a `.docx` as plain text with mammoth
   (`browser/documentText`), see [Document import](./document-import.md).

## Question types

The eight question types, their labels, the one-line descriptions shown in the
**Add question** menu, their colors and their default block shapes live in one
place, `packages/core/src/questions.js` (`QUESTION_TYPES`), so the editor and
both exporters stay in sync. Question type labels are not localized: the menu
reads `label` and `description` straight from that file.

| Key             | Label                | Color                   | Stored answer                         |
| --------------- | -------------------- | ----------------------- | ------------------------------------- |
| `number`        | Number answer        | `#7048e8` purple        | `answer`, plus optional `steps`       |
| `single`        | Single answer        | `#2f9e44` green         | `answer`                              |
| `multiple`      | Multiple answers     | `#d68f00` amber         | `answers` (the complete accepted set) |
| `multiple_open` | Suggested answers    | `#d68f00` amber, italic | `answers` (suggestions)               |
| `paraphrase`    | Paraphrase           | `#a0522d` brown         | none                                  |
| `open`          | Open ended           | `#e64980` pink          | none                                  |
| `wyr`           | Would you rather     | `#9c36b5` grape         | none                                  |
| `background`    | Background knowledge | `#1c7ed6` blue          | `answer`                              |

The two amber types are the _semi-open_ questions (`ORANGE_TYPE_KEYS`,
`isOrangeType`). Treating them as one family, colored alike, is the app's
default, not a rule every Spelling practice follows (the
[Open Spelling Lesson Format](https://github.com/playforge-coding/open-spelling-lesson-format)
lists the loose end as an open question). Consumers that
care about the block's shape (the answer rows, the exporters) treat the two
alike; consumers that care about the contract (validation, the answer reveal)
don't. `multiple` was burnt orange (`#e8590c`) until it moved to amber to stay
clear of `paraphrase`'s brown. `wyr` carries `legend: "W.Y.R."`, the only type
with a legend name shorter than its label.

`questionAnswerItems` and `questionAnswerText` decide what a printed question
shows after its prompt: one answer for the single-answer types, every non-blank
answer for the amber types (joined with `ANSWER_GAP`, a space, a non-breaking
space and a space, since the PDF's HTML would collapse ordinary spaces), and
nothing for `paraphrase`, `open`, `wyr` or an unanswered question. A number
question's `steps` print as an indented numbered list under it and come back
on DOCX and JSON import.

## What a printed lesson looks like

The exported lesson is laid out as a finished worksheet, not as an outline of the
editor:

- **A centered title block** on the first page: the title, then `By {author}`,
  then `Ages: {range}` and `Released {Month} {Year}` when the lesson has them.
  All of it is derived from the lesson (`doc.ageRange`) and the record it was
  published from; nothing about any particular publisher is baked in, and a
  lesson with no author or publication date simply prints without those lines.
- **No section headings.** A section's name is an organizing device for the
  editor; the printed lesson runs straight through from one block to the next.
- **Questions marked by a tag and a color**: the type's short tag (`K`, `PK`,
  `M`, `SO`, `P`, `O`, `WYR`; `tag` in `QUESTION_TYPES`) in small grey bold,
  then the prompt in its type's color, then its answer in black on the same
  line. The tag is there for the reader who doesn't have the color: a grey
  photocopy, a printer out of ink, or someone who can't tell the colors apart.
  The [Open Spelling Lesson Format](https://github.com/playforge-coding/open-spelling-lesson-format)
  asks every renderer never to rely on color alone, and these are its default
  tags. **Suggested answers** shares the amber and the `SO` tag of **Multiple
  answers** and is set in italic to separate them.
- **Spelling words on one running line**, `Spell:` followed by the words as
  typed, separated by the same `ANSWER_GAP` as multiple answers.
- **A footer on every page**: the copyright line above a legend naming each
  question type the lesson uses in its own color (and its own italic, where it
  has one), uppercased (`questionLegendText`) and separated by `|`, in the
  order `QUESTION_LEGEND` gives. `questionLegendFor(doc)` cuts the list down to
  the types the lesson asks, so a lesson with no **Would you rather** questions
  has no W.Y.R. entry, and a lesson with no questions at all has no legend.
  Each entry is the type's tag then its label (`K SINGLE ANSWER`), since the
  legend is where a reader looks up the tag in front of a prompt. **Would you
  rather** is abbreviated to **W.Y.R.** so a line naming every type still fits.
  [VAKT activities](./vakt-activities.md) are deliberately not in the legend:
  they aren't questions, and their `VAKT:` label already names them.
- **A page number** in the top right corner.

`lessonTitleLines` and `lessonCopyright` in
`@spelling-creator/core/lessonLayout` decide the text of the title block and the
footer once, so the DOCX and the PDF print the same strings.

### Passing the by-line in

The author and publication date live on the lesson _record_, not in the document,
so both exporters take them as a second argument:

```js
await exportDocx(doc, { author: lesson.author, published: lesson.createdAt });
```

Omit it and the by-line and copyright line are left out. The public lesson page
passes both; the editor passes only the signed-in user's display name
(`{ author: identity.name }`), since a draft has no author or publication date
of its own yet.

### Color and alignment have to be smuggled past mammoth

mammoth drops run colors and paragraph alignment, so on the PDF path neither the
question color coding nor the centered title lines survive on their own. The docx
therefore marks both with **named Word styles**: a character style per question
type (`questionStyleName`, `S2C Question {label}`, mapped by `questionStyleMap`
to `<span class="s2c-q-{key}">`), one for the type tag in front of the prompt
(`S2C Question Tag`, mapped by `questionTagStyleMap` to
`<span class="s2c-q-tag">`), and one paragraph style for the title lines
(`S2C Title Line`). `pdfExport` maps those onto CSS classes with a `styleMap`
and colors them again from `questions.js`. The `S2C` and `s2c-` prefixes are
historical names; they stay because renaming them would break the round trip
for every document already exported.

That is also how **import** recovers a question's type: `docxImport` asks
mammoth for the same style map and reads the type off the
`<span class="s2c-q-<type>">`, the prompt off that span's text and the answer off
what follows it. The tag's own span sits before all of that, so it is never
read as part of the prompt. (Text pasted from a printed lesson into
[Document import](./document-import.md) does carry the tag as plain text;
`QUESTION_TAG_PREFIX` strips it there.) Section _divisions_ have nothing left
to carry them, so a DOCX round trip collapses a lesson into a single section
(the importer does split on Heading 2 or 3 in a document that has them);
Export/Import **JSON** is the lossless one. A document that was never exported from
here at all, a hand-typed page or a Word file written elsewhere, goes through
[Document import](./document-import.md) instead, which reads the lesson by its
structure rather than by styles. Export/Import **JSON** (`lessonFile.js`) carries
the title, the age range, the lesson's sources and every section. The one thing
it leaves out on purpose is the lesson's trusted-collaborator list, because that
is a list of email addresses and a lesson file is something people pass around.
On import, an age range the editor doesn't offer is dropped and the lesson reads
as "any age".

### Formatting, footnotes and sources

A text block's bold, italics and underlining become Word run formatting, and its
footnotes become real Word footnotes, numbered in reading order at the foot of
each page. The lesson's sources close the document under a "Sources" line,
written with named paragraph styles rather than as a heading, because the
importer reads headings as section breaks. mammoth drops underlining unless its
style map asks for `u => u`, which both `pdfExport` and `docxImport` do.

mammoth turns Word footnotes into a numbered list at the very end of its HTML,
after the Sources list, with a back arrow on each. A page has no foot to put
them at, so `layoutNotes` in `pdfExport` moves the list above the Sources list,
heads it "Notes" and drops the arrows. On import, the footnotes come back as
footnotes and the Sources list back into the lesson's sources. See
[Formatting, footnotes & sources](./formatting-and-footnotes.md).

The page number and the footer are drawn straight onto the finished PDF pages
with jsPDF: they repeat on every page, so they cannot come from the flowed HTML,
and mammoth converts only the document body, never the docx's own header and
footer.

## Building a Word file is for Word files only

The six entry points above are the whole list. Nothing else in the app touches
`docx` or `mammoth`; in particular, **preview does not**. The editor's preview
mode renders the lesson model directly with `LessonView` (the same component the
public `/hub/:id` page uses), so previewing builds no document, waits on no
chunk, and shows exactly what a reader will see. (It used to build a docx and
convert it back to HTML with mammoth just to fill a dialog.)

Keep it that way: a new "show me the lesson" surface should render `LessonView`,
not the export pipeline.

### On screen it follows the theme

`LessonView` draws a lesson in the app's own theme, light or dark, on both
surfaces that show one (the public lesson page and the editor's preview mode),
exactly as [interactive mode](./interactive-mode.md) does.
It keeps the export's measurements (the `fitWithin` image math against
`DOCX_MAX_IMAGE_WIDTH`, the spacing) and its block layout (no section headings,
a question's answer inline after its colored prompt, spelling words on one line,
a [VAKT activity](./vakt-activities.md) in red under its `VAKT:` label), so a
lesson keeps the shape it will print in; only the colors and the typeface
are the theme's. What it does _not_ copy is the paper furniture: the title
block's by-line, the page numbers and the footer legend belong to the printed
sheet, and the app already shows the author and the legend in its own chrome.

There is no second "paper" rendering to keep in sync. A lesson is read on screen
far more often than it is printed, and a white sheet glaring out of a dark page
is the wrong default for reading; the printout look lives in the thing that
actually prints, the DOCX and PDF exports.

Question-type and spelling colors stay literal there, as they are in the editor
and in interactive mode: they're content (the same color coding the docx
carries) rather than chrome.

## It loads on demand

Together those libraries (`docx`, `mammoth`, `html2pdf.js` with the
`html2canvas`, `jspdf` and `dompurify` it pulls in, and `jszip`) are the
largest single cluster in the dependency graph: about 390 kB gzipped when last
measured. None of it is needed until someone exports, prints, imports a Word
file, reads a Word file into Import from text, or saves to Google Docs, so it
lives in its own chunk behind `src/lib/exports/load.js`, in the same shape as
the git engine:

```js
const { exportDocx } = await loadExportEngine();
await exportDocx(doc);
```

`src/lib/exports/engine.js` is the chunk; nothing imports it directly. It's one
chunk rather than several because the entry points share nearly all their
weight: the PDF path builds the docx and converts it with mammoth, which is
also what the importers use.

### The constants trap

`DOCX_MAX_IMAGE_WIDTH` (480) lives in `@spelling-creator/core/lessonLayout`,
**not** beside the code that first needed it. It used to sit in
`browser/docxExport`, which meant `LessonView.jsx` (wanting one number, and
rendering on the public `/hub/:id` page) pulled the entire Word toolchain into
the bundle every visitor downloaded.

Being outside `browser/` is also what lets the server render a lesson at all:
that tier needs a DOM and is unreachable from the Worker by design, and
`/hub/:id` is [server-rendered](./server-rendering.md).

If you add a shared constant to any of these modules, put it in `lessonLayout`
and re-export it, rather than importing the module for the constant's sake.

## Save to Google Docs

**Save to Google Docs** (in the editor's **Export** menu, or the **Lesson
actions** menu on a phone) uploads the current lesson to the user's Google
Drive as an editable Google Doc. The flow is entirely client-side, in
`packages/core/src/browser/googleDrive.js`:

1. [Google Identity Services](https://developers.google.com/identity/oauth2/web/guides/overview)
   (loaded by a script tag in `apps/web/index.html`) issues a short-lived OAuth2
   access token through `initTokenClient`, prompting the user to sign in and
   consent the first time.
2. The app builds the same docx as **Export DOCX**, then uploads it to the Drive
   `files` endpoint (`uploadType=multipart`, `multipart/related`), asking Drive
   to store it as `application/vnd.google-apps.document` so it is converted to a
   Google Doc. Uploads run one at a time with a short throttle, and a failed
   request is retried with backoff.
3. On success a toast ("Saved to Google Drive as a Google Doc.") offers an
   **Open** link to the new doc.

It needs no app account, only a Google one, and like the other exports it
refuses a lesson with no sections. The app requests only the
[`drive.file`](https://developers.google.com/drive/api/guides/api-specific-auth)
scope, so it can touch only the files it creates, never the user's existing
Drive contents. The menu item is hidden unless `VITE_GOOGLE_CLIENT_ID` is set
(`hasGoogleDrive()`; see [Getting started](./getting-started.md)). The OAuth
client must list every origin the app is served from (for example
`http://localhost:5173` and the production URL) under **Authorized JavaScript
origins**, and the Google Drive API must be enabled for the project.
