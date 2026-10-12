---
title: Question blocks
---

# Question blocks

Each section can hold **question blocks** alongside text, pictures, spelling
lists and [VAKT activities](./vakt-activities.md). Pick a type from the **Add
question** menu in a section's toolbar. Each type has its own color, so you can
scan a lesson and see its questions at a glance.

## The types are defaults, not rules

The types take their names and meanings from the
[Open Spelling Lesson Format](https://github.com/playforge-coding/open-spelling-lesson-format)
(OSLF), an open vocabulary for Spelling lessons that isn't tied to any one
method and that anyone can comment on. The format has eight question types;
the app's two amber types are its one semi-open type with either a complete
answer key or a suggested one, and the **Open ended** type is the app's own,
left over from before tight and broad opens were separate. The colors are the
app's defaults.
Spelling practices differ, and plenty of practitioners ask questions their own
way, so use the types as they suit you. The editor doesn't require a set
number of each or any particular order. The [lesson checks](./lesson-checks.md)
do follow the app's lesson standard (for example, they expect a **Single
answer** question's answer to appear word for word in the passage), so expect
them to flag lessons that use the types differently.

| Type                     | Tag | Color           | What it's for                                                                                            |
| ------------------------ | --- | --------------- | -------------------------------------------------------------------------------------------------------- |
| **Number answer**        | M   | purple          | The answer is a number. You can add the steps to work it out.                                            |
| **Single answer**        | K   | green           | One typed answer, usually a word from the passage.                                                       |
| **Multiple answers**     | SO  | amber           | Several accepted answers; any one of them is right.                                                      |
| **Suggested answers**    | SO  | amber, _italic_ | A few answers that would count. They're a guide, and other answers can be right.                         |
| **Paraphrase**           | P   | brown           | Restate the passage in their own words. No stored answer.                                                |
| **Tight open**           | TO  | pink            | A quick one word answer from the speller's own world. No answer key, though you can list a few examples. |
| **Broad open**           | BO  | pink            | Their own reasoning, opinion or imagination, often in a sentence. No stored answer.                      |
| **Would you rather**     | WYR | grape           | A "Would you rather... or...?" choice. Opinion only, so no stored answer.                                |
| **Background knowledge** | PK  | blue            | A question that needs knowledge from outside the passage, with its answer.                               |

The tags are the [Open Spelling Lesson Format](https://github.com/playforge-coding/open-spelling-lesson-format)'s
defaults: K for a known answer, PK for prior knowledge, M for math, SO for
semi-open, TO for a tight open, BO for a broad open, P for paraphrase, WYR for
would you rather.

## Tight and broad opens

Both are open questions with no single right answer, and both print in pink.
What separates them is how much they ask of the speller:

- A **Tight open** names an everyday category and wants one word, fast:
  "Name something that gives off light", "Name a color of a crayon". The answer
  comes from the speller's own life, not from the passage. You can add a few
  **examples** of what would count; they print after "e.g." and are not an
  answer key.
- A **Broad open** asks what the speller thinks: "Why do you think people
  built lighthouses?", "If you designed one, what would you paint on it?". It
  usually takes a sentence or more.

"In your own words, explain..." is neither. It asks the speller to retell the
passage, which is a **Paraphrase** question.

Lessons saved before the two were separate have an **Open ended** question
type (tag O) instead. Those questions still work everywhere; the editor just
no longer offers the type for new questions. To sort an old one, change its
type to Tight open or Broad open. The lesson checks read an old open question
as whichever kind its wording suggests.

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

## Three-board questions

A **Multiple answers** question has two extras, both off unless you turn them
on:

- **Three-board (3B)** marks the question for the three boards. It prints
  "(3B)" after the tag, in front of the question, and changes nothing else.
- A **Besides line** is a follow-up printed under the question. Pick one of
  the question's own answers and the line reads 'Besides "rocks"' followed by
  the other accepted answers, asking the speller for one of those. If you
  later change or remove the answer you picked, the picker goes back to
  **None** and no line prints.

Both are the [Open Spelling Lesson Format](https://github.com/playforge-coding/open-spelling-lesson-format)'s
`threeBoard` and `besides`. What the three-board mark asks of the speller is
one of the format's open questions, so the app records and prints it without
defining it further.

## Would you rather

A **Would you rather** question offers the speller a choice between two
options: "Would you rather watch an opera or a movie?". It's about opinion,
not understanding the passage, so like **Paraphrase** and **Broad open** it has
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

A question prints as **a short tag, then the question in its type's color,
followed by its answer in black on the same line**. The tag is one to three
letters in small gray type: K, PK, M, SO, TO, BO, P or WYR (see the table
above), or O on an **Open ended** question from before tight and broad opens
were separate.
It's there so the type can still be told on a gray photocopy or by a reader
who can't tell the colors apart; the color (and the italic on **Suggested
answers**) does the same job for everyone else. The legend at the foot of
every page lists each tag with its type's name, in that type's color (see
[Exporting & printing](./exporting.md)). The lesson page shows the same tags
on screen, with the same legend under the lesson, and hovering a tag names
its type.

A question without an answer, and the types with no stored answer
(**Paraphrase**, **Broad open** and **Would you rather**), print as the question
alone. A **Tight open** prints alone too unless you gave it examples, which
follow "e.g.".

## Steps for number questions

A **Number answer** question can also have a list of **steps**, the stages of
working out the answer. Use **Add step** to add one and the remove button
beside a step to take it away. Steps are optional, so the list starts empty.
They print as an indented numbered list under the question, and they're kept
when you export and re-import the lesson as a Word document or a lesson file.

For how question types are stored and exported, see the
[export pipeline](../developers/web-app/export-pipeline.md) developer notes.
