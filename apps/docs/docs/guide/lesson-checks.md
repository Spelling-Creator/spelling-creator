---
title: Lesson checks
---

# Lesson checks

While you write, the editor looks over your lesson and points out things that
could trip up the speller, along with places where the lesson differs from the
app's usual shape. These are the same rules an AI assistant connected to
Spelling Creator is held to, so you can see what it would have been asked to
fix without asking one.

Nothing here ever stops you. A lesson with problems still saves, exports,
publishes and prints exactly as before.

## See it in action

<DemoVideo name="editor-check-and-fix-with-ai" title="Checking a lesson and fixing problems with AI">
The Check panel's problems for a lesson, two of them fixed with
[Fix with AI](./ai-lesson-fixes.md) (each change shown before it's applied),
and the suggestions. The fixes were written by an AI model, so yours may
differ.
</DemoVideo>

## Opening the checks

- **Check**, in the editor's top bar, opens the **Check lesson** panel. A red
  number beside it says how many problems the lesson has. On a phone, the same
  panel is **Check lesson** in the menu.
- **The outline** shows a count beside each section that has problems, so you
  can see where the work is left without opening anything.

The panel lists what it found, grouped by section in the order they appear in
the lesson. Choosing one closes the panel, leaves Preview if you were in it,
opens the section if it was folded away, and puts the cursor in the field the
finding is about. A finding about one spelling word or one answer lands on that
word or answer.

An empty lesson isn't checked. The panel says "Nothing to check yet. Add a
section to get started."

## Problems and suggestions

The panel sorts what it finds into two kinds:

- **Problems** are "things that would confuse the speller or mark a right
  answer wrong": a known answer that isn't in its passage, a spelling word
  hidden inside an answer, two math questions with the same answer, a
  semi-open question that accepts only part of the list the passage gives.
  They are always listed and counted.
- **Suggestions** describe "the usual shape of a lesson": how many sections,
  how many spelling words, which questions come in which order. They start
  folded away behind **Show N suggestions**, and they are never counted in the
  top bar or the outline. If you wrote a three-section lesson on purpose, you
  only see them if you ask.

## Where these rules come from

The checks encode the app's defaults. They are not rules every Spelling
practitioner follows.

Many of them come from letterboard spelling, where the speller points to every
letter of an answer one at a time. A long answer is real work, so the defaults
keep answers short: spelling words of 6 to 9 letters, single words for the
answers to a semi-open question, and one word answers for the tight
open questions.

The question types follow the
[Open Spelling Lesson Format](https://github.com/playforge-coding/open-spelling-lesson-format),
an open vocabulary for Spelling lessons that isn't tied to any one method. The
colors and the usual lesson shape (six sections, four spelling words a section
and fifteen questions in a set order) are the app's own defaults.

Practitioners who follow a different Spelling practice, or none in particular,
may well make different choices. That's fine. Ignore any suggestion that
doesn't fit how you work. A few conventions show up as problems rather than
suggestions (a spelling word's length, for example, or heavy formatting), and
you can ignore those too: they never block anything.

## What gets checked

**Answers and their passage**

- A **Known** question's answer is written word for word in the
  section's text.
- A **Semi-open** question asks for the items of one list the passage
  gives, uses the passage's own words, and accepts every item in that list. If
  you want the speller to answer in their own words, the panel suggests making
  it a **Suggested answers** question instead.
- A **Prior knowledge** question asks about something the passage doesn't
  say.
- A fill in the blank **Math** question has its number in the text.

**Answers that give each other away**

- A question that names another question's answer, so the speller can copy it
  across.
- A spelling word that appears inside an answer, so the warm up gives the
  answer away.
- The same answer word, or the same number, used for two questions.

**Spelling words**

- Each is 6 to 9 letters long and isn't listed twice, in this section or
  another.
- It isn't already capitalized vocabulary in the passage (a suggestion).
- Four a section is the usual number (a suggestion).

**Question wording**

- "A word that comes to mind" has been used so much it has become a habit, so
  the panel asks for an everyday category instead ("Name something found in a
  hospital").
- A **Would you rather** question starts "Would you rather" and offers two
  options, or a short list joined by one "or".
- A **Semi-open** question quotes the passage's sentence with the list
  blanked out ("The blast sent out ______.") and doesn't give its own answers
  away.
- Every answer to an orange question (**Semi-open** or **Suggested
  answers**) is a single word.
- A **Semi-open** question accepts 2 to 4 answers, and a **Suggested
  answers** question suggests at least one, so whoever is scoring knows what
  would count.

**The usual lesson shape** (all suggestions)

- Six sections.
- In each section: 3 **Known**, 1 **Prior knowledge**, 2 **Math**, 2
  **Semi-open** or **Suggested answers**, 4 **Tight open**, 1 **Paraphrase**,
  then 2 **Broad open**. This is the order the
  [Open Spelling Lesson Format](https://github.com/playforge-coding/open-spelling-lesson-format)
  lists its types in, each asking a little more of the speller than the one
  before. **Would you rather** questions aren't counted; any number can sit
  between the tight opens and the paraphrase. An **Open ended** question from
  an older lesson counts as whichever kind its wording suggests, and the
  suggestion says which kind that was. It points at the first question that
  is out of place.
- One of the two number questions is a word problem with worked steps.
- The VAKT activity comes at the end of the section.
- A section with no questions yet.

**Formatting**

Capitals already mark the vocabulary, so the checks point out bold,
underlining, and formatting on capitalized words. They also flag a section
where too much of the text is formatted, and long runs of bold, underlining or
italics.

**Footnotes**

A footnote that cites a source the lesson doesn't have.

## Fixing findings

Some findings have a button under them that fixes the problem straight away.
The panel stays open, and the finding drops off the list a moment later.

| Button                                    | What it does                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Remove the bold**                       | Takes bold off the section's text. Italics and underlining stay.                                       |
| **Remove the underlining**                | The same for underlining.                                                                              |
| **Remove the formatting**                 | Unformats the capitalized words only.                                                                  |
| **Remove all formatting in this section** | Removes every kind of formatting in the section's text, italics included.                              |
| **Make it plain**                         | Unformats the one long run of formatting the finding quotes.                                           |
| **Move it to the end**                    | Moves the section's VAKT activities to its end, keeping their order.                                   |
| **Swap them**                             | Puts the **Semi-open** question before the **Suggested answers** one.                                  |
| **Accept "silt" too**                     | Adds the item the passage's list goes on to as an accepted answer. A two-word item adds its last word. |

After a fix, a line at the top of the panel says **Fixed.** with an **Undo**
button. It stays until you change the lesson again. After that, every fix is
still its own entry in **Version history**, where **Undo this change** takes it
back.

If you click a fix for something that has already been fixed (by you a moment
ago, or by someone editing with you), a message says "That's already fixed.
The list is catching up."

Most findings need judgment instead, such as whether to change an answer or
the passage it should be in. Those get **Fix with AI**, which shows you the fix
before making it. See [AI lesson fixes](./ai-lesson-fixes.md).

## Facts

Below the problems and suggestions, the panel has a **Facts** section that
compares the numbers, dates and names in your passages with Wikidata, the
Smithsonian's record of volcanoes and Wikipedia. It only runs when you press
**Check facts**, and nothing it finds is counted in the top bar or the outline.
See [Fact checking](./fact-checking.md).

For how the checks work in the code, see the
[developer notes](../developers/web-app/lesson-checks.md).
