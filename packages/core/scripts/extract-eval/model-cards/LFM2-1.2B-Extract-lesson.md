---
license: other
license_name: lfm1.0
license_link: LICENSE
language:
  - en
pipeline_tag: text-generation
library_name: transformers
base_model: LiquidAI/LFM2-1.2B-Extract
tags:
  - liquid
  - lfm2
  - edge
  - extraction
  - spelling-creator
---

# LFM2-1.2B-Extract, fine-tuned for Spelling Creator lesson documents

The merged weights (bf16, safetensors). For the browser or Node, use the ONNX
export at
[playforgecoding/LFM2-1.2B-Extract-lesson-ONNX](https://huggingface.co/playforgecoding/LFM2-1.2B-Extract-lesson-ONNX).

## What it does

Turns one section of a spelling lesson document, as a person might type it up
or as the app's own Word export reads back as plain text, into the lesson's
JSON: the passage paragraphs copied word for word, the spelling words, and
every question with its printed answers and working-out. It is a fine-tune of
[LiquidAI/LFM2-1.2B-Extract](https://huggingface.co/LiquidAI/LFM2-1.2B-Extract)
for [Spelling Creator](https://github.com/Spelling-Creator/spelling-creator), a
lesson builder for Spelling to Communicate (S2C), where lessons are read aloud
to nonspeaking spellers.

The stock Extract model handled this badly: it split paragraphs into
sentences, invented answers for open questions, and often abandoned the
schema. This fine-tune copies rather than invents.

## Training

LoRA (rank 16, learning rate 2e-4, 3 epochs, 4096-token context) on 412
examples: the 13 published lessons on the Spelling Creator hub, each rendered
in 7 document layouts (the app's Word export read as raw text, and six
typed-up styles) and cut into sections, paired with the section's lesson JSON.
84 sections from the two newest lessons were held out. The data generator and
the training notebook are in the Spelling Creator repo under
`packages/core/scripts/extract-eval/`.

## Results

On a sample of 20 held-out sections spread across both held-out lessons and
all seven layouts:

| metric                              | value |
| ----------------------------------- | ----: |
| sections parsed as JSON             |   95% |
| spelling words exact                |   85% |
| question prompts found              |   95% |
| answers exact                       |   98% |
| answers invented for open questions |     1 |

For comparison, the stock model's answers were right about half the time on a
tidy typed document and a quarter of the time on the Word export.

Question types are not reliable from this or any small model; Spelling Creator
derives the type from the answers and the wording instead. The app's rule-based
parser still beats this model on every regular layout, so the model is for
documents the parser cannot read. The full write-up is at
[spellingcreator.org/docs/monorepo/document-import-experiment](https://spellingcreator.org/docs/monorepo/document-import-experiment).

## Prompt

The system prompt is `Return data as a JSON object with the following schema:`
followed by the JSON Schema of a section (`name`, `paragraphs`,
`spellingWords`, and `questions`, each with `prompt`, `type`, `answers` and
`steps`), and the user turn is the section's text. Greedy decoding.

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
