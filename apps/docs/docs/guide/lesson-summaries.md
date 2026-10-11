---
title: Lesson summaries
---

# Lesson summaries

A published lesson can be summarized on your own computer, so you can tell at a
glance what a lesson covers before reading it end to end. Nothing is sent to a
server: the summary is written by an AI model running in your browser.

## Making a summary

On a lesson's **Lesson** tab, a **Summary** card with an **On-device AI** badge
sits above the lesson.

1. Pick a style and a length if you like:
   - **Style**: **Key points** (a bulleted list, the default), **TL;DR**,
     **Teaser** or **Headline**.
   - **Length**: **Short** (the default), **Medium** or **Long**. These are
     relative sizes, not word counts.
2. Press **Summarize**. The summary writes itself into the card as the model
   produces it, and **Cancel** stops it.
3. **Copy summary** copies it. **Regenerate** writes a new one.

Changing the style or length clears the summary, so what's on screen always
matches the menus. Press the button again to write one in the new shape.

## The first time

The first summary on a computer has to download a model, once:

- In Chrome or Edge, the browser's own built-in AI model. The card says the
  first summary downloads it and can take a while. Chrome needs about 20 GB of
  free disk space to install it. If the download never starts, the card moves
  on to the open model below where your computer can run it, or says the
  download didn't start.
- Everywhere else, an open AI model called LFM, about 760 MB. The card says so
  before you press the button, so you never start that download by surprise.

A progress bar shows the download. After that the model stays saved in your
browser, and summaries start much faster. To free the space, go to
**Settings**, find **Downloaded AI models** and press **Delete models**. Your
lessons aren't affected. (Chrome's own built-in model belongs to the browser
and isn't removed this way.)

## When the card doesn't appear

The card hides itself rather than showing a button that can't work. You won't
see it when:

- your browser and computer can't run either model (for example, an older
  graphics card, or a browser without the features the open model needs),
- your browser says you're on mobile data or have data saver turned on, so you
  don't get a large download by accident, or
- the lesson is very short, since a summary would be about as long as the
  lesson.

## Language

The summary is written in the lesson's language where the model can manage it.
Chrome's built-in model can write German, English, Spanish, French and
Japanese. The open model can write English, Arabic, Chinese, French, German,
Japanese, Korean and Spanish. A lesson in any other language, or one whose
language your browser can't tell, gets an English summary. In browsers other
than Chrome and Edge, summaries are usually in English.

## Trust it, but check

Under the summary, a note says it was generated on your device (and by which
kind of model) and that it can be wrong. The lesson itself is always the
source of truth. A long lesson may be too big for the model to read in one go;
then it summarizes the first part, and the note says so.

For how summaries work in the code, see the
[developer notes](../developers/web-app/lesson-summaries.md).
