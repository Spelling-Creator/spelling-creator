---
title: AI lesson fixes
---

# AI lesson fixes

Some things the [lesson checks](./lesson-checks.md) find can be fixed by a
script: bold is removed by removing the bold. Most can't. A green answer that
isn't in its passage could be fixed by changing the answer or by changing the
passage, and only something that understands both can say which. For those the
Check panel has a **Fix with AI** button.

## What the author sees

1. **Fix with AI** under a finding opens a dialog over the Check panel, headed
   with the finding.
2. After the Turnstile challenge, **Suggest a fix** asks the Worker for one.
   Skeletons show while it works.
3. The fix comes back as a short explanation and a before-and-after of every
   block it changes, as a word diff, so a one-word change in a long passage is
   easy to spot. Only the fields that changed are shown (the answer, the prompt,
   the passage, the spelling words, the type).
4. **Apply** makes the change. **Try again** asks for a different fix.
   **Cancel** leaves the lesson alone.

An applied fix works like a [quick fix](./lesson-checks.md#fixing-findings): the
lesson as it stood is saved as a version first, and the Check panel offers
**Undo** until the lesson changes again. After that, History can undo it.

If the fix would add new suggestions (warnings) to the panel, the dialog says
how many before it is applied. A fix that would add a problem (an error) is never
shown at all.

## Which findings

`AI_FIX_CODES` in `packages/core/src/lessonAiFixes.js` lists them. They are the
findings about one section whose fix is a change to that section's text,
questions or spelling words:

- answers not in the passage, or in it when they shouldn't be
  (`E_GROUNDING_*`, `E_ORANGE_PARAPHRASED`, `E_BACKGROUND_IN_TEXT`)
- orange questions that give their answers away, aren't a list, have the wrong
  number of answers, multi-word answers or no blank (`E_ORANGE_ANSWER_IN_PROMPT`,
  `E_ORANGE_NOT_A_LIST`, `W_ORANGE_*`)
- prompts that give another question's answer away (`E_ANSWER_REVEALED_CROSS`,
  `W_ANSWER_REVEALED_OPEN`)
- spelling words that are the wrong length, repeated, hidden in an answer or
  already vocabulary (`E_SPELLING_*`, `W_SPELLING_IN_CAPS`)
- answers or numbers used twice (`E_ANSWER_WORD_REUSED`, `E_NUMBER_DUPLICATE`)
- question wording (`E_RETIRED_STEM`, `W_WYR_SHAPE`, `W_OPEN_SPLIT`,
  `W_NUMBER_NO_STEPS`)

Left out are the findings with a quick fix, the shape of the whole lesson or a
section's question order (adding six sections is not a fix), and footnotes that
cite a missing source.

## How a fix is made

1. The editor sends the lesson and the finding's key to the Worker with
   `mode: "fix"`.
2. The Worker finds the finding again, shows the model the section
   (`fixContext`), and turns the model's edits into operations
   (`aiEditsToOperations`).
3. `checkFix` decides whether the fix passes. If it doesn't, the model is told
   why and tries once more.
4. The Worker answers with `replace_block` operations and the explanation.
5. The editor runs `checkFix` again on the lesson as it is now, shows the
   preview, and applies the fix on **Apply**.

The editor sends the whole lesson, since the checks are lesson-wide, and the
`key` of the finding. Image blocks go as their id and type only. The Worker runs
the checks itself and looks the finding up by its key rather than trusting a
description of it, so the prompt carries the checker's own `message`: prose
already written for a model, naming the fix. A finding that is no longer there
is refused with a 409, and one that isn't in `AI_FIX_CODES` with a 400, both
before Turnstile or the rate limiter.

The model sees the finding's section block by block, in the same input shape the
[MCP server](/mcp-server/tools) takes: text blocks as markup (so formatting and
`^[...]` footnotes survive), every list as plain strings. Images and VAKT
activities are shown but marked as not editable. It is also given the spelling
words and answers used in other sections, so a replacement doesn't collide with
one, and a short summary of the question types. The rules it is held to: fix
this one problem, change as little as possible, and never change a fact, number,
date or name.

It answers with `FIX_SCHEMA` (`apps/api/src/lib/lessonFix.js`): an explanation
and a list of edits, one per block, where an empty field means "keep it".
`aiEditsToOperations` turns each edit into a `replace_block` operation for
`@spelling-creator/core/lessonPatch`, merging it with the block as it was. An
edit that names a block outside the section, or one that may not change, is
refused.

`checkFix` then makes the operations on a copy and runs the checks before and
after. A fix passes only if:

- the finding's key is gone,
- no new error appeared (`newFindings`, the same filter `patch_lesson` uses), and
- no text block lost a footnote.

If the first try fails, the model is shown its edits and what was wrong with
them, and asked once more (`FIX_ATTEMPTS`). If that fails too, the Worker answers
422 and the dialog says no fix passed.

The editor runs `checkFix` again on the lesson as it is when the fix arrives,
and once more when Apply is pressed, since the author may have edited the lesson
in the meantime. Operations address blocks by id, so a fix still lands on the
right block after other edits, and is only refused when it no longer passes.

`applyFixOperations` keeps everything the fix didn't touch as the very same
objects, keeps the ids of list items whose text didn't change (so the editor's
fields stay put), and stores a changed text block as a document, the way the
editor does (see [Rich text](./rich-text.md)).

## Cost and limits

A fix is one Turnstile check and one rate-limit token, like the other
[AI helpers](./ai-text-suggestions.md), and one or two model calls. Nothing is
cached: asking again should give a different fix. A request is refused with a
413 if the lesson is over 300,000 characters as JSON.

## Where the code is

| File                                                   | Does                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `packages/core/src/lessonAiFixes.js`                   | `AI_FIX_CODES`, `fixContext`, `aiEditsToOperations`, `applyFixOperations`, `checkFix`. Shared.    |
| `apps/api/src/lib/lessonFix.js`                        | The prompt, `FIX_SCHEMA`, finding the finding again, and the two tries.                           |
| `apps/api/src/routes/ai.js`                            | The `fix` mode: input checks, Turnstile, rate limit.                                              |
| `packages/core/src/aiSuggest.js`                       | `suggestFix()`, the browser's call to the Worker.                                                 |
| `apps/web/src/components/editor/AiFixDialog.jsx`       | The dialog, the preview and the word diff (`diff`'s `diffWordsWithSpace`).                        |
| `apps/web/src/components/editor/LessonChecksSheet.jsx` | The **Fix with AI** button, shown only when the instance has an API and a Turnstile key.          |
| `apps/web/src/pages/EditorPage.jsx`                    | `applyAiFix`, which checks the fix once more and applies it through the same path as a quick fix. |
