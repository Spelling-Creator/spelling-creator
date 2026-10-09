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
  shape is one the checker takes. Every claim has passed so far.
- **More passages, written to cover the checker.** The 12 hub lessons hold
  about one checkable fact a passage, and leave whole properties out (no
  capitals, no planets, one length). `write-passages.mjs` had Opus write 116
  two-paragraph sections in the hub's style: 56 on topics picked so every
  property in the checker's table turns up, 60 on people and history (the
  hub's own main subjects, added in the second round below), and 14 of them
  with no checkable fact at all (a made-up story, a word problem, facts about
  a whole kind of animal). They are labelled the same way: 770 claims in all,
  in 347 training passages, 96 of them empty.
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

### First fine-tune

The 350M model after 5 epochs on the first round's data (56 written sections,
227 training passages, 463 claims), its `int8` export
scored with `run.mjs --holdout --dtype int8` (the notebook's own check gave the
same numbers, so the export lost nothing):

| model                          | in the schema | recall | precision | invented quotes | quiet when none | subject | s/passage |
| ------------------------------ | ------------: | -----: | --------: | --------------: | --------------: | ------: | --------: |
| LFM2-350M-Extract-facts (int8) |         24/24 |    35% |       24% |               4 |            7/12 |     57% |       3.0 |

The shape is learned: every reply is a list of claims in the schema, and on
the claims it finds, the value, unit and qualifier are always right. What is
not learned yet is judgment:

- **Subjects.** "German invasion of the United States" for Einstein leaving
  Germany in 1933, "1895 entrance exam", a country of "VESUVIUS". The checker
  looks a claim up by its subject, so a wrong one is a wrong finding or none.
- **Which property.** Pompeii found in 1748 is `discovered` in the labels and
  `began` from the model, a theory is `discoverer` in one and `creator` in the
  other. The labels are not consistent about these either, which a small
  model cannot learn around.
- **Restraint.** It lists something in 5 of the 12 passages with nothing
  checkable, and more than the labels in most others.

It is also five to ten times faster than the stock models, about 3 seconds a
passage on a CPU, because it writes short replies and stops.

### Second round of data

Two changes, aimed at the first two of those:

- **Consistent choices.** The shared prompt gained a short "Choosing" section
  that settles each confusable pair by what the property means on Wikidata: a
  theory or invention is `discovered` and has a `discoverer`, a made work has
  a `creator`; a thing coming into being `began`, an event `happened`; a place
  found again or dug up gets no date at all. The subject must be a real thing
  with its own encyclopedia article, never a name made up for a sentence, and
  moments in a life other than birth and death are left out. Because the
  prompt is shared, this changes the Worker's fact check too (its cache
  version went to `v4`). Everything was relabelled under it.
- **People and history.** 60 more written sections, 30 biographies and 30
  events and inventions, the genre of most hub lessons and of most of the
  first model's mistakes. None mentions the held-out lessons' subjects.

The held-out labels changed with the rules (Pompeii's 1748 rediscovery is no
longer a claim, relativity has a `discoverer`), so first-round scores and
second-round scores are not on quite the same test. The first fine-tune,
rescored against the new held-out labels, is the bar for the second:

| model                                   | recall | precision | invented quotes | quiet when none | subject |
| --------------------------------------- | -----: | --------: | --------------: | --------------: | ------: |
| LFM2-350M-Extract-facts, round 1 (int8) |    40% |       28% |               3 |            7/13 |     50% |
| LFM2-350M-Extract-facts, round 2 (int8) |    50% |       42% |               2 |            8/13 |     50% |

Better on every count but the one that matters most. The subjects are still
wrong half the time, and now in a way that points at the model's size rather
than the data: it misspells real names ("Annus Miroliis", "Nazwahouse of
Einstein") and invents people ("Marcus Aelius Tarquin the Elder" as the
discoverer of Pompeii), and it still dates Pompeii's rediscovery, which the
rules now leave out.

### What the author would see

Claims are not what the author sees; findings are. `findings.mjs` runs a
model's claims and the labels through the real checker against Wikidata and
compares the two sets of findings. A **false alarm** is a "Wikidata disagrees"
finding the labels do not produce, which tells the author a right fact is
wrong; it is the costly mistake. (The checker's lookups are retried after a
pause, since Wikipedia and Wikidata throttle a burst from one address.)

| model                                   | agrees | disagrees | false alarms | label findings missed |
| --------------------------------------- | -----: | --------: | -----------: | --------------------: |
| labels (Claude Opus)                    |     12 |         2 |            0 |                     0 |
| LFM2-350M-Extract-facts, round 2 (int8) |      5 |         3 |            2 |               9 of 14 |

Both false alarms come from the weaknesses above: "1748" checked as when
Pompeii began (Wikidata says the 7th or 6th century BC), and the Luitpold
Gymnasium's city checked with Munich as the subject. On 24 passages that is
too many to ship. The next step is the same data on LFM2-1.2B-Extract, which
has the room to name things right.

## Running it again

```bash
cd packages/core
node scripts/fact-eval/write-passages.mjs   # only topics with no passage yet
node scripts/fact-eval/label.mjs --check    # only passages with no label yet; --check asks Wikidata too
node scripts/fact-eval/make-dataset.mjs
node scripts/fact-eval/run.mjs --holdout --dtype int8 --models YOUR_NAME/LFM2-350M-Extract-facts-ONNX
node scripts/fact-eval/findings.mjs scripts/fact-eval/out/LFM2-350M-Extract-facts-ONNX.int8.json
```
