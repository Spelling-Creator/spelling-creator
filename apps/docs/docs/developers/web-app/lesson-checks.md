---
title: Lesson checks
---

# Lesson checks

For how to use this, see [Lesson checks](../../guide/lesson-checks.md).

The editor checks a lesson against the lesson standard as it is written. The
checks are the same code the [MCP server](../mcp-server/lesson-validation.md)
runs on every write: `@spelling-creator/core/lessonChecks`. The rules that need
judgment live in `apps/mcp/src/standards.md`; the checks are the mechanically
checkable half of it.

The standard's numbers are defaults, not universal rules. The question types
follow the
[Open Spelling Lesson Format](https://github.com/playforge-coding/open-spelling-lesson-format),
and the split of the "semi-open" orange type into a tight and a loose end, with
their order, is the app's own (see the comments in
`packages/core/src/questions.ts` and at `ORANGE_TIGHT` in
`lessonChecks.js`); the short answer rules come from letterboard spelling,
where every letter is pointed to; the lesson shape (`SECTION_COUNT`,
`SPELLING_WORDS_PER_SECTION`, `QUESTION_ORDER`) is the app's own default. Other
Spelling practices do things differently, which is part of why most shape
rules are warnings.

## In the editor

- **Check** in the editor's top bar (and **Check lesson** in the phone overflow
  menu) opens the panel at `/editor/check`, with a red badge counting problems.
- `SectionOutline.jsx` shows a problem count beside each section that has one.
- Choosing a finding closes the sheet, then `goToFinding` in `EditorPage.jsx`
  leaves Preview, expands the section, scrolls the block into view and focuses
  a field (see [Two descriptions of every finding](#two-descriptions-of-every-finding)
  for how it picks which one).
- Below the findings sits the Facts section (`FactCheckSection.jsx`), which runs
  only on request. See [Fact checking](./fact-checking.md).

Nothing blocks. A lesson with problems saves, exports, publishes and prints
exactly as before.

## Problems and suggestions

The checks report two levels, and the editor keeps the MCP server's split
between them:

| Level      | From core | In the editor                                                                    |
| ---------- | --------- | -------------------------------------------------------------------------------- |
| Problem    | errors    | Always listed, counted in the bar and the outline.                               |
| Suggestion | warnings  | Folded away behind **Show N suggestions**, and never counted anywhere but there. |

The line between them is whether a legitimate lesson could ever trip the check.
An MCP write is rejected on an error and carries warnings along with a
successful one; the editor blocks on neither.

The full list of codes and what trips each one is in
[Lesson validation](../mcp-server/lesson-validation.md). The editor's wording
for each is in `apps/web/src/locales/en/checks.json` under `codes`.

## Quick fixes

A finding whose fix needs no judgment gets a button under it in the panel.
The fix is made straight away, the panel stays open, and the finding drops off
the list once the checks rerun. A click on a finding that has already gone
stale (the panel lags an edit by a beat, or a collaborator fixed it first)
says so in a toast (`fix.gone`) rather than doing nothing.

| Code                                             | Button (`quickFix` in `checks.json`)  | What it does                                                                                                                     |
| ------------------------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `W_FORMAT_BOLD`                                  | Remove the bold                       | Takes bold off every text block in the section. Italics and underlining stay.                                                    |
| `W_FORMAT_UNDERLINE`                             | Remove the underlining                | The same for underlining.                                                                                                        |
| `W_FORMAT_CAPS`                                  | Remove the formatting                 | Unformats the ALL-CAPS spans only.                                                                                               |
| `E_FORMAT_HEAVY`                                 | Remove all formatting in this section | Every mark in the section's text, italics included.                                                                              |
| `E_FORMAT_LONG_EMPHASIS`, `E_FORMAT_LONG_ITALIC` | Make it plain                         | Unformats the one long span the finding quotes.                                                                                  |
| `W_VAKT_NOT_LAST`                                | Move it to the end                    | Moves the section's VAKT activities to its end, keeping their order.                                                             |
| `W_ORANGE_ORDER`                                 | Swap them                             | Puts the tight orange question in the first orange slot.                                                                         |
| `E_ORANGE_PARTIAL_LIST`                          | Accept "silt" too                     | Adds the item the passage's list goes on to as an accepted answer. A two-word item gives its last word: "fine silt" adds "silt". |

Before a fix is made, `applyLessonFix` in `EditorPage.jsx` commits the lesson
as it stood, so the fix is a version of its own in Version history and
**Undo this change** there can take it back at any time. The panel then shows
**Fixed.** with a quicker **Undo**. It stays only while nothing else has
changed: once the lesson has been edited again, putting the old lesson back
would throw that edit away too, so the line goes and Version history is the
way back. The Undo is in the panel rather than in a toast because the panel is
modal, and while it is open nothing outside it can be clicked.

Most findings need judgment instead: whether to change an answer or the
passage it should be in, say. Those get **Fix with AI**, which shows the fix
before making it. See [AI lesson fixes](./ai-lesson-fixes.md).

The quick fixes live in `packages/core/src/lessonFixes.js`. Each takes the
document and the finding and returns the fixed document, or null when there is
nothing left to do. Only the section and blocks a fix touches are new objects,
and text blocks are written with `withTextBlockDocument`, the way the editor
writes them. `QUICK_FIX_CODES` lists the codes and `hasQuickFix(finding)` is
what the panel asks.

## How it fits together

| File                                                   | Does                                                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `packages/core/src/lessonChecks.js`                    | The checks. `validateLesson(doc)` returns `{ errors, warnings }`.                                           |
| `apps/web/src/lib/lessonChecks.js`                     | `useLessonChecks(doc)`, the per-section tallies, and `describeFinding`, which words a finding for a person. |
| `packages/core/src/lessonFixes.js`                     | The quick fixes. `applyQuickFix(doc, finding)` returns the fixed document or null.                          |
| `apps/web/src/locales/en/checks.json`                  | The editor's wording for every code, under `codes`, and the fix buttons, under `quickFix`.                  |
| `apps/web/src/components/editor/LessonChecksSheet.jsx` | The panel.                                                                                                  |
| `apps/web/src/components/editor/checkGroups.js`        | Grouping findings by section and naming the groups, shared with the panel's Facts section.                  |
| `apps/web/src/components/editor/SectionOutline.jsx`    | The per-section counts.                                                                                     |

`validateLesson` takes the canonical document, which is the shape the editor
already holds in state, so the editor passes it `doc` with no conversion.

The checks are cheap (about a millisecond on a full six-section lesson). What
isn't cheap is the page that calls the hook, which is the whole editor, so the
hook is built to avoid rendering it again. It reruns the checks once editing has
paused for 300ms (`SETTLE_MS`), and replaces its result only when a finding
actually changed. Most edits (typing inside a passage, say) change none, so
they cost no render beyond their own. A test in `lessonChecks.test.js` holds it
to that.

It is also wrapped so that a bug in one check logs an error and shows nothing,
rather than taking the editor down. An empty lesson is not checked at all; its
only finding would be "0 sections", greeting everyone who opens the editor.

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
- `itemId`: within that block, the one spelling word or orange answer the
  finding is about. The editor focuses the field whose `data-collab-field` ends
  in that id, so a finding about "ash" lands on "ash", not on the first word in
  the list, even when the same word appears twice. Without one, it focuses the
  block's first field.

Values quoted from the passage keep the passage's own casing. The checks compare
uppercased text, but a word shown back as SILT would read as vocabulary, which
is what ALL CAPS means in a lesson.

The editor ignores `message` and renders `t("codes.<code>", params)` from the
`checks` namespace. The MCP server sends only `code`, `section` and `message` to
the model (`toWireWarnings` in `apps/mcp/src/tools.js`), so the extra fields
never reach it.

A code with more than one wording uses an i18next context, chosen by the
`CONTEXTS` table in `lib/lessonChecks.js`: `E_SPELLING_DUPLICATE_same` for a word
listed twice in one section, `E_ANSWER_WORD_REUSED_inside` for an answer found
inside a longer one, `E_FORMAT_LONG_EMPHASIS_bold` for bold rather than
underlining, `E_FORMAT_HEAVY_share` when a section broke the share limit rather
than the span count (core says which, in `params.tooMany`),
`W_ORANGE_ANSWER_COUNT_open` for a suggested answers question with no answers,
and `W_WYR_SHAPE_many` for a prompt that chains several "or"s. A collision with
a question in the same section names it as "question 2" rather than "section 1,
question 2".

### Keeping the wording in step

`apps/web/src/lib/lessonChecks.test.js` reads every `E_`/`W_` code out of the
core source and fails if `checks.json` is missing the base wording for one (the
one a finding falls back to when no context applies), is missing a wording for
any context in `CONTEXTS`, or still has wording for a code core no longer
reports. It also fails if `quickFix` doesn't label exactly the codes in
`QUICK_FIX_CODES`.

It checks that the wording exists, not that a finding's `params` fill it in.
That is only exercised for the codes its fixture lesson trips, so a new check
needs its `params`, a line in `checks.json`, and a case in that fixture.
