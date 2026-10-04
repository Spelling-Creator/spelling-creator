---
title: Formatting, footnotes & sources
---

# Formatting, footnotes & sources

Lesson text blocks can carry a little formatting, footnotes, and citations of
the lesson's sources. A source is written once, in the lesson's Sources list,
and a footnote anywhere in the text can cite it. Every footnote is numbered in
reading order across the whole lesson, and the lesson closes with a Notes list
and a Sources list.

## What an author can do

| Available                                       | Not available                                   |
| ----------------------------------------------- | ----------------------------------------------- |
| Bold, italic, underline                         | Headings, lists, links, code, line breaks       |
| Footnotes that cite a source, with a page       | Images or other media inside a text block       |
| Footnotes with a free-text note                 | Footnotes inside question, image or VAKT blocks |
| A footnote that does both (a citation and note) | Formatting in any block other than a text block |

The set is small on purpose. A lesson is read aloud to a speller and printed for
whoever is running it, ALL CAPS already marks the vocabulary, and sections
already give a lesson its structure. Italics earn their place for titles of
books and scientific names, and footnotes for sources.

In the editor, each text block has a small toolbar: bold, italic, underline, and
**Footnote**. The footnote button opens a form that inserts a footnote after the
cursor (or after the selected words). It can cite one of the lesson's sources,
with an optional page or section, carry a note, or both. A source that isn't in
the list yet can be added from the same form. Clicking a footnote marker in the
text opens the form again to edit or remove it.

The lesson's sources are edited in the **Sources** card at the end of the
editor, after the last section, which is where they print. Each source has a
title, author, publisher or website, year and link, all optional, though a source
needs a title, an author or a link to be printed. The card says how often each
source is cited. Removing a source that is cited asks first, and then takes its
citations out of the text: a footnote that only cited it goes, and one that also
had a note keeps the note.

## How it is stored

| File                                                   | Role                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| `@spelling-creator/core/lessonText`                    | Text block content: the schema, plain text, runs, footnotes. |
| `@spelling-creator/core/sources`                       | The source list and how a source is printed.                 |
| `apps/web/src/components/editor/LessonTextInput.jsx`   | The tiptap editor for a text block.                          |
| `apps/web/src/components/editor/LessonTextToolbar.jsx` | Its toolbar and the footnote form.                           |
| `apps/web/src/components/editor/SourcesPanel.jsx`      | The Sources card.                                            |
| `apps/web/src/lib/footnoteExtension.js`                | The tiptap footnote node.                                    |
| `apps/web/src/components/TextRuns.jsx`                 | Draws runs and citations as React elements.                  |

A text block holds its words in one of two shapes:

- **`text`**, a plain string with one paragraph per line. Every block written
  before formatting existed looks like this, and so does any block nobody has
  formatted.
- **`content`**, a tiptap (ProseMirror) JSON document, once a block carries any
  formatting or footnotes.

When `content` is present it wins. Writers that replace a block whole (the
importers, the MCP server) store the smaller shape (`withTextBlockContent`), so
an unformatted block they write stays a plain string. The editor, once it has
touched a block, always stores `content` (`withTextBlockDocument`), formatted or
not. That is for live collaboration: the collaboration document merges a block
key by key, so if one person's edit wrote `content` while another's wrote
`text`, both keys would survive and `content` would quietly hide the second
edit. Two people editing a block in the editor always write the same key.
Nothing reads either field directly:
`textBlockPlain`, `textBlockLines`, `textBlockParagraphs` and
`textBlockFootnotes` treat the two shapes as one, and paragraphs map one to one
onto the old lines, so anything that was keyed by line index keeps its keys.

```json
{
  "id": "b1",
  "type": "text",
  "content": {
    "type": "doc",
    "content": [
      {
        "type": "paragraph",
        "content": [
          { "type": "text", "text": "Known to scientists as " },
          {
            "type": "text",
            "text": "Felis lybica",
            "marks": [{ "type": "italic" }]
          },
          { "type": "text", "text": "." },
          {
            "type": "footnote",
            "attrs": { "sourceId": "smith2020", "locator": "p. 12", "note": "" }
          }
        ]
      }
    ]
  }
}
```

The sources live on the lesson itself, as `doc.sources`:

```json
[
  {
    "id": "smith2020",
    "title": "Cats of Egypt",
    "author": "Jane Smith",
    "publisher": "Penguin",
    "year": "2020",
    "url": "https://example.com"
  }
]
```

### Why JSON and not HTML

Comments and bios are stored as sanitised HTML (see [Rich text](./rich-text.md)),
but lesson text is not, for two reasons. A footnote has to carry data (which
source, which page, what note), and the comment policy strips every attribute
but a checked `href`. And lesson content is rendered by walking the JSON into
React elements and docx runs, so there is never any markup to inject.
`normalizeTextContent` is the boundary instead: anything that arrives from
outside the editor (an imported file, the MCP server, a document written by an
older client) is reduced to paragraphs, three marks and the footnote node, and
the renderers only ever draw what survives it. It also stores marks in a fixed
order and merges neighbouring runs, so the same formatting always hashes to the
same git blob.

A source's link is only ever made into a link after `isSafeLink` accepts it
(http, https or mailto), the same rule VAKT links follow.

## Numbering

A footnote's number is its position in reading order across the whole lesson,
the way Word numbers footnotes, so the page, the printout and the editor agree.
`footnoteStarts(doc)` gives each text block the count of footnotes before it.
The lesson page adds a footnote's own index to that. The editor doesn't compute
numbers at all: each block's editor starts a CSS counter at its block's count
(`counter-reset: lesson-footnote N`) and every marker increments it, so the
numbers update the moment a footnote is added anywhere, with nothing walking the
document on each keystroke.

## Where it shows up

- **Lesson page and preview.** Formatting renders as written. Each footnote is
  a superscript number linking down to the Notes list, and each note links back
  up. The Sources list follows the notes.
- **Word and PDF export.** Formatting becomes Word run formatting, and footnotes
  become real Word footnotes at the foot of each page. The Sources list closes
  the document under a "Sources" line, written with its own paragraph styles so
  the PDF can style it and the importer can recognise it. The PDF goes through
  mammoth, which turns the footnotes into a list at the end; `layoutNotes` in
  `pdfExport.js` moves that list above the Sources list and heads it "Notes".
- **Word import.** Bold, italics and underlining come back. Word footnotes and
  endnotes come back as footnotes. A Sources list this app exported is read back
  into the lesson's sources. Inside each footnote the exporter gives the locator
  and the note their own character styles, which Word ignores, so a citation
  comes back exactly, with its page and its note. Reading them off the text
  wouldn't work: a locator usually has a full stop in it ("p. 12"). A footnote
  without those styles (from an older export, or from anywhere else) becomes a
  citation only when it is exactly the citation, or the citation followed by a
  note; anything else is kept as a note. Image captions get a paragraph style
  too, so a text paragraph that happens to start in italics isn't taken for the
  caption of the picture above it.
- **JSON import and export.** Lossless. Citations of a source the file doesn't
  list are dropped on import (keeping any note), since they would print as
  "Source no longer listed". A footnote citing a source that is in the list but
  not filled in yet names it "Untitled source".
- **Interactive mode.** Formatting shows, footnote markers don't. That screen is
  what the speller reads, and a number with nowhere to lead is clutter there. The
  read-aloud voice reads the plain words.
- **Translation.** Each paragraph's plain words translate as one segment, so a
  translated paragraph loses its formatting and keeps its footnote markers at
  its end. Footnote notes translate. Citations and the Sources list don't: an
  author, a title and a publisher are names. See
  [Lesson translation](./lesson-translation.md).
- **Summaries, search, spelling words and AI helpers** read the plain words.

## Collaboration, history and merging

A text block's content is still one value in the live-collaboration document,
so two people typing in the same block at the same moment is last write wins,
as it was for the plain string. Different blocks merge cleanly. The sources are
a keyed list, so two people editing different sources merge too. The text
editor commits about 200ms after a pause, and holds off a change from elsewhere
while you're in that block, the same way the plain fields do. Leaving a block
only writes it back if you changed it: otherwise it catches up with whatever
arrived while you were there, so clicking in and out never writes a stale copy
over a collaborator's edit. (The plain fields, `useLiveField`, behave the same
way.)

In [version history](/monorepo/version-history), the sources are stored in
`lesson.json` next to the title, and show up as their own operations ("add
source", "edit source"). When merging, a text block's words are treated as one
field whichever shape they're in. So one side formatting a word while the other
fixes a typo is a conflict the user sees, rather than two edits to different
fields that merge "cleanly" and hide the typo fix. Sources merge without asking:
a source either side added or edited comes through, and where both changed the
same field of the same source, yours stands.

## The MCP server

Assistants write text blocks as a small markup and are told to leave text plain
unless a convention needs formatting. Heavy formatting is rejected on save. See
[Lesson validation](/mcp-server/lesson-validation) and [Tools](/mcp-server/tools).
