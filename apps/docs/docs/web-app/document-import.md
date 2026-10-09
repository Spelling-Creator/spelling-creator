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

A passage line ends on its full stop, question mark or exclamation mark. A
line without one is never taken for a passage, however long, and a numbered
line that runs straight into the next number ("...? (Answer: X) 2. Why...") is
questions, not a paragraph. Short lines that are neither a label nor anything
else the parser knows (a question typed with no question mark, number or
opening question word, say) are kept in their section as **unread lines**
rather than dropped, because they are the sign that the section needs the
model (below).

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

## When the rules cannot read it

Some documents only look like a lesson to a person. For those the dialog
offers **Read with the on-device model**, on devices that can run it:
LFM2-1.2B-Extract fine-tuned on lesson documents, running in the page with
transformers.js on WebGPU, a 643 MB one-time download. `sectionNeedsModel`
decides which sections it is offered for, one of these:

- the parser found no questions in the section;
- the section has unread lines;
- a question has no answer and no closing punctuation, but ends in a run of
  capitals, so the answer is probably still glued on ("Which country
  worshipped cats EGYPT");
- a question holds the next question's number, so several questions came out
  as one.

A document the rules read cleanly never gets the offer, since the rules beat
the model on every regular layout (see the
[experiment](/monorepo/document-import-experiment)). On the 168 sections of
the four newest hub lessons in the seven regular layouts it fires for none.

When the rules find no questions anywhere, the text is still cut into
section-sized pieces the same way (a `loose` split, which the preview and
`importLessonText` treat as no lesson), and every piece is offered to the
model. Only a text with no passage at all goes to it as one piece.

The sections are still split by the rules, one call per section, with the
same prompt the model was trained on (`packages/core/src/documentImportModel.js`,
shared with the training scripts so the two cannot drift). A reply cut off at
the token cap is closed up and keeps what it finished. Sections the parser
read keep the parser's result; only the ones it could not are replaced by the
model's. The model's own question type is kept when it names a real one (it
was right more often than the derived rule in the experiment); otherwise the
type is derived as for the parser. The result is previewed like any other
import, and the lesson checks run on it after.

While it runs, the dialog says which section it is reading from the moment the
model is ready (the engine reports each section as it starts), and a run can be
stopped. A section the model could not read (a reply that is not JSON) keeps
the parser's result and stays on offer, so the button comes back for just the
sections that failed, with a note saying so.

The dialog, `previewLessonText` and `importLessonText` all start from
`readLessonText`, which splits the text and parses each section, and the
preview's counts come from `sectionSummary`, so what the dialog shows and what
an import builds cannot drift apart.

The device bar is the summariser's: WebGPU with f16 shaders on an adapter
whose limits can hold the weights, and not on a metered connection. Without
that the button is not shown. There is no CPU path in the browser: the int8
file that runs well on a CPU is 2.5 GB, and the q4 file is not faithful for
this checkpoint.

What to expect from it: the first fine-tune was trained only on the seven
layouts the rules read, so nothing that reached it looked like its training
data. In the first browser trial, a page with questions written as plain
statements and no answer notation, it took every line for a paragraph and
found no questions. The dataset now adds two layouts the rules cannot read
(questions with no question marks or numbers and the answer tacked on, and a
numbered list run together on one line), and for those it keeps only the
sections the import would actually send to the model, cut and laid out
exactly as the import sends them. The model the app now pins was retrained
on that dataset, and on held-out lessons in those two layouts it scores 96
and 89 percent where the rules get 66 and 40. About one section in twelve
comes back as JSON that does not parse, which the dialog counts as not read.
See the [experiment](/monorepo/document-import-experiment) for the scores.

## Where the code is

| File                                                      | Does                                                                                                                                                                                      |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/documentImport.js`                     | `classifyLine`, `splitSections`, `parseSection`, `readLessonText`, `sectionSummary`, `sectionNeedsModel`, `deriveQuestionType`, `previewLessonText`, `importLessonText`. Runtime-neutral. |
| `packages/core/src/browser/documentText.js`               | `documentFileText`: a `.docx` as raw text through mammoth, anything else as text. In the export chunk.                                                                                    |
| `packages/core/src/documentImportModel.js`                | The model's prompt (schema and type guide), a section's text as it sees it, and `parseModelReply`. Shared with the training scripts.                                                      |
| `packages/core/src/browser/documentModel.js`              | `documentModelPossible` (the WebGPU probe) and `readSectionsWithModel`, which reaches the engine by dynamic import.                                                                       |
| `packages/core/src/browser/documentModelEngine.js`        | The heavy chunk: transformers.js, the model download, one generation per section.                                                                                                         |
| `apps/web/src/components/editor/DocumentImportDialog.jsx` | The dialog: text box, file picker, live preview, import.                                                                                                                                  |
| `apps/web/src/pages/EditorPage.jsx`                       | The menu items and `handleImportText`, which opens the result as a new lesson.                                                                                                            |
