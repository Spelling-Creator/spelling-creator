---
title: Formatting, footnotes & sources
---

# Formatting, footnotes & sources

Text blocks in a lesson can have a little formatting and footnotes, and a
footnote can cite one of the lesson's sources. You list each source once, in
the lesson's **Sources** card, and footnotes anywhere in the text can point to
it. Footnotes are numbered in reading order through the whole lesson, and the
lesson ends with a **Notes** list and a **Sources** list.

## What you can do

| Available                                         | Not available                                   |
| ------------------------------------------------- | ----------------------------------------------- |
| Bold, italic, underline                           | Headings, lists, links, code, line breaks       |
| Footnotes that cite a source, with a page         | Pictures or other media inside a text block     |
| Footnotes with a note of your own                 | Footnotes in question, picture or VAKT blocks   |
| A footnote that does both (a citation and a note) | Formatting in any block other than a text block |
| How words are read aloud, and pauses              | Read-aloud fixes outside a text block           |
| Formulas, in AsciiMath or LaTeX                   | Formulas in questions or answers                |

The set is small on purpose. A lesson is read aloud to a speller and printed
for whoever is running it, ALL CAPS already marks the spelling words, and
sections already give a lesson its structure. Italics are there for things like
book titles and scientific names, and footnotes for sources.

## Formatting text

Each text block has a small toolbar with **Bold**, **Italic**, **Underline**,
**Footnote**, **Read aloud** and **Formula**. Select some words and press a
button to format them.

## Adding a footnote

1. Put the cursor where the footnote should go, or select the words it's
   about. The footnote goes after them.
2. Press **Footnote**.
3. Under **Source**, pick one of the lesson's sources, or **No source, just a
   note**. If the source isn't in the list yet, choose **Add a new source** to
   add it from here.
4. Optionally fill in **Page or section** (such as "p. 12") and a **Note**.
5. Press **Add footnote**.

Footnotes show in the text as small numbers. Click one to open it again, where
you can change it and press **Save**, or press **Remove footnote**.

## Fixing how words are read aloud

Lessons are read aloud in [interactive mode](./interactive-mode.md), and the
voice sometimes gets a name, a place or an abbreviation wrong. The **Read
aloud** button on the toolbar fixes that without changing what the lesson
shows or prints.

Select the words, press **Read aloud**, and choose how to read them:

- **Pronounce** gives the pronunciation in the International Phonetic Alphabet
  (IPA), the alphabet dictionaries use for sounds, such as `freɪˈnɛl` for
  "Fresnel". You can paste it straight from a dictionary, slashes and all.
- **Say instead** gives other words to say, such as "World Wide Fund for
  Nature" for "WWF".
- **Spell out** reads the words one letter at a time: R, E, E, F.

Press **Save**. Words with a fix get a dotted underline in the editor, and
holding the pointer over them shows what they're read as. To change or remove
one, put the cursor in it and press **Read aloud** again.

To add a pause, put the cursor where it goes, press **Read aloud**, and choose
**Short** (about as long as a comma) or **Long** under **Add a pause**. A pause
shows in the editor as a small "pause" label and is silent and invisible
everywhere else. Click it to make it longer or shorter, or to remove it.
Punctuation already makes natural pauses, so most passages need none.

Which voice is reading matters for one of these. The natural voice follows all
of them. The browser's own voice says the words you gave instead and spells
words out, but it can't follow an IPA pronunciation, so it reads those words as
written.

## Formulas

A math or science passage can carry a typeset formula: a fraction, a power, a
root, an equation. Put the cursor where it goes (or select the words it
follows), press **Formula**, and write it in one of two notations:

- **AsciiMath** is close to how you would type math in a message, and quick
  to learn: `2 xx 8 = 16` for times, `48 -: 6 = 8` for divided by, `3/4` for a
  fraction, `10^6` for a power, `sqrt(81) = 9` for a square root, `x <= 3`
  for at most. See [asciimath.org](https://asciimath.org/) for the rest.
- **LaTeX** is what mathematicians and most math tools use: `2 \times 8`,
  `48 \div 6`, `\frac{3}{4}`, `10^6`, `\sqrt{81}`, `x \leq 3`. Write it without
  the dollar signs.

The formula shows below the box as you type it. Choose **In the sentence** or
**On its own line**, and press **Add formula**. Click a formula in the text to
change or remove it.

Formulas are read aloud automatically ("60 over 5 equals 12", "x squared").
If that reading is right but awkward to hear, fill in **Read aloud as** with
the words to say instead.

Two things to know:

- A formula is for math, not for a number in prose. "360 steps" and "$2.50"
  are plain text.
- The speller spells the answer, so a question's answer is plain text too
  (`360`, `3/4`), never a formula.

## The Sources card

The lesson's sources are listed in the **Sources** card at the end of the
editor, after the last section, which is also where they print. Press **Add
source** to add one. Each source has a **Title**, **Author**, **Publisher or
website**, **Year** and **Link**. They're all optional, but a source needs at
least a title, an author or a link to be printed. Links have to start with
`http://`, `https://` or `mailto:`, or they won't be shown.

The card says how often each source is cited ("Cited once", "Cited 3 times",
or "Not cited in the text"). Removing a source that's cited asks first, then
takes its citations out of the text: a footnote that only cited that source is
removed, and one that also had a note keeps the note.

## Where it shows up

- **On the lesson page and in Preview**, formatting shows as written. Each
  footnote number links down to the Notes list, and each note links back up to
  where it's used. The Sources list comes after the notes. Formulas are typeset
  on the page.
- **In Word and PDF**, formatting is kept, and footnotes become real Word
  footnotes at the foot of each page. In the PDF they're gathered into a Notes
  list above the Sources list instead. A formula becomes a Word equation you
  can edit in Word, and a picture in the PDF. See
  [Exporting & printing](./exporting.md).
- **Importing a Word document** this app exported brings back the formatting,
  the footnotes (with their sources and pages) and the Sources list. Footnotes
  from other Word documents come back as notes. Read-aloud fixes and pauses
  aren't part of a Word document, so they don't come back, and neither do
  formulas.
- **Lesson files (JSON and OSLF)** keep everything, read-aloud fixes, pauses and
  formulas included.
- **Interactive mode** shows the formatting and the formulas but not the
  footnote numbers, since that screen is what the speller reads. Reading aloud
  reads the words, with their read-aloud fixes and pauses, and says each
  formula.
- **Everywhere else** (the lesson page, Preview, Word and PDF), read-aloud fixes
  and pauses don't show: the words appear as you wrote them.
- **Translation** translates a paragraph's words; a formula in a translated
  paragraph shows as it was typed, not typeset. See
  [Translation](./translation.md).
- **Translation** translates each paragraph's words and the footnote notes. A
  translated paragraph loses its formatting, and its footnote numbers move to
  the end of the paragraph. Sources aren't translated, since titles, authors and
  publishers are names. See [Translation](./translation.md).

If two people edit the same text block at exactly the same moment during
[live collaboration](./live-collaboration.md), the later change wins. Editing
different blocks, or different sources, is no problem.

For how this works, see the [developer notes](../developers/web-app/formatting-and-footnotes.md).
