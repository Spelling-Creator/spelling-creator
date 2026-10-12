---
title: Question blocks
---

# Question blocks

Each section can hold **question blocks** alongside text, pictures, spelling
lists and [VAKT activities](./vakt-activities.md). Pick a type from the **Add
question** menu in a section's toolbar. Each type has its own color, so you can
scan a lesson and see its questions at a glance.

## The types are defaults, not rules

The eight types follow the
[Open Spelling Lesson Format](https://github.com/playforge-coding/open-spelling-lesson-format)
(OSLF), an open vocabulary for Spelling lessons that isn't tied to any one
method and that anyone can comment on. The colors are the app's defaults.
Spelling practices differ, and plenty of practitioners ask questions their own
way, so use the types as they suit you. The editor doesn't require a set
number of each or any particular order. The [lesson checks](./lesson-checks.md)
do follow the app's lesson standard (for example, they expect a **Single
answer** question's answer to appear word for word in the passage), so expect
them to flag lessons that use the types differently.

| Type                     | Color           | What it's for                                                                    |
| ------------------------ | --------------- | -------------------------------------------------------------------------------- |
| **Number answer**        | purple          | The answer is a number. You can add the steps to work it out.                    |
| **Single answer**        | green           | One typed answer, usually a word from the passage.                               |
| **Multiple answers**     | amber           | Several accepted answers; any one of them is right.                              |
| **Suggested answers**    | amber, _italic_ | A few answers that would count. They're a guide, and other answers can be right. |
| **Paraphrase**           | brown           | Restate the passage in their own words. No stored answer.                        |
| **Open ended**           | pink            | A free written response. No stored answer.                                       |
| **Would you rather**     | grape           | A "Would you rather... or...?" choice. Opinion only, so no stored answer.        |
| **Background knowledge** | blue            | A question that needs knowledge from outside the passage, with its answer.       |

**Multiple answers** used to be a burnt orange. It's amber now because the
orange sat too close to **Paraphrase**'s brown, and on paper the color is
nearly all there is to tell a question's type by.

## The two amber types

**Multiple answers** and **Suggested answers** are one family, the
_semi-open_ questions, which is why they share a color. The difference is what
the list of answers means:

- **Multiple answers**: the list is the **complete set** of accepted answers,
  usually a list the passage states outright. The speller only needs to give
  one of them.
- **Suggested answers**: the list is a **suggestion**. The question is bounded
  by the topic ("Give a synonym for GRATITUDE"), and anything else that fits
  is also right.

A printed lesson doesn't name a question's type, so two types with the same
color would look identical on paper. That's why **Suggested answers** prints in
_italic_, both in the lesson and in the legend at the foot of each page. The
italic tells whoever is going over the answers that this answer key is only a
guide.

In the editor every question has a label naming its type, so there's no italic
there. The help text under the answer rows also says which kind it is.

## Would you rather

A **Would you rather** question offers the speller a choice between two
options: "Would you rather watch an opera or a movie?". It's about opinion,
not understanding the passage, so like **Paraphrase** and **Open ended** it has
no stored answer. It prints in grape, and the wording itself ("Would you
rather...") makes the type clear even if the color is hard to tell on paper.
The legend at the foot of each page shortens it to **W.Y.R.** so a lesson that
uses all eight types still fits on one line. The legend only lists the types a
lesson uses, so it only appears there when the lesson has one.

## Question numbers

In the editor, each question shows its place in its section, such as `Q7`,
next to its type. A section can have a lot of questions, so the number is what
makes one easy to find again after scrolling away (see
[Navigating large lessons](./navigating-large-lessons.md)). The numbers only
appear in the editor; they aren't added to the lesson or printed.

## How questions print

A question prints as its **question in its type's color, followed by its answer
in black on the same line**. There are no labels or brackets: the color (and
the italic on **Suggested answers**) is what shows the type. The legend at the
foot of every page names each type in its color (see
[Exporting & printing](./exporting.md)).

A question without an answer, and the types with no stored answer
(**Paraphrase**, **Open ended** and **Would you rather**), print as the question
alone.

## Steps for number questions

A **Number answer** question can also have a list of **steps**, the stages of
working out the answer. Use **Add step** to add one and the remove button
beside a step to take it away. Steps are optional, so the list starts empty.
They print as an indented numbered list under the question, and they're kept
when you export and re-import the lesson as a Word document or a lesson file.

For how question types are stored and exported, see the
[export pipeline](../developers/web-app/export-pipeline.md) developer notes.
