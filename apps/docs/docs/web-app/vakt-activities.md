---
title: VAKT activities
---

# VAKT activities

A **VAKT activity** is a regulation break — a movement or sensory activity a
speller does partway through a lesson. VAKT stands for **v**isual, **a**uditory,
**k**inaesthetic, **t**actile.

> **VAKT:** Bob likes to do jumping jacks. Let's do 3 of those.

Add one from the **VAKT activity** button in a section's toolbar. Everything
about the block — its colour, its label, and its shape — lives in one place,
`packages/core/src/vakt.js`, so the editor, the viewer, both exporters and both
importers stay in sync.

## Not a question

A VAKT activity is **its own block type**, not a seventh question type. The
distinction is load-bearing:

- it is addressed to whoever is running the lesson, not to the speller;
- it is never answered and never scored;
- it isn't counted by [interactive mode](./interactive-mode.md)'s progress bar,
  and it appears with a section's material rather than as a step of its own;
- it doesn't appear in the printed footer legend, which names question types.

Question blocks carry answers and print in the legend. Making VAKT a question
type would have given it all of that and then required exceptions for each one.

## The colour and the label

VAKT activities print in a **bright red** (`#ee1111`), the one colour the six
[question types](./question-blocks.md) and the teal spelling block deliberately
leave free. The red is hue-0 rather than anything warmer on purpose: an orange or
an amber would collide with the **Multiple answers** question type, which is what
pushed that type off burnt orange in the first place.

Every activity is prefixed **`VAKT:`**. That prefix is **not stored** — the block
holds the activity alone, and whatever renders it adds the label, exactly the way
the spelling block's `Spell:` works. So one authored string can never carry two
prefixes, and the label can be translated on screen while the export keeps its
canonical form. Type `VAKT:` into the field yourself and it's stripped, rather
than printed twice.

Unlike a question — where only the _prompt_ is coloured and the answer follows in
black — the whole VAKT line is red. It's an instruction to the person running the
lesson, and it has to be findable at a glance on a page of black body text.

## Images and links

Two optional extras, both off by default:

- **An image.** Use **Add image** to upload one or search
  [Pixabay or Wikimedia](./search-images.md). It's referenced by content hash
  exactly as an image block's is, so it resolves, uploads and exports through the
  same path — and it prints centred at medium width, with no size or alignment
  controls of its own. A VAKT picture illustrates the action rather than carrying
  the lesson's content, so that's one fewer decision on a block whose whole point
  is to be quick to write.
- **Links.** Each is a `{ label, url }` pair — a video to play, a song, a
  printable. On screen they're real links, opening in a new tab. On paper, where
  a link can't be clicked, each prints as `Label — https://address` so the
  address itself is readable; a link with no label is just its address.

Only `http:`, `https:` and `mailto:` links are kept. That's the same rule the
comment and bio sanitizers enforce (see [Rich text](./rich-text.md)) — a lesson's
links are authored rather than user-submitted, but they still become real
`<a href>` in a published page and in a Word document. An unsafe or half-typed
row is dropped at render time rather than refused as you type, so a URL in
progress never destroys what's in the field.

## Round trips

| Path                   | What survives                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------ |
| **Export/Import JSON** | Everything — this is the lossless round trip.                                        |
| **Export DOCX**        | The red (via a Word character style), the picture, and the links as real hyperlinks. |
| **Print PDF**          | The red, via that same character style — see below.                                  |
| **Import DOCX**        | The activity, its picture and its links, read back off the `VAKT:` label.            |

The Word character style (`S2C VAKT`) exists for the same reason the question
ones do: mammoth drops run colours, so the PDF path — which renders the docx as
HTML — would otherwise print every activity in plain black. See
[Question blocks](./question-blocks.md) and
[the export pipeline](./export-pipeline.md).

The DOCX **importer** matches on the visible `VAKT:` label rather than on that
style, so a lesson typed by hand in Word imports just as well as one this app
printed.

## In the MCP server

The MCP server can write VAKT blocks too, as `{ "type": "vakt", "text": …,
"links": [...] }`. They are **optional and off by default**: the assistant adds
them only when you ask for them. When you do, the authoring standard puts one per
section, **last** — after that section's questions — and a lesson with one
somewhere else is flagged with a warning (never an error, since a break mid-section
is a legitimate thing to want). See
[Lesson validation](../mcp-server/lesson-validation.md).
