---
title: Image credits
---

# Image credits

A picture in a lesson (an image block, or the picture on a
[VAKT activity](./vakt-activities.md)) has two lines of text under it:

- the **caption**, which the author writes and which says what the picture
  shows, and
- the **credit**, the attribution the picture's licence asks for, such as
  `Image (by Jane Doe, CC BY-SA 4.0) via Wikimedia Commons`.

[Search images](./search-images.md) and the MCP server's `add_image` fill in
the credit and leave the caption empty. A picture uploaded from your own device
starts with no credit, and you can type one in if it needs it.

## Why they're separate

The credit used to be written into the caption. That meant:

- [read aloud](./interactive-mode.md) spoke the licence to the speller in the
  middle of a lesson,
- the picture's alt text was its licence rather than a description,
- [lesson translation](./lesson-translation.md) machine-translated
  photographers' names,
- [lesson summaries](./lesson-summaries.md) had to skip captions altogether,
  and
- an author who rewrote the caption deleted the credit with it.

Now each feature takes only the part it needs:

| Where                   | Caption            | Credit                       |
| ----------------------- | ------------------ | ---------------------------- |
| Lesson page and Preview | Shown, italic      | Shown, in smaller type below |
| Interactive mode        | Shown              | Shown, in smaller type below |
| DOCX and PDF            | Printed, italic    | Printed, small and grey      |
| Alt text                | Used               | Never                        |
| Read aloud              | Read               | Never                        |
| Lesson translation      | Translated         | Never                        |
| Lesson summaries        | Given to the model | Never                        |

## Removing a credit

The credit field is under the caption field in the editor, deliberately
smaller. You can correct it like any field. Emptying it asks first, because
most free images (including everything on Wikimedia Commons that isn't public
domain) may only be used with it. The question waits until you leave the field,
so clearing it to type a correction doesn't set it off. **Keep the credit**
puts it back as it was.

Replacing a picture with a file from your device removes its credit, since it
named whoever took the old picture. Replacing it from a search swaps in the new
picture's credit. Both keep the caption.

## Lessons from before credits had their own field

Older lessons still have the credit at the end of the caption. They aren't
rewritten in storage: that would show up as an edit to every picture in
[version history](/monorepo/version-history), and could race collaborators in a
live session. Instead the split happens when a lesson is read
(`imageCaptionParts` in `packages/core/src/imageCredit.js`).

It only recognises the credit lines this app wrote itself, at the very end of a
caption:

- `Image (by {author}, {licence}) via Wikimedia Commons`, and the older
  `Image by {author} via Wikimedia Commons`
- `Image by {user} from Pixabay` and `Image from Pixabay`

Anything the author wrote in front of it becomes the caption, so
`A red panda resting. Image (by ...) via Wikimedia Commons` reads as that
caption plus that credit. A caption that merely starts with "Image of..." is
left alone.

A block with a `credit` field, even an empty one, is never split again: an
empty credit means someone removed it on purpose. The first time either field
of an older picture is edited, both are written back as separate fields.

## In a Word document

The exporter gives the credit its own paragraph style (`S2C Credit`), next to
the caption's `S2C Caption`, and [DOCX import](./formatting-and-footnotes.md)
reads both back by style. A document exported before credits existed has the
credit inside its caption paragraph, which is then split as above.
