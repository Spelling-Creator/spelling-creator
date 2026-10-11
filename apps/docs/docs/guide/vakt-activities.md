---
title: VAKT activities
---

# VAKT activities

A **VAKT activity** is a regulation break: a movement or sensory activity the
speller does partway through a lesson. VAKT stands for **v**isual,
**a**uditory, **k**inesthetic, **t**actile.

> **VAKT:** Bob likes to do jumping jacks. Let's do 3 of those.

To add one, press **VAKT activity** in a section's toolbar and type the
activity into the **Activity** field.

<DemoVideo name="editor-vakt-activity" title="Adding a VAKT activity">
A VAKT activity added at the end of a section, with a link and a picture from
Wikimedia Commons, then the lesson in Preview with the activity in red under
its VAKT label.
</DemoVideo>

## Not a question

A VAKT activity is its own kind of block, not a question:

- it's an instruction for whoever is running the lesson, not something the
  speller answers;
- it's never answered or scored;
- in [interactive mode](./interactive-mode.md) it isn't counted in the
  progress bar, and it appears with the section's reading material rather than
  as a step of its own;
- it isn't in the legend at the foot of each printed page, which only names
  question types.

## How it looks

The whole activity prints in **bright red**, a color none of the
[question types](./question-blocks.md) or the spelling list use, so it stands
out on a page of black text.

Every activity starts with the label **VAKT:**. The app adds the label for you,
so just type the activity itself. If you type "VAKT:" at the start anyway, it
isn't printed twice.

## Pictures and links

Both are optional.

- **A picture.** Press **Add image** to upload one from your device or search
  for one on Pixabay or Wikimedia Commons (see [Pictures](./images.md)). Once
  there's a picture, buttons under it set its **alignment** (left, center or
  right) and **size** (Small, Medium, Large or Full), and you can add a caption.
  A VAKT picture starts at Medium and centered, smaller than a normal picture
  block, since it illustrates the activity rather than carrying the lesson.
  Interactive mode ignores these settings and fits the picture to the screen.
- **Links.** Press **Add link** for a video to play, a song or something to
  print. Each link has an address and optional link text; a link with no text
  shows its address. On screen the links open in a new tab. On paper, where
  you can't click, each prints as its text followed by its address, so the
  address can be typed in.

Only web addresses (`http://` or `https://`) and email links (`mailto:`) are
kept. A link that's unfinished or uses anything else is left out when the
lesson is shown or printed, but stays in the field so you can finish typing it.

## Exporting and importing

| Where                    | What's kept                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Export JSON** and back | Everything.                                                                                                            |
| **Export DOCX**          | The red, the picture at its size and alignment, and the links as real links.                                           |
| **Print PDF**            | The red, as in the Word document the PDF is made from.                                                                 |
| **Import Word document** | The activity, its picture and its links. The picture comes back at Medium and centered, whatever it was set to before. |

Word import finds activities by their "VAKT:" label, so a lesson typed by hand
in Word with "VAKT:" lines imports too.

## With an AI assistant

An [AI assistant](./ai-assistants/overview.md) connected to Spelling Creator
only adds VAKT activities when you ask for them. When it does, it puts one at
the end of each section, after the questions.

For how this works, see the [developer notes](../developers/web-app/vakt-activities.md).
