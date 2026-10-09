---
title: Fact claim model
---

# Fact claim model

[Fact checking](/web-app/fact-checking) has two halves. Judging a claim is
code: `checkClaims` in `packages/core/src/factCheck.js` looks the subject up
on Wikipedia and Wikidata and compares the values, and it runs anywhere,
the browser included (Wikipedia and Wikidata answer the page directly, as they
do for the image search). Listing the claims in a passage is a language
problem, and today it is the Worker's AI provider's job. If a small model in
the page could do the listing, the whole check could run on the device: no
Worker call, no Turnstile, no token, and it would work on a self-hosted
instance with no AI provider.

This page is the experiment for that. The code is in
`packages/core/scripts/fact-eval/`.

## The prompt is shared

The extraction prompt, its schema and the quote check (`placeClaims`) moved
from the Worker into core, `packages/core/src/factClaims.js`. The Worker
imports them from there and sends exactly what it sent before (checked
byte for byte). Beside them is the on-device version, which reads one passage
at a time: the same rules and field descriptions as the system turn, without
the passage numbers, and `Lesson: <title>` plus the passage as the user turn.
The training scripts build their examples from it, so the prompt a model is
trained on is the one the app would send.

## The data

- **Labels from Claude, through a subscription.** `label.mjs` sends each
  lesson's passages to Claude Opus with the Worker's own prompt and schema,
  through the Claude Code CLI (`claude -p` with structured output), so it
  needs a Claude subscription and no API key. Every claim then passes the
  gates production applies: its quote is in a passage word for word, and its
  shape is one the checker takes. All 127 claims from the hub passed.
- **More passages, written to cover the checker.** The 12 hub lessons hold
  about one checkable fact a passage, and leave whole properties out (no
  capitals, no planets, one length). `write-passages.mjs` had Opus write 56
  two-paragraph sections in the hub's style, on topics picked so every
  property in the checker's table turns up, and eight with no checkable fact
  at all (a made-up story, a word problem, facts about a whole kind of
  animal). They were labelled the same way: 483 claims in all.
- **Split.** Every passage is one example, empty list included. Held out:
  the hub's Pompeii and Albert Einstein lessons (24 passages, 20 claims). Not
  the newest two as in the import experiment, because those hold only 8
  claims between them.

The passages and labels are committed under `scripts/fact-eval/data/`,
since each label costs a Claude call and comes out a little different every
time. The built dataset is public, CC BY 4.0, with the lesson authors
credited:
[playforgecoding/spelling-creator-fact-claims](https://huggingface.co/datasets/playforgecoding/spelling-creator-fact-claims)
(and the import model's, built the same way:
[playforgecoding/spelling-creator-document-import](https://huggingface.co/datasets/playforgecoding/spelling-creator-document-import)).
Lessons whose author has not been asked are left out of both
(`NOT_ARCHIVED` in `scripts/extract-eval/lessons.mjs`).

## The stock models

`run.mjs --holdout`, the 24 held-out passages, q4 on an M4's CPU:

| model                     | in the schema | recall | invented quotes | quiet when none | s/passage |
| ------------------------- | ------------: | -----: | --------------: | --------------: | --------: |
| LFM2-350M-Extract (stock) |         16/24 |     0% |             243 |            0/12 |      14.7 |
| LFM2-1.2B-Extract (stock) |          7/24 |     0% |              28 |            0/12 |      31.1 |

Neither finds a single labelled claim. The 350M model does not read the
passage at all: it walks down the property list from the instructions and
fills in the prompt's own examples ("8,849", "4.5 million"), whatever the
passage says. The 1.2B model writes a shape of its own (`lesson_passage`, a
property of "Bay of Naples", keys repeated). Neither lists nothing for a
passage with nothing to list. The task needs a fine-tune.

**Recall** is the share of labelled claims found (same property, and an
overlapping quote or the same value); **in the schema** counts replies that
hold a list of claims at all; **invented quotes** are quotes not in the
passage, which production drops; **quiet when none** is how often the model
returns an empty list for a passage with no checkable fact.

## Training

`finetune-colab.ipynb` trains a LoRA adapter on LFM2-350M-Extract, the
smallest Extract model and a short download for a page. It loads the
published dataset, so there is nothing to upload. The data is given as prompt
and completion, so only the reply carries loss: the 5,700-character rules and
schema are the same in every example. It scores the held-out passages, merges,
and exports `q4f16` and `int8` with the same builder and
`relayout-onnx.py` as the [import model](./document-import-experiment.md).

## Running it again

```bash
cd packages/core
node scripts/fact-eval/write-passages.mjs   # only topics with no passage yet
node scripts/fact-eval/label.mjs --check    # only passages with no label yet; --check asks Wikidata too
node scripts/fact-eval/make-dataset.mjs
node scripts/fact-eval/run.mjs --holdout --dtype int8 --models YOUR_NAME/LFM2-350M-Extract-facts-ONNX
```
