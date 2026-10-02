---
title: Question blocks
---

# Question blocks

Each section can hold **question blocks** alongside text, images, spelling lists
and [VAKT activities](./vakt-activities.md). Pick a type
from the **Add question** menu; every type is colour-coded so it's easy to scan
the lesson at a glance. The types, their shape, and their colours live in one
place, `packages/core/src/questions.js`, so the editor and both exporters stay in sync.

| Type                     | Colour          | What it captures                                                             |
| ------------------------ | --------------- | ---------------------------------------------------------------------------- |
| **Number answer**        | purple          | A single numeric answer, with an optional extendable list of solution steps. |
| **Single answer**        | green           | A list of options with exactly one correct choice.                           |
| **Multiple answers**     | amber           | Several accepted answers; any one of them is right.                          |
| **Suggested answers**    | amber, _italic_ | Several suggested answers. The key is a guide; other answers can be right.   |
| **Paraphrase**           | brown           | Restate the passage in their own words. No stored answer.                    |
| **Open ended**           | pink            | A free written response.                                                     |
| **Would you rather**     | grape           | A "Would you rather… or…?" choice. Opinion only, so no stored answer.        |
| **Background knowledge** | blue            | A prompt plus the prior knowledge a student needs to answer it.              |

**Multiple answers** is amber rather than the burnt orange it used to be: it
would otherwise sit too close to **Paraphrase**'s brown, and in a printed lesson
a question's marking is nearly all it has to go on.

## The two amber types

**Multiple answers** and **Suggested answers** are one family, the _semi-open_
questions, and they share the amber deliberately. What they disagree about is
what the answer list means:

- **Multiple answers**: the list is the **complete accepted set**. In a lesson
  written to the [authoring standard](/mcp-server/tools), it is every item of a
  list the passage states outright, and the prompt quotes that sentence with the
  list blanked out.
- **Suggested answers**: the list is a **suggestion**. The question is bounded
  by the topic ("Give a synonym for GRATITUDE"), and a student who answers
  something else that fits is also right.

Since nothing in a printed lesson names a question's type, two types sharing a
colour would be two types a reader cannot tell apart, so **Suggested answers**
prints in _italic_, in the body and in the footer legend alike. That mark is
load-bearing: it is what tells whoever is marking the lesson that this one
answer key is advisory. It exists because the palette has no spare colour
that reads as orange without colliding with **Paraphrase**'s brown.

The editor doesn't need the italic (every question there carries a type badge),
so the two are told apart by the badge and by the help text under the answer
rows.

## Would you rather

A **Would you rather** question offers the speller a choice between two options
and asks which they would pick: "Would you rather watch an opera or a movie?".
It is opinion, not comprehension, so like **Paraphrase** and **Open ended** it
stores no answer. It prints in grape; if the colour is ever in doubt on paper,
the prompt disambiguates itself, since every question of the type starts
"Would you rather". The footer legend names it **W.Y.R.**, the abbreviation the
lessons this type comes from use.

In the editor each question also shows its position within its section, `Q7`,
next to the type badge. A standard section holds fifteen of them, and the type
badge alone doesn't distinguish one from the next, so the number is what makes a
question findable again after you've scrolled away from it (see
[Navigating large lessons](./navigating-large-lessons.md#question-numbering)).
It's editor-only chrome: nothing is written into the document or the export.

A question prints as its **prompt in the colour of its type, followed by its
answer in black on the same line**: nothing is labelled or bracketed, so the
colour, plus the italic on **Suggested answers**, is what marks the type. The
footer legend on every page names the types the same way (see
[the export pipeline](./export-pipeline.md)); **Would you rather** is the one
type the legend abbreviates, to **W.Y.R.**, so the eight-entry line still fits.
A question with no recorded answer, and the free-response types (**Paraphrase**,
**Open ended** and **Would you rather**), print as the prompt alone.

Number-answer questions can also hold a list of **steps**, the worked-out
stages of solving the problem. Use **Add step** in the editor to grow the
list, and remove any row you don't need; the list starts empty since steps
are optional. Steps print as an indented numbered list under the question, and
round-trip through both JSON and DOCX import.
