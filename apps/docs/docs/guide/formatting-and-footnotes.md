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

The set is small on purpose. A lesson is read aloud to a speller and printed
for whoever is running it, ALL CAPS already marks the spelling words, and
sections already give a lesson its structure. Italics are there for things like
book titles and scientific names, and footnotes for sources.

## Formatting text

Each text block has a small toolbar with **Bold**, **Italic**, **Underline**
and **Footnote**. Select some words and press a button to format them.

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
  where it's used. The Sources list comes after the notes.
- **In Word and PDF**, formatting is kept, and footnotes become real Word
  footnotes at the foot of each page. In the PDF they're gathered into a Notes
  list above the Sources list instead. See [Exporting & printing](./exporting.md).
- **Importing a Word document** this app exported brings back the formatting,
  the footnotes (with their sources and pages) and the Sources list. Footnotes
  from other Word documents come back as notes.
- **Lesson files (JSON)** keep everything.
- **Interactive mode** shows the formatting but not the footnote numbers, since
  that screen is what the speller reads. Reading aloud reads just the words.
- **Translation** translates each paragraph's words and the footnote notes. A
  translated paragraph loses its formatting, and its footnote numbers move to
  the end of the paragraph. Sources aren't translated, since titles, authors and
  publishers are names. See [Translation](./translation.md).

If two people edit the same text block at exactly the same moment during
[live collaboration](./live-collaboration.md), the later change wins. Editing
different blocks, or different sources, is no problem.

For how this works, see the [developer notes](../developers/web-app/formatting-and-footnotes.md).
