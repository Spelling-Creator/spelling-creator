---
title: Import from text
---

# Import from text

**Import from text** turns a lesson that only exists as a document into a
lesson in the editor. You can paste text from anywhere, or pick a `.txt`, `.md`
or Word (`.docx`) file that wasn't made by this app. The result always opens as
a new lesson of its own, so the lesson you were working on is left alone (see
[Lessons on this device](./local-lessons.md)).

You'll find it in the editor's **Menu** (the button in the editor's top bar),
in the **Lesson actions** menu on a phone, and on the screen of an empty
lesson, next to the other two imports.

## See it in action

<DemoVideo name="editor-import-from-text" title="Importing a lesson from text">
A lesson typed out in plain text, pasted into Import from text from an empty
lesson. The dialog lists the two sections it found with their paragraphs,
spelling words and questions, and the import opens as a new lesson with its
question types worked out, then in Preview.
</DemoVideo>

## Which import to use

| Import                   | Use it for                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Import JSON**          | A lesson file saved with **Export JSON**. Nothing is lost.                                                                                                                                             |
| **Import Word document** | A Word file exported from this app. The question types come back, but the whole lesson arrives as one section unless the document uses Heading 2 for section names. Files from elsewhere may not work. |
| **Import from text**     | Everything else: a lesson typed by hand, pasted from an email or a web page, or a Word file written somewhere else.                                                                                    |

## Using it

1. Choose **Import from text**. Paste the lesson into the **Lesson text** box,
   or press **Choose file** to read a file into it.
2. As the text changes, the dialog shows what it found: the title, how many
   sections, and for each section how many paragraphs, spelling words and
   questions it holds, and how many of the questions have an answer. If it
   can't find a lesson yet, it says what the text needs.
3. Press **Import as a new lesson**. The lesson opens in the editor with a
   reminder to check the question types and answers, since they were worked out
   from the wording. The [lesson checks](./lesson-checks.md) then work on it
   like any other lesson.

## How to lay out the text

The import reads a document the way a person would. Each section needs its
passage first, then its questions, one per line, with any answer after the
question.

- **The title** is the first line, unless that line is already part of the
  passage.
- **A passage** is one or more ordinary paragraphs. Each becomes its own text
  block.
- **Spelling words** go on a line starting with a label such as "Spell:" or
  "Spelling words:", separated by commas or spaces.
- **Questions** go one per line, numbered, bulleted, starting with "Q:" or
  plain. The answer can follow in any of the usual ways: in brackets as
  "(Answer: ...)" or "[...]", on the next line as "A: ...", after a colon, or as
  a word in CAPITALS at the end. A question that ends with its question mark has
  no answer. Several answers are separated by commas or semicolons, but a
  number written with a comma, like "3,000", stays one answer.
- **Working out** for a number question can follow it as numbered lines or a
  "Working out:" line.
- **A VAKT line** becomes a [VAKT activity](./vakt-activities.md).
- **A short heading** just before a passage names the section. A new section
  starts wherever a passage comes after questions or a spelling line.
- Anything after the last section, such as a list of sources, is left out.

Short lines inside a section that the import couldn't make sense of (a
question with no question mark or number, say) are kept in their section
rather than thrown away.

The **question type** is worked out, since plain text doesn't say what it is.
"Would you rather" makes a Would you rather question, "in your own words" makes
a Paraphrase question, no answer makes a Tight open or a Broad open (by how the
question is worded), several answers make
Multiple answers (or Suggested answers when one of them isn't in the passage),
a number makes a Number answer question, and a single answer is a Single answer
question when it appears in the passage and Background knowledge when it
doesn't. This is the part most worth checking after an import (see
[Question blocks](./question-blocks.md)).

Tested on recent lessons from the hub laid out seven different ways, it found
every passage, spelling word and question, nearly every answer, and picked the
same question type as the lesson's author about nine times in ten.

## When the text is hard to read

Some documents only look like a lesson to a person: questions with no question
marks or numbers, answers tacked straight onto the question, or a numbered list
run together on one line. When some sections look like that, the dialog says
how many and offers **Read with the on-device model**.

The model runs in your browser and the text never leaves your device. The first
time, it downloads about 640 MB, which is kept so it only downloads once (you
can remove it from Settings, under **Downloaded AI models**). Only the sections
the import couldn't read are given to the model; the rest stay as they were.
While it works, the dialog shows which section it's reading, and **Stop** ends
it. If the model can't read a section, that section is offered again.

The button only appears on computers whose browser and graphics hardware can
run the model, and not on a metered (pay-per-use) connection. Documents the
import reads cleanly never need it.

For how this works, see the [developer notes](../developers/web-app/document-import.md).
