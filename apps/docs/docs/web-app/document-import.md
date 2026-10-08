---
title: Import from text
---

# Import from text

**Import from text** (`DocumentImportDialog.jsx`) turns a lesson that exists
only as a document into a lesson in the editor: text pasted from anywhere, a
`.txt` or `.md` file, or a Word file written by hand rather than exported from
this app. It sits beside the other two imports in the editor's menu and on the
empty-lesson screen, and like them it opens the result as a new lesson of its
own (see [Lessons on this device](./local-lessons.md)).

The app's own formats have lossless paths: a JSON lesson file goes through
`jsonImport`, and a Word file exported from here through `docxImport`, which
reads the question types back from the named styles the exporter writes (see
[Export pipeline](./export-pipeline.md)). This import is for everything else,
where nothing in the text says what a question's type is, and it reads the
document the way a person would.

## What the author sees

1. A dialog with a text box and a **Choose file** button. Pasting, typing or
   picking a file fills the box; a `.docx` is read as plain text through
   mammoth, in the lazy export chunk.
2. As the text changes, the dialog shows what it found: the title, each
   section's name, and how many paragraphs, spelling words and questions it
   holds, with how many of the questions carry an answer. When nothing lesson-
   shaped is there yet, it says what the text needs.
3. **Import as a new lesson** opens the result in the editor, with a note that
   the question types and answers were worked out from the wording and should
   be checked. The [lesson checks](./lesson-checks.md) then apply as they do to
   any lesson.

## What it reads

The parser (`packages/core/src/documentImport.js`) is rules, not a model. It
classifies each line, cuts the document into sections, and reads each section:

- **A passage**: one or more prose paragraphs, each its own text block.
- **A spelling line**: "Spell:", "Spelling words:", "Spelling list", "Words:"
  and the like, the words separated by commas, spaces or the gap this app's
  export prints.
- **Questions**, one per line, numbered, bulleted, prefixed "Q:" or bare. An
  answer can follow in any of the usual ways: after a gap (this app's export),
  as "(Answer: a; b)", as "[a, b]", on the next line as "A: ...", after a colon
  at the end, or as a bare run of CAPITALS. A question that ends on its question
  mark or on "Explain your thinking." has no answer glued to it.
- **Working-out** under a number question, as numbered lines or a "Working
  out:" line.
- **A VAKT line**, which becomes a VAKT block.

A new section starts wherever a passage follows questions or a spelling line. A
short heading line directly before a passage names the section; the by-line
and age line this app prints under a title do not. Anything after the last
section (sources, footnote bodies) is dropped. The first line is the title.

The **question type** is derived, never read: "Would you rather" is `wyr`, "in
your own words" is `paraphrase`, no answer is `open`, several answers are
`multiple` (or `multiple_open` when one of them is not in the passage), a
numeric answer is `number`, and a lone answer is `single` when it is in the
passage and `background` when it is not. That is the one place the import can
be wrong in a way the author cannot see at a glance, which is why the message
after importing says to check the types.

## How well it does

Measured in the [document import experiment](/monorepo/document-import-experiment)
on the four newest hub lessons rendered in seven layouts, from this app's own
Word export read as raw text to a page with no headings and the answers as bare
capitals: every passage, spelling word and prompt recovered on every layout,
and every answer except a few on the capitals layout. The derived type agrees
with the lesson's own on about 89 percent of questions; most of the rest are
older lessons that typed "In your own words" questions as open, where the
current standard says paraphrase.

The same experiment is why there is no model in this path: two small on-device
extraction models and two chat models were tried first, whole section and per
line, and the rules beat all of them on every column.

## Where the code is

| File                                                      | Does                                                                                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/documentImport.js`                     | `classifyLine`, `splitSections`, `parseSection`, `deriveQuestionType`, `previewLessonText`, `importLessonText`. Runtime-neutral. |
| `packages/core/src/browser/documentText.js`               | `documentFileText`: a `.docx` as raw text through mammoth, anything else as text. In the export chunk.                           |
| `apps/web/src/components/editor/DocumentImportDialog.jsx` | The dialog: text box, file picker, live preview, import.                                                                         |
| `apps/web/src/pages/EditorPage.jsx`                       | The menu items and `handleImportText`, which opens the result as a new lesson.                                                   |
