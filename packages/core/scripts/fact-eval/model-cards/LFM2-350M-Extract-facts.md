---
license: other
license_name: lfm1.0
license_link: LICENSE
language:
  - en
pipeline_tag: text-generation
library_name: transformers
base_model: LiquidAI/LFM2-350M-Extract
datasets:
  - playforgecoding/spelling-creator-fact-claims
tags:
  - liquid
  - lfm2
  - edge
  - extraction
  - fact-checking
  - spelling-creator
  - trl
  - sft
---

# LFM2-350M-Extract, fine-tuned to list checkable facts in lesson passages

The merged weights (bf16, safetensors). For the browser or Node, use the ONNX
export at
[playforgecoding/LFM2-350M-Extract-facts-ONNX](https://huggingface.co/playforgecoding/LFM2-350M-Extract-facts-ONNX).

**Experimental.** It is not used by Spelling Creator: on held-out lessons it
still names the subject of a fact wrong half the time, which turns into false
alarms in a fact check (see Results).

## What it does

Reads one passage of a lesson and lists the facts in it that can be checked
against Wikidata: a number, a date or a named thing stated about one specific,
named, real thing ("Mount Everest rises 8,849 METRES", "CANBERRA is the
capital"). Each claim has the exact words it rests on (`quote`), what it is
about (`subject`, `kind`), which `property` it states, and the `value` and
`unit` or the `stated` name. It never says whether a fact is right; that is
done in code against Wikidata.

It is a fine-tune of
[LiquidAI/LFM2-350M-Extract](https://huggingface.co/LiquidAI/LFM2-350M-Extract)
for [Spelling Creator](https://github.com/Spelling-Creator/spelling-creator), a
lesson builder for Spelling to Communicate (S2C), where lessons are read aloud
to nonspeaking spellers. Spelling Creator's fact check asks a hosted model for
the claims today; a model like this one would let the whole check run on the
device.

## Training

LoRA (rank 16, learning rate 2e-4, 5 epochs, 3072-token context) on the
[spelling-creator-fact-claims](https://huggingface.co/datasets/playforgecoding/spelling-creator-fact-claims)
dataset: 347 passages and 750 claims, from 10 hub lessons and 116 sections
written for coverage, 96 of the passages with nothing to list. The labels are
Claude Opus's, made with the same prompt Spelling Creator's server sends its
own provider. Only the reply carries loss. Two hub lessons (24 passages, 20
claims) are held out. The scripts are in the Spelling Creator repo under
`packages/core/scripts/fact-eval/`.

## Results

The int8 ONNX export on the 24 held-out passages:

| metric                                        | stock 350M | this model |
| --------------------------------------------- | ---------: | ---------: |
| replies in the schema                         |      16/24 |      24/24 |
| labelled claims found                         |         0% |        50% |
| listed claims that match a label              |        n/a |        42% |
| quotes not in the passage                     |        243 |          2 |
| empty list for a passage with nothing to list |       0/13 |       8/13 |
| subject named right, of the claims found      |        n/a |        50% |

Run through the real checker against Wikidata, its claims give 2 false alarms
(a right fact reported as contradicted by Wikidata) in those 24 passages,
both from a wrong subject or a date the rules say to leave out, and miss 9 of
the 14 findings the labels give. The value, unit and qualifier of the claims
it does find are almost always right; naming the subject is what it cannot do
at this size. The write-up is at
[spellingcreator.org/docs/monorepo/fact-claim-model](https://spellingcreator.org/docs/monorepo/fact-claim-model).

## Prompt

The system prompt is the rules (which facts count, the properties with a short
description each, how to choose between near ones, what each field means) and
the JSON Schema of the reply; the user turn is `Lesson: <title>`, a blank line
and the passage. Greedy decoding. The exact text is `passageClaimsSystemPrompt`
in `packages/core/src/factClaims.js`, and every training example carries it.

## Licence

Derived from LFM2-350M-Extract and released under the same LFM Open License
v1.0 (see LICENSE).
