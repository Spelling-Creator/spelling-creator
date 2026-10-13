---
title: Export pipeline
---

# Export pipeline

For how to use this, see [Exporting & printing](../../guide/exporting.md) and
[Question blocks](../../guide/question-blocks.md).

1. The lesson state (`{ title, sections: [{ name, blocks: [...] }] }`) is turned
   into a `docx` `Document` in `@spelling-creator/core/browser/docxExport`.
2. **DOCX export** packs that document to a Blob and downloads it.
3. **PDF** (`@spelling-creator/core/browser/pdfExport`) packs the same
   document, converts it to HTML with `mammoth`, applies print styles, and
   renders it to PDF with `html2pdf.js`. Using one shared document builder keeps
   the two outputs in sync. `exportPdf` downloads the result and `printPdf`
   opens the print dialog on it (see [Printing](#printing)).
4. **Import** (`browser/docxImport`) is the same machinery in the other
   direction (`mammoth` again, this time reading a user's file).
5. **Save to Google Docs** (`browser/googleDrive`) uploads the very same
   `.docx` (see [below](#save-to-google-docs)).
6. **Import from text** reads a `.docx` as plain text with mammoth
   (`browser/documentText`), see [Document import](./document-import.md).

## Question types

The question types, their labels, the one-line descriptions shown in the
**Add question** menu, their tags, their colors and their default block shapes
live in one place, `packages/core/src/questions.js` (`QUESTION_TYPES`), so the
editor and both exporters stay in sync. Question type labels are not localized:
the menu reads `label` and `description` straight from that file. The keys are
the app's own names for the
[Open Spelling Lesson Format](https://github.com/playforge-coding/open-spelling-lesson-format)'s
types (`single` is OSLF's known, `background` its prior knowledge, `number`
its math, the two amber types its semi-open).

| Key             | Label             | Tag | Color                   | Stored answer                         |
| --------------- | ----------------- | --- | ----------------------- | ------------------------------------- |
| `number`        | Math              | M   | `#7048e8` purple        | `answer`, plus optional `steps`       |
| `single`        | Known             | K   | `#2f9e44` green         | `answer`                              |
| `multiple`      | Semi-open         | SO  | `#d68f00` amber         | `answers` (the complete accepted set) |
| `multiple_open` | Suggested answers | SO  | `#d68f00` amber, italic | `answers` (suggestions)               |
| `paraphrase`    | Paraphrase        | P   | `#a0522d` brown         | none                                  |
| `tight_open`    | Tight open        | TO  | `#e64980` pink          | `answers` (optional examples)         |
| `broad_open`    | Broad open        | BO  | `#e64980` pink          | none                                  |
| `open`          | Open ended        | O   | `#e64980` pink          | none                                  |
| `wyr`           | Would you rather  | WYR | `#9c36b5` grape         | none                                  |
| `background`    | Prior knowledge   | PK  | `#1c7ed6` blue          | `answer`                              |

The labels are the format's names. Four types were labeled differently before
the app followed it (Single answer, Number answer, Multiple answers,
Background knowledge), and those old labels live on as each type's
`styleAliases`, because a Word style is matched by its name and the name
carries the label (see [below](#color-and-alignment-have-to-be-smuggled-past-mammoth)).

`open` is the type lessons were saved with before tight and broad opens were
told apart. It carries `legacy: true`, which keeps it out of
`QUESTION_TYPE_MENU` (the **Add question** menu and the AI question dialog use
that list), while `QUESTION_TYPE_LIST` still has it for everything that reads a
stored lesson. Stored blocks are never rewritten on load, for the reason
`imageCredit.js` gives (it would show as an edit in version history and
broadcast to a live session), so `resolveOpenType(block)` is how the checks,
the text importer and the file export decide which kind a legacy question is:
its own type for anything else, and for `open` the type its wording reads as.
The stems are tried in order: `TIGHT_STEM` ("Name a...", "Give one...")
makes a tight open whatever follows, `PARAPHRASE_STEM` ("In your own
words...", "Summarize...") makes the paraphrase, or a broad open when
`OPINION_CUE` finds the prompt asking for the speller's own view ("...why you
prefer rivers"), `BROAD_STEM` makes a broad open, and word count settles the
rest. Because
the checks and the export share this one reading, a lesson that passes the
shape check still passes it after an OSLF round trip.

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
answer for the amber types and a tight open's examples (joined with
`ANSWER_GAP`, a space, a non-breaking space and a space, since the PDF's HTML
would collapse ordinary spaces), and nothing for `paraphrase`, `broad_open`,
`open`, `wyr` or an unanswered question. A tight open's examples print after
`EXAMPLE_ANSWER_PREFIX` ("e.g. "), which the DOCX importer strips again, so
whoever is scoring reads them as examples and not as the key. A number
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
  A `heading` block (`packages/core/src/heading.js`) is content, not a
  section: it prints in bold where it sits, in a paragraph style of its own
  (`S2C Heading`, `HEADING_STYLE_CLASS`) rather than a Word heading level,
  because the importer reads Word headings as section breaks and a heading
  inside a section has to come back inside it.
- **Questions marked by a tag and a color**: the type's short tag (`K`, `PK`,
  `M`, `SO`, `TO`, `BO`, `P`, `WYR`, and `O` for a legacy open; `tag` in
  `QUESTION_TYPES`) in small grey bold,
  then the prompt in its type's color, then its answer in black on the same
  line. The tag is there for the reader who doesn't have the color: a grey
  photocopy, a printer out of ink, or someone who can't tell the colors apart.
  The [Open Spelling Lesson Format](https://github.com/playforge-coding/open-spelling-lesson-format)
  asks every renderer never to rely on color alone, and these are its default
  tags. **Suggested answers** shares the amber and the `SO` tag of
  **Semi-open** and is set in italic to separate them.
- **Three-board questions**: a `multiple` question with `threeBoard` prints
  `(3B)` inside its tag run (`SO (3B)`), and one with a `besides` answer gets
  a **Besides line** under it: `Besides "rocks"` in the question's amber, then
  the other accepted answers in black, indented like working. The line has a
  paragraph style of its own (`S2C Besides Line`, `BESIDES_LINE_CLASS`) so
  the importer attaches it to the question above instead of reading a new
  one, and the label run wears the question's character style, which is how
  the PDF (where mammoth drops run colors) colors the label and leaves the
  answers black. `questionBesides` and `besidesAnswers` in `questions.js`
  decide both halves, and return nothing when the named answer is no longer
  in the list.
- **Spelling words on one running line**, `Spell:` followed by the words as
  typed, separated by the same `ANSWER_GAP` as a semi-open question's answers.
- **A footer on every page**: the copyright line above a legend naming each
  question type the lesson uses in its own color (and its own italic, where it
  has one), uppercased (`questionLegendText`) and separated by `|`, in the
  order `QUESTION_LEGEND` gives. `questionLegendFor(doc)` cuts the list down to
  the types the lesson asks, so a lesson with no **Would you rather** questions
  has no W.Y.R. entry, and a lesson with no questions at all has no legend.
  Each entry is the type's tag then its label (`K KNOWN`), since the
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
for every document already exported. A type's label is part of its style name
for the same reason, so when four labels changed to the format's names, the
old names stayed on as `styleAliases` and `questionStyleMap` emits a rule for
each of them too (`S2C Question Single answer` still maps to `s2c-q-single`).
A new export writes only the current name.

That is also how **import** recovers a question's type: `docxImport` asks
mammoth for the same style map and reads the type off the
`<span class="s2c-q-<type>">`, the prompt off that span's text and the answer off
what follows it. The tag's own span sits before all of that, so it is never
read as part of the prompt. (Text pasted from a printed lesson into
[Document import](./document-import.md) does carry the tag as plain text;
`readQuestionTag` takes it off there, and keeps a `(3B)` mark it carried as
the block's `threeBoard`.) Section _divisions_ have nothing left
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

## Printing

**Print** prints the finished PDF itself rather than the page, so the page
numbers and footer come out the same as in the download. `printPdf` renders the
PDF exactly as `exportPdf` does, then loads the blob into a hidden same-origin
`<iframe>` and calls `print()` on the frame's window once it loads; the
browser's PDF viewer opens the print dialog for that file. It resolves to
`"printed"` or `"downloaded"`, and the callers show a message only for the
second.

- The frame is 0 by 0 and `visibility: hidden`, not `display: none`, which
  never starts the PDF viewer. It stays in the page after `print()` returns,
  because Chrome opens the dialog after that and removing the frame first
  cancels the print. The next print removes it and revokes its URL.
- It needs `navigator.pdfViewerEnabled`. Without a viewer, loading the blob into
  a frame would download it instead, and `print()` would print an empty frame.
- Safari is sent to the download too. Its viewer does print the PDF from the
  frame, but zooms into the first page and crops it (seen in Safari 26, with a
  0 by 0 frame, an A4-sized one and a 2-second wait alike).
- If the frame doesn't load within 15 seconds, or `print()` throws, the PDF is
  downloaded instead.
- Firefox's pdf.js frame counts as cross-origin to the page, but `print()` on it
  is allowed and works. Playwright's bundled Firefox turns pdf.js off
  (`pdfjs.disabled`), so in tests it takes the download path unless that pref
  is set back to `false`; Playwright's WebKit has no print dialog at all.

Last checked by hand in Chrome, Chromium, Firefox (with pdf.js), Safari 26
and Playwright's WebKit: the dialog in Chrome and Firefox shows the PDF with
its footer, a second print after cancelling the first works, and the
download path behaves in the rest.

## The Open Spelling Lesson Format

`packages/core/src/oslf.js` maps the lesson document onto the
[Open Spelling Lesson Format](https://github.com/playforge-coding/open-spelling-lesson-format)
(OSLF) and back: `toOslf(doc, { imageSrc })` and `fromOslf(file)`. The app's
own lesson file stays what it is, a lossless dump of the editor's document;
OSLF is for passing a lesson to something that isn't this app, and for
reading one that something else wrote.

- **Export OSLF** (`exportOslf` in `browser/jsonExport.js`) writes
  `<title>.oslf.json`. A stored picture becomes its public URL on the hub
  (`imagePublicUrl`), a block already carrying a `src` data URL keeps it, and
  a picture with no URL either way is left out, since the format needs one.
  The CLI writes OSLF when an output path ends in `.oslf.json`, with no
  `imageSrc`, so it keeps only data URLs. `toOslf` throws `OslfExportError`
  for a lesson the format can't hold: a `single`, `background`, `number`,
  `multiple` or `multiple_open` question with no answer, since the schema
  requires one there. The message names the section and question; the
  editor shows it as the export failing, the CLI reports it as a write that
  failed, and the MCP server returns it as the tool's error. A line break in
  a prompt, heading, caption or text run (the format's one-line strings) is
  written as a space.
- **Import JSON or OSLF** goes through `normalizeLessonFile`, which spots an
  OSLF file by its `oslf` field, turns it into a bare doc with `fromOslf`,
  and normalizes it like any other. A question type the app doesn't know is
  kept as a legacy `open` question with its prompt, as the format asks; a
  picture with a relative `src` is dropped, since a single file has nothing
  for it to be relative to; a file whose major version isn't 0 (the drafts
  this module reads) is refused rather than read on 0.1's terms.
- The type keys map both ways (`single` is `known`, `background` is
  `prior-knowledge`, `number` is `math`, the two amber types are `semi-open`
  with an `exhaustive` or `suggested` key, a tight open with examples has a
  `suggested` key, and a legacy `open` is sorted with `resolveOpenType`).
  `steps` are `working`, `threeBoard` and `besides` are themselves, and a
  text block's paragraphs become the format's rich text (strings for plain
  paragraphs, runs with `bold`/`italic`/`underline` and `note` entries
  otherwise). Prompts, captions and headings are plain strings here and rich
  text there, so they come back as their words.
- `oslf.schema.json` beside the module is the format's lesson schema, copied
  from the 0.1 draft so `oslf.test.js` can hold `toOslf`'s output to it with
  `ajv` (a dev dependency only; nothing at runtime validates). Update the copy
  when the format moves.

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
