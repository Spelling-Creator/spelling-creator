---
title: Formatting, footnotes & sources
---

# Formatting, footnotes & sources

For how to use this, see
[Formatting, footnotes & sources](../../guide/formatting-and-footnotes.md).

Lesson text blocks can carry a little formatting (bold, italic, underline, the
`TEXT_MARKS` in `lessonText.ts`), footnotes, citations of the lesson's sources,
read-aloud hints and pauses (see [Read-aloud hints](#read-aloud-hints)), and
formulas (see [Formulas](#formulas)). A source is written once, in the lesson's Sources list, and a footnote
anywhere in the text can cite it. Every footnote is numbered in reading order
across the whole lesson, and the lesson closes with a Notes list and a Sources
list.

The text block's tiptap editor turns off headings, lists, code, links, line
breaks and strikethrough (`LessonTextInput.jsx`), and pasted line breaks become
spaces. A source prints only when it has a title, an author or a link
(`sourceHasContent` in `sources.ts`). Removing a cited source goes through
`removeSourceCitations`, which drops a footnote that only cited it and keeps
one that also had a note, as a plain note.

## How it is stored

| File                                                   | Role                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| `@spelling-creator/core/lessonText`                    | Text block content: the schema, plain text, runs, footnotes. |
| `@spelling-creator/core/inlineText`                    | A prompt or a step: the same words in a one-line field.      |
| `@spelling-creator/core/sources`                       | The source list and how a source is printed.                 |
| `apps/web/src/components/editor/LessonTextInput.jsx`   | The tiptap editor for a text block.                          |
| `apps/web/src/components/editor/LessonTextToolbar.jsx` | Its toolbar and the footnote form.                           |
| `apps/web/src/components/editor/SourcesPanel.jsx`      | The Sources card.                                            |
| `apps/web/src/lib/footnoteExtension.js`                | The tiptap footnote node.                                    |
| `apps/web/src/lib/speechExtensions.js`                 | The tiptap speech mark and pause node.                       |
| `apps/web/src/components/editor/ReadAloudControls.jsx` | The Read aloud button and its form.                          |
| `@spelling-creator/core/speech`                        | Text blocks as spoken text, and chunking it for a voice.     |
| `@spelling-creator/core/browser/formulas`              | The door to MathJax: a lesson's formulas, rendering, speech. |
| `apps/web/src/lib/formulaExtension.js`                 | The tiptap formula node.                                     |
| `apps/web/src/components/editor/FormulaControls.jsx`   | The Formula button and its form.                             |
| `apps/web/src/components/Formula.jsx`                  | Draws one formula, with MathJax.                             |
| `apps/web/src/components/TextRuns.jsx`                 | Draws runs and citations as React elements.                  |

A text block holds its words in one of two shapes:

- **`text`**, a plain string with one paragraph per line. Every block written
  before formatting existed looks like this, and so does any block nobody has
  formatted.
- **`content`**, a tiptap (ProseMirror) JSON document, once a block carries any
  formatting or footnotes.

When `content` is present it wins. Writers that replace a block whole (the
importers, the MCP server) store the smaller shape (`withTextBlockContent`), so
an unformatted block they write stays a plain string. The editor, once it has
touched a block, always stores `content` (`withTextBlockDocument`), formatted or
not. That is for live collaboration: the collaboration document merges a block
key by key, so if one person's edit wrote `content` while another's wrote
`text`, both keys would survive and `content` would quietly hide the second
edit. Two people editing a block in the editor always write the same key.
Nothing reads either field directly:
`textBlockPlain`, `textBlockLines`, `textBlockParagraphs` and
`textBlockFootnotes` treat the two shapes as one, and paragraphs map one to one
onto the old lines, so anything that was keyed by line index keeps its keys.

```json
{
  "id": "b1",
  "type": "text",
  "content": {
    "type": "doc",
    "content": [
      {
        "type": "paragraph",
        "content": [
          { "type": "text", "text": "Known to scientists as " },
          {
            "type": "text",
            "text": "Felis lybica",
            "marks": [{ "type": "italic" }]
          },
          { "type": "text", "text": "." },
          {
            "type": "footnote",
            "attrs": { "sourceId": "smith2020", "locator": "p. 12", "note": "" }
          }
        ]
      }
    ]
  }
}
```

The sources live on the lesson itself, as `doc.sources`:

```json
[
  {
    "id": "smith2020",
    "title": "Cats of Egypt",
    "author": "Jane Smith",
    "publisher": "Penguin",
    "year": "2020",
    "url": "https://example.com"
  }
]
```

### Why JSON and not HTML

Comments and bios are stored as sanitized HTML (see [Rich text](./rich-text.md)),
but lesson text is not, for two reasons. A footnote has to carry data (which
source, which page, what note), and the comment policy strips every attribute
but a checked `href`. And lesson content is rendered by walking the JSON into
React elements and docx runs, so there is never any markup to inject.
`normalizeTextContent` is the boundary instead: anything that arrives from
outside the editor (an imported file, the MCP server, a document written by an
older client) is reduced to paragraphs, three marks, the speech mark, and the
footnote, pause and math nodes, and the renderers only ever draw what survives
it. It also stores marks in a fixed
order and merges neighboring runs, so the same formatting always hashes to the
same git blob.

A source's link is only ever made into a link after `isSafeLink` accepts it
(http, https or mailto), the same rule VAKT links follow.

## Inline text: prompts and steps

A question's `prompt` and each of a math question's `steps[].text` are one
line each, and they can carry what a text block's words can: the three marks,
read-aloud hints and pauses, and formulas. Not footnotes: the Notes list
numbers those through the text blocks, and a prompt has nothing to cite. This
is what the Open Spelling Lesson Format calls rich text on both fields.

A field of inline text holds one of two shapes under one key
(`@spelling-creator/core/inlineText`):

- **a string**, the plain words. Every prompt and step written before this
  existed looks like this, and so does any field nobody has formatted.
- **a document**, a tiptap document of exactly one paragraph in the text
  block's schema, once the field carries a mark, a hint, a pause or a formula.

One key rather than the text block's two, because the collaboration document
merges a block key by key, so a field with one key is simply last write wins,
as a plain prompt always was. Every writer stores the smaller shape
(`normalizeInlineText`): the editor, the importers and the MCP server all
write a plain string back for a field with nothing in it a string couldn't
hold, so a lesson nobody has formatted is byte for byte what it was. The
normalizer also folds several paragraphs into one line, with a space where
each break was, drops any footnote, and sets a `display` formula in the line.

Nothing reads either shape directly. `inlineTextContent` gives the document
(what the editor shows), `inlineTextRuns` the runs a renderer draws (one
paragraph of `textBlockParagraphs`), `inlineTextPlain` the plain words (a
formula as its source), `inlineTextSpeech` in `core/speech` the spoken runs,
and `inlineTextMarkup` and `markupToInlineText` the MCP server's markup. The
checks, translation, search, the summaries, the AI helpers and the response
snapshot interactive mode saves all take the plain words. In OSLF a prompt is
written as rich text and read back as inline text (`oslf.ts`), so a formula
or a hint in a prompt survives the round trip; a note in one is read as
nothing.

An answer is not inline text: `answer` and `answers[].text` are plain
strings, and spelling words and VAKT activities likewise. A lesson can still
arrive with a single answer in the document shape, written by a client that
gave the answer field the prompt's editor, and read as a string that is
"[object Object]", which a number field then fails to parse. So every reader
of a single answer (`questionAnswerItems`, the editor's fields, interactive
mode, the AI fixes) and the importer go through `questionAnswerPlain` in
`core/questions`, which takes the words of whatever shape is there.

## Read-aloud hints

A text block can say how its words are read aloud without changing how they
show. These are the [Open Spelling Lesson Format](https://github.com/playforge-coding/open-spelling-lesson-format)'s
four read-aloud controls, a small subset of SSML:

| Hint          | Stored as                                             | SSML                                   |
| ------------- | ----------------------------------------------------- | -------------------------------------- |
| Pronunciation | speech mark `{ ipa: "freɪˈnɛl" }`                     | `<phoneme alphabet="ipa" ph="...">`    |
| Substitution  | speech mark `{ alias: "World Wide Fund for Nature" }` | `<sub alias="...">`                    |
| Spell-out     | speech mark `{ sayAs: "characters" }`                 | `<say-as interpret-as="characters">`   |
| Pause         | inline node `{ type: "pause", attrs: { length } }`    | `<break strength="medium">` / `strong` |

```json
{
  "type": "text",
  "text": "Fresnel",
  "marks": [
    { "type": "italic" },
    { "type": "speech", "attrs": { "ipa": "freɪˈnɛl" } }
  ]
}
```

A run carries at most one hint, so `normalizeSpeechHint` keeps exactly one of
the three (an IPA first, then an alias), and drops the slashes or brackets a
pronunciation copied from a dictionary comes with. The speech mark is stored
after the formatting marks, and two neighboring runs merge only when their
hints match too. A pause's `length` is `short` or `long`.

The hints are not formatting. `textBlockFormattedSpans`, the lesson checks and
the formatting quick fixes ignore them, and a run that only carries a hint
isn't counted as formatted. Every renderer that shows or prints a lesson (the
lesson page, Preview, interactive mode, Word, PDF) draws a hinted run as its
text and a pause as nothing. In the editor, a hint is a dotted underline with a
tooltip, and a pause a small labelled chip whose label comes from CSS
(`.lesson-pause`), so it adds no characters to the text the collaboration
cursors count.

Read-aloud is the only reader. `textBlockSpeech` in `@spelling-creator/core/speech`
turns a block into spoken text, one line per paragraph, and
[interactive mode](./interactive-mode.md#reading-aloud) hands that to the voices.

## Formulas

A formula is the format's math run, stored as an inline atom:

```json
{
  "type": "math",
  "attrs": {
    "format": "asciimath",
    "source": "120 xx 3 = 360",
    "display": false,
    "spoken": null
  }
}
```

`format` is `asciimath` or `tex` (a notation this version doesn't know is kept,
and its source shown, as the format asks), `source` the formula as written with
no delimiters, `display` whether it sits on a line of its own, and `spoken`
the author's words for read-aloud (spoken text, as a string or runs), or null
for speech made from the formula. `normalizeFormula` cleans it. As plain text
(`textBlockPlain`, and so search, the checks and the MCP server's grounding) a
formula is its source. `isPlainContent` is false for a block with one.

### Rendering

[MathJax 4](https://www.mathjax.org/) renders formulas, through its source
package (`@mathjax/src`) rather than a prebuilt bundle, so the app loads
exactly the TeX and AsciiMath parsers and the SVG output it uses, as one lazy
chunk. It is heavy (about half a megabyte compressed with its font), so:

- `core/browser/formulas.js` is the light door: `lessonFormulas(doc)`,
  `loadFormulas()` (one dynamic `import()` of `formulaBrowser.js` per page),
  `renderLessonFormulas(doc)` for the exports and `formulaWords(formula)` for
  speech. A lesson without a formula never loads MathJax.
- `core/browser/formulaEngine.js` makes a renderer for a MathJax DOM adaptor
  (the browser's, or the lite one in tests): `render({ format, source,
display })` gives the MathML tree and string and the typeset SVG as a node,
  and `error` when the source didn't parse (MathJax's `noerrors` and
  `noundefined` show the problem in red in place of the formula). The TeX
  parser has only the `base` and `ams` packages, so `\href` and `\require`
  are unknown commands: a formula can't make a link, load an extension or run
  anything, as the format requires.
- MathJax's AsciiMath parser is its legacy (MathJax 2) code, CommonJS that
  reads `arguments.callee`, which throws in the strict-mode ES modules Vite
  and Rolldown produce (MathJax's own bundles are built with webpack, which
  keeps CommonJS sloppy). `patches/@mathjax__src@4.1.3.patch` rewrites those
  few lines to name the functions instead; the patch applies on install
  (`patchedDependencies` in `pnpm-workspace.yaml`) and has to be carried
  forward when MathJax is updated.
- `core/browser/formulaBrowser.js` is the browser wiring: the page's own
  document, MathJax's stylesheet appended once, the font's dynamic glyph files
  (double-struck, script and so on) as chunks of the build found by
  `import.meta.glob`, and `formulaImage(node)`, a formula as a PNG for the
  PDF.
- `apps/web/src/lib/formulas.js` caches each render per page and
  `Formula.jsx` draws it: the source as text until MathJax has it (and on the
  server, and wherever it can't be rendered), then the SVG, put in the page as
  the nodes MathJax built, never through innerHTML. A screen reader gets the
  formula's MathML, visually hidden, beside the SVG; in the editor the source
  stands there instead, because the collaboration cursors count characters
  over the block's plain text and a formula's share of that is its source.

### Speech

The speech rule engine (`speech-rule-engine`, the engine behind MathJax's own
accessibility tools) turns MathML into words: "60 over 5 equals 12", "x
squared", "the square root of 81". `core/browser/formulaSpeech.js` loads it
with ClearSpeak rules fed from the app's own assets (the engine's `base` and
`en` rule files, about 100 KB compressed), never its default CDN. In spoken
text (`core/speech.ts`) a formula is its author's `spoken` words, or a
`{ text: source, formula }` run that `withFormulaSpeech` replaces with the
engine's words just before a step is spoken (`useSpeech.js`); a formula that
can't be parsed is read as its source.

### Word and PDF

`formulaDocx.js` turns the MathML tree into the `docx` library's math
components (fraction, superscript, subscript, radical, runs), which Word
writes as a native equation. The exports render every formula first
(`renderLessonFormulas`) and hand the map to `buildDocument`; without it a
formula prints as its source. The PDF path's docx goes through mammoth, which
drops equations, so that path asks for formulas as pictures
(`formulasAs: "image"`): each is an `ImageRun` of the PNG `formulaImage`
made, with alt text that names the formula so `pdfExport.js` can give the
`<img>` mammoth makes its size. A display formula is a centered paragraph of
its own, and in the PDF counts as a picture in the `embedded` list, since it
sits alone in its paragraph the way a lesson picture does.

## Numbering

A footnote's number is its position in reading order across the whole lesson,
the way Word numbers footnotes, so the page, the printout and the editor agree.
`footnoteStarts(doc)` gives each text block the count of footnotes before it.
The lesson page adds a footnote's own index to that. The editor doesn't compute
numbers at all: each block's editor starts a CSS counter at its block's count
(`counter-reset: lesson-footnote N`) and every marker increments it, so the
numbers update the moment a footnote is added anywhere, with nothing walking the
document on each keystroke.

## Where it shows up

- **Lesson page and preview.** Formatting renders as written. Each footnote is
  a superscript number linking down to the Notes list, and each note links back
  up. The Sources list follows the notes. A prompt and a step draw through
  `InlineText.jsx`, which is `TextRuns` over `inlineTextRuns`.
- **The editor.** A prompt and a step get `LessonLineInput.jsx`: the text
  block's tiptap schema less the footnote node, with the document held to one
  paragraph (so Enter does nothing and a pasted passage lands as one line),
  and the same toolbar (`LessonTextToolbar` with `footnotes={false}`) shown
  only while the line is being edited. Both editors commit through
  `lib/useLiveEditor.js`, which holds the pause-then-commit and held-off
  remote change behavior the plain fields have; the line editor commits
  `normalizeInlineText` of its document, so a plain line is stored as a string.
- **Word and PDF export.** Formatting becomes Word run formatting, and footnotes
  become real Word footnotes at the foot of each page. A prompt's runs each
  wear the question's character style, so the importer reads the whole prompt
  back off the styled spans; a formula in a prompt or a step is an equation
  (or a picture, on the PDF path) in the line, and `lessonFormulas` collects
  formulas from prompts and steps as well as text blocks. The Sources list closes
  the document under a "Sources" line, written with its own paragraph styles so
  the PDF can style it and the importer can recognize it (`S2C Sources
Heading` and `S2C Source Entry`; the footnote locator and note are the
  character styles `S2C Footnote Locator` and `S2C Footnote Note`, all defined in
  `lessonLayout.ts`; the `S2C` prefix is a historical name kept so Word round
  trips keep working). The PDF goes through
  mammoth, which turns the footnotes into a list at the end; `layoutNotes` in
  `pdfExport.js` moves that list above the Sources list and heads it "Notes".
- **Word import.** Bold, italics and underlining come back. Word footnotes and
  endnotes come back as footnotes. A Sources list this app exported is read back
  into the lesson's sources. Inside each footnote the exporter gives the locator
  and the note their own character styles, which Word ignores, so a citation
  comes back exactly, with its page and its note. Reading them off the text
  wouldn't work: a locator usually has a full stop in it ("p. 12"). A footnote
  without those styles (from an older export, or from anywhere else) becomes a
  citation only when it is exactly the citation, or the citation followed by a
  note; anything else is kept as a note. Image captions get a paragraph style
  too, so a text paragraph that happens to start in italics isn't taken for the
  caption of the picture above it, and so do image
  [credits](./images.md), so they come back as credits.
- **Word import.** Read-aloud hints and pauses have no place in a Word
  document, so a Word round trip loses them. A prompt and a step come back
  as their plain words.
- **JSON import and export.** Lossless. Citations of a source the file doesn't
  list are dropped on import (keeping any note), since they would print as
  "Source no longer listed." (`MISSING_SOURCE_TEXT`). A footnote citing a source that is in the list but
  not filled in yet names it "Untitled source" (`UNTITLED_SOURCE_TEXT`).
- **Interactive mode.** Formatting shows, footnote markers don't. That screen is
  what the speller reads, and a number with nowhere to lead is clutter there. The
  read-aloud voice reads the words with their hints and pauses, in a prompt as
  in a passage (`inlineTextSpeech`); the revealed working draws each step's
  formulas, and the saved response snapshot keeps the prompt's plain words.
- **Translation.** Each paragraph's plain words translate as one segment, so a
  translated paragraph loses its formatting and keeps its footnote markers at
  its end. Footnote notes translate. Citations and the Sources list don't: an
  author, a title and a publisher are names. See
  [Lesson translation](./lesson-translation.md).
- **Summaries, search, spelling words and AI helpers** read the plain words.

## Collaboration, history and merging

A text block's content is still one value in the live-collaboration document,
so two people typing in the same block at the same moment is last write wins,
as it was for the plain string. Different blocks merge cleanly. The sources are
a keyed list, so two people editing different sources merge too. The text
editor commits about 200ms after a pause, and holds off a change from elsewhere
while you're in that block, the same way the plain fields do. Leaving a block
only writes it back if you changed it: otherwise it catches up with whatever
arrived while you were there, so clicking in and out never writes a stale copy
over a collaborator's edit. (The plain fields, `useLiveField`, behave the same
way.)

In [version history](../version-history.md), the sources are stored in
`lesson.json` next to the title, and show up as their own operations ("add
source", "edit source", "remove source", "reorder sources"; see
`packages/core/src/git/ops.ts`). When merging, a text block's words are treated as one
field whichever shape they're in. So one side formatting a word while the other
fixes a typo is a conflict the user sees, rather than two edits to different
fields that merge "cleanly" and hide the typo fix. Sources merge without asking:
a source either side added or edited comes through, and where both changed the
same field of the same source, yours stands.

## The MCP server

Assistants write text blocks as a small markup and are told to leave text plain
unless a convention needs formatting. Heavy formatting is rejected on save.
Read-aloud hints borrow Pandoc's bracketed spans: `[FRESNEL]{ipa: freɪˈnɛl}`,
`[WWF]{say: World Wide Fund for Nature}`, `[REEF]{spell}`, and `{pause}` or
`{pause: long}`. A formula is `{asciimath: 120 xx 3 = 360}` or
`{tex: \frac{60}{5} = 12}`, with `display` after the notation for a line of
its own and a `{spoken: ...}` straight after it for its read-aloud words; it
runs to the brace that balances its opening one, with no escapes inside (TeX
is full of braces and backslashes), so its braces have to balance; one whose
braces don't is written with `escaped` after the notation and a backslash
before each brace and backslash, which `contentToMarkup` does itself. A `{` in
plain text is escaped as `\{`, so text read out of a lesson can be written
straight back (`contentToMarkup` and `markupToContent` in `lessonText.ts`). See
[Lesson validation](../mcp-server/lesson-validation.md) and [Tools](../mcp-server/tools.md).
