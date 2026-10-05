---
title: Lesson checks
---

# Lesson checks

The editor checks a lesson against the lesson standard as it is written, so an
author can see what an AI assistant would have been told to fix without asking
one. The checks are the same code the [MCP server](/mcp-server/lesson-validation)
runs on every write: `@spelling-creator/core/lessonChecks`.

## What the author sees

- **Check**, in the editor's bar (and **Check lesson** in the phone overflow
  menu), with a red count of problems. It opens a side panel at `/editor/check`.
- **A count beside each section in the outline** that has problems, so where the
  work is left is visible without opening anything.
- **The panel** lists findings grouped by section, in document order. Choosing
  one closes the panel, takes the editor out of Preview, expands the section if
  it was collapsed, scrolls the block into view and puts the cursor in its first
  field.

Nothing blocks. A lesson with problems saves, exports, publishes and prints
exactly as before.

## Problems and suggestions

The checks report two levels, and the editor keeps the MCP server's split
between them:

| Level      | From core | In the editor                                                                    |
| ---------- | --------- | -------------------------------------------------------------------------------- |
| Problem    | errors    | Always listed, counted in the bar and the outline.                               |
| Suggestion | warnings  | Folded away behind **Show N suggestions**, and never counted anywhere but there. |

Problems are things that would confuse the speller or mark a right answer wrong:
a single answer that isn't in its passage, a spelling word hidden inside an
answer, two number questions with the same answer, a multiple-answers question
that accepts only part of the list the passage gives.

Suggestions describe the usual shape of a lesson: six sections, four spelling
words a section, fifteen questions in a set order. The standard calls those
defaults, to be dropped when someone wants something different, so an author
who wrote a three-section lesson on purpose sees them only if they ask.

The full list of codes and what trips each one is in
[Lesson validation](/mcp-server/lesson-validation).

## How it fits together

| File                                                   | Does                                                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `packages/core/src/lessonChecks.js`                    | The checks. `validateLesson(doc)` returns `{ errors, warnings }`.                                           |
| `apps/web/src/lib/lessonChecks.js`                     | `useLessonChecks(doc)`, the per-section tallies, and `describeFinding`, which words a finding for a person. |
| `apps/web/src/locales/en/checks.json`                  | The editor's wording for every code, under `codes`.                                                         |
| `apps/web/src/components/editor/LessonChecksSheet.jsx` | The panel.                                                                                                  |
| `apps/web/src/components/editor/SectionOutline.jsx`    | The per-section counts.                                                                                     |

`validateLesson` takes the canonical document, which is the shape the editor
already holds in state, so the editor passes it `doc` with no conversion. The
hook runs it through `useDeferredValue`: a long lesson never makes typing wait,
because React reruns the checks once it has nothing more urgent to render. It is
also wrapped so that a bug in one check logs an error and shows nothing, rather
than taking the editor down. An empty lesson is not checked at all; its only
finding would be "0 sections", greeting everyone who opens the editor.

### Two descriptions of every finding

Each finding carries `message`, prose written for a model: it names fields in
backticks and ends by telling the model to resubmit or pass `skipValidation`.
None of that makes sense to a person, and it isn't translated. So findings also
carry:

- `params`: the same facts as data (the answer, the word, the question number,
  the other question in a collision).
- `sectionId` and `blockId`: where to go. A question's finding points at the
  question, a spelling word's at its spelling block, a formatting finding at the
  text block holding the first offending span. Findings about a section's shape
  point at its first relevant question.

The editor ignores `message` and renders `t("codes.<code>", params)` from the
`checks` namespace. The MCP server sends only `code`, `section` and `message` to
the model (`toWireWarnings` in `apps/mcp/src/tools.js`), so the extra fields
never reach it.

A code with more than one wording uses an i18next context, picked in
`describeFinding`: `E_SPELLING_DUPLICATE_same` for a word listed twice in one
section, `E_ANSWER_WORD_REUSED_inside` for an answer found inside a longer one,
and so on. A collision with a question in the same section names it as
"question 2" rather than "section 1, question 2".

### Keeping the wording in step

`apps/web/src/lib/lessonChecks.test.js` reads every `E_`/`W_` code out of the
core source and fails if `checks.json` has no wording for one, or still has
wording for a code core no longer reports. Adding a check to core therefore
means adding its `params` and a line to `checks.json` in the same change.
