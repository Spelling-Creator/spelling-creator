---
title: VAKT activities
---

# VAKT activities

For how to use this, see [VAKT activities](../../guide/vakt-activities.md).

A **VAKT activity** is a regulation break: a movement or sensory activity a
speller does partway through a lesson. VAKT stands for **v**isual, **a**uditory,
**k**inesthetic, **t**actile. Everything about the block (its color, its label,
and its shape) lives in one place, `packages/core/src/vakt.ts`, so the editor,
the viewer, both exporters and both importers stay in sync.

## Not a question

A VAKT activity is **its own block type** (`type: "vakt"`), not a question
type. The distinction is load-bearing:

- it is addressed to whoever is running the lesson, not to the speller;
- it is never answered and never scored;
- it isn't counted by [interactive mode](./interactive-mode.md)'s progress bar,
  and it appears with a section's material rather than as a step of its own;
- it doesn't appear in the printed footer legend, which names question types.

Question blocks carry answers and print in the legend. Making VAKT a question
type would have given it all of that and then required exceptions for each one.
(A comment in `vakt.ts` still calls the alternative "a seventh question type";
there are eight question types now.)

## The color and the label

VAKT activities print in a **bright red** (`VAKT_COLOR`, `#ee1111`), the one
color the eight [question types](../../guide/question-blocks.md) and the teal
spelling block deliberately leave free. The red is hue-0 rather than anything
warmer on purpose: an orange or an amber would collide with the **Multiple
answers** question type, which is what pushed that type off burnt orange in the
first place.

Every activity is prefixed **`VAKT:`** (`VAKT_LABEL`). That prefix is **not
part of the activity**: whatever renders the block adds the label, exactly the
way the spelling block's `Spell:` works, so the label can be translated on
screen while the export keeps its canonical form. The editor stores the text as
typed; `vaktText` strips a leading `VAKT:` when the block is rendered, so an
author who types the label in never sees it printed twice.

Unlike a question, where only the _prompt_ is colored and the answer follows in
black, the whole VAKT line is red. It's an instruction to the person running the
lesson, and it has to be findable at a glance on a page of black body text.

## Images and links

Two optional extras, both off by default:

- **An image.** It's referenced by content hash exactly as an image block's is,
  so it resolves, uploads and exports through the same path, and it's framed by
  the same `size` (small / medium / large / full) and `align` (left / center /
  right) fields from `packages/core/src/image.ts`.

  The **defaults differ**: an image block starts full width, a VAKT picture
  starts **medium (a 0.65 scale) and centered** (`VAKT_DEFAULT_IMAGE_SIZE`,
  `VAKT_DEFAULT_IMAGE_ALIGN`). A VAKT picture illustrates the action rather than
  carrying the lesson's content, so a smaller picture is the right starting
  point. A picture whose `size` or `align` is missing or unrecognized falls back
  to the VAKT defaults (`vaktImageSize`, `vaktImageAlign`), not to an image
  block's full width.

  Framing describes the **lesson page**: the editor, the read-only view, and
  what's printed. [Interactive mode](./interactive-mode.md) ignores it, for a
  VAKT picture and an image block alike: there a picture is sized by the reading
  column so it fills the width on a phone, which is the point of that view.

- **Links.** Each is stored as `{ id, label, url }` (`createVaktLink`); the
  label is optional. On screen they're real links, opening in a new tab. On
  paper, where a link can't be clicked, `vaktLinkText` prints the label, then
  `VAKT_LINK_JOINER`, then the address, so the address itself is readable.

Only `http:`, `https:` and `mailto:` links are kept (`vaktLinks`). That's the
same rule the comment and bio sanitizers enforce (see [Rich text](./rich-text.md));
a lesson's links are authored rather than user-submitted, but they still become
real `<a href>` in a published page and in a Word document. An unsafe or
half-typed row is dropped at render time rather than refused as you type, so a
URL in progress never destroys what's in the field.

## Round trips

| Path                   | What survives                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Export/Import JSON** | Every supported field, unchanged, the closest thing to a lossless round trip. The importer still drops an unsafe link and a block with no activity in it at all (`vaktHasContent`).                                                                                                                                                                                                                     |
| **Export DOCX**        | The red (via a Word character style), the picture at its own size and alignment, and the links as real hyperlinks.                                                                                                                                                                                                                                                                                      |
| **PDF and Print**      | The red, via that same character style; see below.                                                                                                                                                                                                                                                                                                                                                      |
| **Import DOCX**        | The activity, its picture and its links, read back off the `VAKT:` label. The picture's framing is **not** recovered: it comes back at the VAKT defaults, medium and centered. An image block's is lost the same way (each lands on its own defaults) and for the same reason: mammoth hands back no paragraph alignment, and a printed width can't be told apart from a picture that was simply small. |

The Word character style (`VAKT_STYLE_NAME`, `S2C VAKT`, mapped to the class
`s2c-vakt`) exists for the same reason the question ones do: mammoth drops run
colors, so the PDF path, which renders the docx as HTML, would otherwise print
every activity in plain black. The `S2C` prefix is a historical name that stays
so Word round trips and older exports keep working. See
[the export pipeline](./export-pipeline.md).

The DOCX **importer** matches on the visible `VAKT:` label rather than on that
style, so a lesson typed by hand in Word imports just as well as one this app
printed.

## In the MCP server

The MCP server can write VAKT blocks too, as `{ "type": "vakt", "text": ...,
"links": [...] }`. They are **optional and off by default**: the assistant adds
them only when you ask for them. When you do, the authoring standard puts one per
section, **last**, after that section's questions, and a lesson with one
somewhere else is flagged with a warning (never an error, since a break mid-section
is a legitimate thing to want). See
[Lesson validation](../mcp-server/lesson-validation.md).

A block written there may also carry an `image` from `add_image`, with the same
optional `size` and `align` an image block takes; left off, they land on the
VAKT defaults above.
