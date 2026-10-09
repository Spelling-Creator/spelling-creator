---
license: other
license_name: lfm1.0
license_link: LICENSE
language:
  - en
pipeline_tag: text-generation
library_name: transformers
base_model: LiquidAI/LFM2-1.2B-Extract
datasets:
  - playforgecoding/spelling-creator-document-import
tags:
  - liquid
  - lfm2
  - edge
  - extraction
  - spelling-creator
  - trl
  - sft
---

# LFM2-1.2B-Extract, fine-tuned for Spelling Creator lesson documents

The merged weights (bf16, safetensors). For the browser or Node, use the ONNX
export at
[playforgecoding/LFM2-1.2B-Extract-lesson-ONNX](https://huggingface.co/playforgecoding/LFM2-1.2B-Extract-lesson-ONNX).

## What it does

Turns one section of a spelling lesson document, as a person might type it up
or as the app's own Word export reads back as plain text, into the lesson's
JSON: the passage paragraphs copied word for word, the spelling words, and
every question with its printed answers, type and working-out. It is a
fine-tune of
[LiquidAI/LFM2-1.2B-Extract](https://huggingface.co/LiquidAI/LFM2-1.2B-Extract)
for [Spelling Creator](https://github.com/Spelling-Creator/spelling-creator), a
lesson builder for Spelling to Communicate (S2C), where lessons are read aloud
to nonspeaking spellers.

Spelling Creator reads typed lessons with rules first, and only hands this
model the sections the rules cannot read: questions typed with no question
marks or numbers, an answer left glued to its question, a numbered list that
lost its line breaks. This is the second fine-tune, trained on exactly those.

The stock Extract model handled this badly: it split paragraphs into
sentences, invented answers for open questions, and often abandoned the
schema. This fine-tune copies rather than invents.

## Training

LoRA (rank 16, learning rate 2e-4, 3 epochs, 4096-token context) on the
[spelling-creator-document-import](https://huggingface.co/datasets/playforgecoding/spelling-creator-document-import)
dataset: 521 sections from 10 lessons published on the Spelling Creator hub,
each rendered in 9 layouts and paired with the section's lesson JSON. Seven
layouts the app's rules read (its Word export as raw text, and six typed-up
styles), and two they cannot, from which only the sections the app would
really send to the model are kept, laid out exactly as it sends them. The two
newest lessons (108 sections) are held out. The data generator and the
training notebook are in the Spelling Creator repo under
`packages/core/scripts/extract-eval/`.

## Results

The int8 ONNX export, on every section of both held-out lessons (12 per
layout):

| layout                       | parsed | answers | composite |
| ---------------------------- | -----: | ------: | --------: |
| no question marks or numbers |   100% |     97% |       96% |
| numbered list on one line    |    92% |     91% |       89% |
| Word export as raw text      |   100% |     99% |       96% |
| numbered, bracketed answers  |   100% |    100% |       97% |
| Q and A lines                |   100% |    100% |       94% |
| bare capitals, no headings   |   100% |     99% |       96% |
| bullets, square brackets     |    92% |     92% |       89% |
| numbered, colon              |   100% |     96% |       96% |
| working-out on its own line  |    92% |     92% |       88% |

On the first two, the layouts the app actually sends it, Spelling Creator's
rules score 66 and 40 percent. Every row under 94 percent is one section in
twelve whose reply is not valid JSON (a key in the wrong place, a bare string
where a question belonged, a reply that repeated itself), which the app shows
as unread. On the sections that parse, every layout is 96 to 100 percent. The
model's own question types are right 87 to 97 percent of the time, above the
app's rule for deriving them, so the app keeps them. The full write-up is at
[spellingcreator.org/docs/monorepo/document-import-experiment](https://spellingcreator.org/docs/monorepo/document-import-experiment).

## Prompt

The system prompt is `Return data as a JSON object with the following schema:`
followed by the JSON Schema of a section (`name`, `paragraphs`,
`spellingWords`, and `questions`, each with `prompt`, `type`, `answers` and
`steps`) and a short guide to the question types; the user turn is the
section's text. Greedy decoding.

## Use

```python
from transformers import AutoModelForCausalLM, AutoTokenizer

repo = "playforgecoding/LFM2-1.2B-Extract-lesson"
tok = AutoTokenizer.from_pretrained(repo)
model = AutoModelForCausalLM.from_pretrained(repo, dtype="bfloat16", device_map="auto")

messages = [
    {"role": "system", "content": "Return data as a JSON object with the following schema:\n" + schema},
    {"role": "user", "content": section_text},
]
text = tok.apply_chat_template(messages, add_generation_prompt=True, tokenize=False)
ids = tok(text, return_tensors="pt", add_special_tokens=False).input_ids.to(model.device)
out = model.generate(ids, max_new_tokens=1500, do_sample=False)
print(tok.decode(out[0][ids.shape[1]:], skip_special_tokens=True))
```

## Licence

Derived from LFM2-1.2B-Extract and released under the same LFM Open License
v1.0 (see LICENSE).
