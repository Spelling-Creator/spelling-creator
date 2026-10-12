---
title: AI lesson fixes
---

# AI lesson fixes

Some things the [lesson checks](./lesson-checks.md) find can be fixed with one
click: bold is removed by removing the bold. Most can't. A single answer that
isn't in its passage could be fixed by changing the answer or by changing the
passage, and it takes something that reads both to say which. For those the
**Check lesson** panel has a **Fix with AI** button.

**Fix with AI** only appears when the Spelling Creator site you're using has AI
set up. To make a fix, your lesson is sent to that site's server and on to an
AI service.

## See it in action

<DemoVideo name="editor-check-and-fix-with-ai" title="Checking a lesson and fixing problems with AI">
Two problems from the Check panel fixed with AI: an answer that gave away a
spelling word, shortened, and a spelling word that was too long, swapped for
another. Each change is shown before it's applied. The fixes were written by an
AI model, so yours may differ.
</DemoVideo>

## Making a fix

1. Press **Fix with AI** under a finding. A **Fix with AI** window opens over
   the panel, headed with the finding.
2. Once the verification check has passed, press **Suggest a fix**. Gray
   placeholder lines show while it works.
3. The fix comes back as a short explanation and a before and after of every
   part of the lesson it changes, with the changed words marked, so a one-word
   change in a long passage is easy to spot. Only the fields that changed are
   shown: the text, the spelling words, a question's type, the question, its
   answer or answers, and its steps.
4. **Apply** makes the change. **Try again** asks for a different fix.
   **Cancel** leaves the lesson alone.

An applied fix works like a [quick fix](./lesson-checks.md#fixing-findings):
the panel shows **Fixed.** with **Undo** until you change the lesson again, and
after that **Version history** can undo it.

If the fix would add new suggestions to the panel, the window says how many
before you apply it. A fix that would add a new problem is never shown to you
at all.

## What the AI is asked to do

It is shown the section the finding is in, along with the spelling words and
answers used in other sections (so a replacement doesn't clash with one). It is
told to fix this one problem, change as little as possible, and never change a
fact, number, date or name. Pictures and VAKT activities are shown to it but
can't be changed.

Every fix is checked before you see it. It has to make the finding go away,
add no new problem, and keep every footnote. If the first try fails, the AI is
told what was wrong and tries once more. If that fails too, you see "No fix
passed the lesson checks. Try again, or fix it by hand."

The fix is checked again when you press **Apply**, in case you or someone
editing with you changed the lesson in the meantime. If it no longer fits, the
window says so and you can ask for a new one.

## Which findings can be fixed with AI

The ones about a single section whose fix is a change to that section's text,
questions or spelling words:

- answers that aren't in the passage, or are in it when they shouldn't be
- **Multiple answers** questions that give their answers away, aren't a list
  from the passage, accept too many or too few answers, have answers longer
  than one word, or don't show the blanked out sentence
- questions that give another question's answer away
- spelling words that are the wrong length, repeated, hidden in an answer, or
  already capitalized vocabulary in the passage
- the same answer word or number used twice
- question wording: "a word that comes to mind", a **Would you rather** that
  doesn't read as a choice, and number questions with no worked steps

Left out are the findings that already have a one-click fix, the shape of the
lesson or a section (how many sections, spelling words or questions there are,
and their order), and footnotes that cite a missing source.

## Limits

Each request counts toward the same per-minute limit as the other AI helpers.
Nothing is remembered between requests, so asking again gives a different fix.
A very large lesson (over 300,000 characters of lesson data) is turned away
with "This lesson is too large to fix with AI."

For how fixes are made and checked in the code, see the
[developer notes](../developers/web-app/ai-lesson-fixes.md).
