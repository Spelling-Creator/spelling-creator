---
license: cc-by-4.0
language:
  - en
pretty_name: Spelling Creator document import
size_categories:
  - n<1K
task_categories:
  - text-generation
tags:
  - information-extraction
  - document-parsing
  - structured-output
configs:
  - config_name: default
    data_files:
      - split: train
        path: train.jsonl
      - split: test
        path: holdout.jsonl
---

# Spelling Creator document import

One section of a lesson as someone might have typed it up, paired with that section as lesson JSON. [Spelling Creator](https://spellingcreator.org) is a lesson builder for Spelling to Communicate (S2C), used with nonspeaking spellers. Its **Import from text** reads a typed lesson with rules, and hands the sections the rules cannot read to a small on-device model; this dataset trains that model.

## What is in it

Chat-format JSONL, ready for a supervised fine-tune (TRL's `SFTTrainer` takes it as is):

- **system**: the lesson section's JSON schema and a guide to the question types.
- **user**: one section of a document, cut and laid out exactly as the import hands it to the model.
- **assistant**: the section as JSON: `name`, `paragraphs`, `spellingWords`, and `questions`, each with `prompt`, `type`, `answers` and `steps`.

Every lesson is rendered in nine layouts (`style` on each row): the app's own Word export read back as raw text, six typed-up layouts the rules read (`plain`, `qa`, `caps`, `bullets`, `colon`, `worked`), and two they cannot (`nomarks`: no question marks or numbers, the answer tacked on; `runon`: a numbered list that lost its line breaks). From those two, a section is in only if the import would really send it to the model. Targets follow the document as written: no section name where it shows no heading, and prompts without question marks where the layout dropped them.

| split | examples | lessons                                                                            |
| ----- | -------: | ---------------------------------------------------------------------------------- |
| train |      521 | 10                                                                                 |
| test  |      108 | the two newest: The History of Domestic Cats, and Pompeii: The City Frozen in Time |

## How it was made

Rendered by code from lessons published on the Spelling Creator hub, so every target is the lesson's own content, not a model's reading of it. The renderers, the splitter and the scorer are in the [Spelling Creator repository](https://github.com/Spelling-Creator/spelling-creator) under `packages/core/scripts/extract-eval/`. The model trained on it is [LFM2-1.2B-Extract-lesson](https://huggingface.co/playforgecoding/LFM2-1.2B-Extract-lesson).

## Attribution

CC BY 4.0. The lessons, by their authors on [spellingcreator.org](https://spellingcreator.org):

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
