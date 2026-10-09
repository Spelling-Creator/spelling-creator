---
license: cc-by-4.0
language:
  - en
pretty_name: Spelling Creator fact claims
size_categories:
  - n<1K
task_categories:
  - text-generation
tags:
  - information-extraction
  - fact-checking
  - wikidata
  - structured-output
configs:
  - config_name: default
    data_files:
      - split: train
        path: train.jsonl
      - split: test
        path: holdout.jsonl
---

# Spelling Creator fact claims

Passages from [Spelling Creator](https://spellingcreator.org) lessons, each paired with the facts in it that can be checked against Wikidata: a number, a date or a named thing stated about one specific, named, real thing. Spelling Creator is a lesson builder for Spelling to Communicate (S2C), used with nonspeaking spellers. It checks a lesson's facts by having a model list them and then comparing each one with Wikidata in code; this dataset trains a small model to do the listing on the device.

## What is in it

Chat-format JSONL, ready for a supervised fine-tune (TRL's `SFTTrainer` takes it as is):

- **system**: the rules (which facts count, the properties the checker knows, what each field means) and the JSON schema.
- **user**: `Lesson: <title>`, a blank line, and one passage.
- **assistant**: `{"claims": [...]}`, each claim with `quote` (the exact words in the passage), `subject` and `kind` (what the fact is about), `property`, `stated` (for a named fact) or `value` and `unit`, `month` and `day` for a date, and `qualifier` (`exact`, `about`, `more_than`, `less_than`).

| split | passages | claims | from                                                                             |
| ----- | -------: | -----: | -------------------------------------------------------------------------------- |
| train |      227 |    463 | 10 hub lessons and 56 written sections                                           |
| test  |       24 |     20 | 2 hub lessons: Pompeii: The City Frozen in Time, and The Life of Albert Einstein |

Passages with no checkable fact are in with an empty list, on purpose: listing nothing is half the job. Eight of the written sections were made to have none (a made-up story, a word problem, facts about a whole kind of animal).

`raw/` holds the sources: `raw/synthetic/` the written sections, and `raw/labels/` one file per lesson or section with its passages and the claims as listed, before the per-passage split.

## How it was made

- **Passages.** Two from each section of 12 lessons published on the Spelling Creator hub, and 56 more two-paragraph sections written by Claude Opus to cover every property the checker knows (capitals, planets, rivers, people's dates and more), in the hub lessons' style.
- **Labels.** Claude Opus listed each lesson's facts with the same prompt and schema Spelling Creator's server sends its own AI provider. Every claim then passed the gates production applies: its quote must be in a passage word for word, and its shape must be one the checker takes. Nothing was edited by hand.
- **Judging is not in the labels.** A claim says what the passage states, true or not. Whether it is right is the checker's job, against Wikidata.

The scripts that made it, and the scorer, are in the [Spelling Creator repository](https://github.com/Spelling-Creator/spelling-creator) under `packages/core/scripts/fact-eval/`.

## Known gaps

- Labels are one model's reading, with its judgment calls: "Quantum, discovered 1900" is in, and so is one fact about cheetahs in general that the rules say to leave out.
- English only, and small. The written sections are there for coverage, not for the hub's range of topics.

## Attribution

CC BY 4.0. The hub lessons, by their authors on [spellingcreator.org](https://spellingcreator.org):

| Lesson                                                                                                                   | Author  |
| ------------------------------------------------------------------------------------------------------------------------ | ------- |
| [The History of Domestic Cats](https://spellingcreator.org/hub/4ad249e0-ac7b-41ea-920c-d935fe2ab1b2)                     | Admin   |
| [Volcanoes](https://spellingcreator.org/hub/d0d80d67-17d6-43b1-8eb1-bbf38871c1dd)                                        | CoolMom |
| [Pompeii: The City Frozen in Time](https://spellingcreator.org/hub/3c982988-21db-4185-99ae-46c37ecfe708)                 | CoolMom |
| [An Introduction to Quantum Physics](https://spellingcreator.org/hub/f9ab5354-c739-4599-b135-e2d431eda825)               | CoolMom |
| [An Introduction to Theoretical Mathematics](https://spellingcreator.org/hub/a6a26b88-7610-41f3-9b71-f8c0e3198d8c)       | CoolMom |
| [The World's Most Thrilling Theme Parks and Rides](https://spellingcreator.org/hub/15386f72-8f45-40b6-a8d9-d94808e1b3e0) | CoolMom |
| [Penguins](https://spellingcreator.org/hub/47172d61-fce7-4497-bd28-bbdc1bc3becb)                                         | CoolMom |
| [Incredible Inventors](https://spellingcreator.org/hub/9a9e5a50-3dfb-43f5-bb61-cf6074d97001)                             | CoolMom |
| [The History of Programming](https://spellingcreator.org/hub/64f03ca8-7751-4654-a871-342d2dedd250)                       | Admin   |
| [The History of the Web](https://spellingcreator.org/hub/ae01d54c-d039-43da-8c25-b69cd2f9ac52)                           | Admin   |
| [The History of Chocolate](https://spellingcreator.org/hub/d53b77a1-54ba-4311-a462-2f05d6d3b7d6)                         | Admin   |
| [The Life of Albert Einstein](https://spellingcreator.org/hub/a119b2ea-c824-48b0-8df7-8537f971d6fa)                      | Admin   |

The written sections and all labels were generated with Claude Opus for this dataset.
