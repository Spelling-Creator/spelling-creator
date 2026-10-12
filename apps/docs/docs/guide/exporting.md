---
title: Exporting & printing
---

# Exporting & printing

When a lesson is ready, you can download it as a Word document, download a PDF
to print, or save it to Google Docs. In the editor these are all in the
**Export** menu at the top (on a phone, in the **Lesson actions** menu). A
lesson needs at least one section before it can be exported.

| Menu item               | What you get                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| **Export DOCX**         | A Word document, downloaded to your device.                                                    |
| **Export JSON**         | A lesson file you can open again later with **Import JSON**, with nothing lost.                |
| **Print PDF**           | A PDF, downloaded to your device, laid out the same as the Word document. Open it to print it. |
| **Save to Google Docs** | The lesson as an editable Google Doc in your Google Drive.                                     |

A published lesson's page on the hub has **Print PDF** and **Download Word**
buttons too, so anyone reading it can print it.

To check how a lesson looks before exporting, press **Preview** in the editor.
It shows the lesson exactly as a reader sees it on screen, in the app's light
or dark theme. The printed version has the same layout, plus the title block,
page numbers and footer described below.

## What a printed lesson looks like

The Word document and the PDF are laid out as a finished lesson, not as an
outline of the editor:

- **A title block** on the first page: the title, then "By" and the author,
  then the lesson's age range and the month it was released, when it has them.
  From the editor, the author is your display name if you're signed in; a
  lesson that hasn't been published has no release date yet.
- **No section headings.** Section names help you organize the lesson in the
  editor; the printed lesson runs straight through from one block to the next.
  A **Heading** block you add inside a section does print, in bold, where you
  put it.
- **Questions marked by a tag and a color**: a short tag for the type (K, PK,
  M, SO, P, O or WYR), then the question in its type's color, with its answer
  in black on the same line. The tag is there for anyone who doesn't have the
  color: a gray photocopy, a printer low on ink, or a reader who can't tell the
  colors apart. **Suggested answers** is also in italic, to tell it apart from
  **Multiple answers**, which shares its color and its tag (see
  [Question blocks](./question-blocks.md)).
- **Spelling words on one line**, after "Spell:".
- **VAKT activities** in red, after "VAKT:" (see
  [VAKT activities](./vakt-activities.md)).
- **Pictures** at the size and alignment you chose, with the caption in italic
  and the credit in small gray type (see [Pictures](./images.md)).
- **Footnotes** at the foot of each page in Word. In the PDF they're gathered
  into a **Notes** list near the end. The lesson's **Sources** come last (see
  [Formatting, footnotes & sources](./formatting-and-footnotes.md)).
- **A footer on every page**: a copyright line with the author's name, above a
  legend naming each question type the lesson uses in its own color. Types the
  lesson doesn't ask are left out, so a lesson without **Would you rather**
  questions has no W.Y.R. entry. The legend shortens **Would you rather** to
  **W.Y.R.** so a lesson that uses every type still fits on one line. VAKT
  activities aren't in the legend, since they aren't questions.
- **A page number** in the top right corner.

## Opening an exported lesson again

- **Import JSON** brings back a lesson file exactly, with every section. The
  one thing a lesson file leaves out on purpose is the list of people you trust
  to merge changes into the lesson, since that's a list of email addresses and
  lesson files get passed around.
- **Import Word document** brings back a Word file this app exported, including
  each question's type, formatting, footnotes, sources and picture credits.
  Because the printed lesson has no section headings, the whole lesson comes
  back as one section. Use JSON when you want an exact copy.
- A Word file or text written somewhere else goes through
  [Import from text](./import-from-text.md).

Every import opens as a new lesson, so the one you're working on is left alone.

## Save to Google Docs

**Save to Google Docs** puts the lesson in your Google Drive as a Google Doc
you can edit and share there.

1. Choose **Save to Google Docs** from the **Export** menu.
2. The first time, Google asks you to sign in and allow Spelling Creator to
   save files to your Drive.
3. When it's done, a message says "Saved to Google Drive as a Google Doc." with
   an **Open** link to the new document.

You don't need a Spelling Creator account for this, only a Google account. The
app can only see and change the files it creates itself; it can't see anything
else in your Drive. The Google Doc is converted from the same Word document as
**Export DOCX**.

If **Save to Google Docs** isn't in the menu, the copy of Spelling Creator
you're using hasn't been set up for it.

## Working offline

Export DOCX, Export JSON and Print PDF all work without a connection once the
app has loaded (see [Install & offline use](./install-and-offline.md)). Save to
Google Docs needs a connection.

For how this works, see the [developer notes](../developers/web-app/export-pipeline.md).
