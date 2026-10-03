---
title: Lesson translation (on-device AI)
---

# Lesson translation (on-device AI)

A published lesson can be read in the reader's own language: a **Translate**
action above the document swaps its prose for a translation, **on the reader's
device**. Nothing is sent to a server and nothing is stored; like a
[translated comment](./comment-translation.md), a translated lesson is
per-reader and per-visit, with **Show original** one click away. It runs on
exactly the same two engines as comment translation, in the same order (the
browser's built-in Translator API, then a transformers.js model in the page),
with the same language table, the same source-language picker when detection
gets it wrong, and the same model-download progress bar. That page describes
the machinery; this one describes what's different when the thing being
translated is a lesson rather than a comment.

## What translates, and what deliberately doesn't

A comment is all prose. A lesson isn't: part of its content is the language
being taught, and translating that would change the lesson rather than make it
readable. `@spelling-creator/core/lessonTranslation` is the one list of what
translation covers, shared by the renderer and the translation runner so the
two can't drift apart:

| Translated                       | Left as written                            |
| -------------------------------- | ------------------------------------------ |
| The document title               | Spelling words (they are the material)     |
| Text blocks, line by line        | Question answers (what the speller spells) |
| Question prompts and their steps | Image captions (mostly attribution)        |
| VAKT activity text               | VAKT link labels (names of external sites) |

A note under a translated lesson says the word lists and answers stay in the
lesson's own language, so an untranslated spelling list reads as the feature
working, not failing.

This is also why the feature lives only on the lesson page's reading view:
[interactive mode](./interactive-mode.md) scores what a speller types against
the author's answers, and the [DOCX/PDF exports](./export-pipeline.md) print
the lesson as written, so both always use the original document.

## Translating something 37 screens long

A comment translates in one go; a finished lesson runs to dozens of screens,
and on the fallback engine (NLLB in the page) that could take minutes. So the
lesson is translated **a batch at a time, in reading order**: the title first,
then one batch per section (`lessonTranslationBatches`). Each batch shows as
soon as it lands, which means the reader starts reading a translated lesson
from the top while the bottom is still arriving. The bar above the document
counts batches ("3 of 12 parts done"), shows the model-download progress line
when an engine has to fetch one, and offers **Cancel**, which keeps whatever
was already translated from costing anything (the run aborts, the lesson goes
back to how it was).

Language detection reads a sample from the top of the lesson
(`lessonLanguageSample`), not all of it: detection doesn't need 37 screens,
and on the fallback path every character fed to the detector costs time.

## How it works

```
LessonOverview.jsx                  the lesson tab
  └── LessonTranslation.jsx         the Translate bar, batch loop, picker, progress
        ├── core/lessonTranslation  segments + keys + batches (pure, Node-testable)
        └── core/browser/translator engine choice, detection (comment translation's stack)
              └── core/browser/fallbackTranslator  (lazy chunk, see comment translation)
LessonView.jsx                      renders doc + optional Map of translated segments
```

1. **Segments, keyed.** `lessonTranslationBatches(doc)` walks the document and
   emits `{ key, text }` segments for everything in the "translated" column
   above. Keys (`lessonSegmentKey`) are index-based (`s0.b2.prompt`), which is
   safe because translation only ever runs against a published document that
   can't change underneath it.
2. **Detect, or ask.** The source language comes from `detectLanguage` on the
   sample, and everything a wrong guess can cause works as it does for
   comments: an "already in your language" toast, a picker when detection
   can't decide, a **Wrong language?** action under a finished translation.
3. **Translate batch by batch.** Each batch goes through `translateBlocks`;
   results accumulate in a Map from segment key to translated string, and the
   Map is handed to `LessonView` as it grows.
4. **Render by lookup.** `LessonView` takes the Map as an optional
   `translation` prop: any segment the Map covers renders translated, anything
   else renders as written. That one rule is what makes the partial state
   (translated down to section 5, original below) and the untranslatable
   content (answers, spelling words) both fall out for free. No markup is
   involved anywhere: lesson text is plain strings, so unlike comments there
   is no rich-text flattening and **Show original** loses nothing.

Everything stays in component state. Leaving the page aborts any run in
flight, along with whichever model download it started.

## Testing it

The engines and their browser requirements are comment translation's; see
[that page's testing notes](./comment-translation.md#testing-it) for forcing
the fallback path. The lesson-specific part, what gets segmented and what gets
skipped, is pure string work tested in Node
(`core/lessonTranslation.test.js`).
