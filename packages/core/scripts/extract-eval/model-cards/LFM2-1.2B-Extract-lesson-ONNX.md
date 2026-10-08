---
license: other
license_name: lfm1.0
license_link: LICENSE
language:
  - en
pipeline_tag: text-generation
library_name: transformers.js
base_model: playforgecoding/LFM2-1.2B-Extract-lesson
tags:
  - liquid
  - lfm2
  - edge
  - extraction
  - spelling-creator
---

# LFM2-1.2B-Extract, fine-tuned for Spelling Creator lesson documents (ONNX)

The ONNX export of
[playforgecoding/LFM2-1.2B-Extract-lesson](https://huggingface.co/playforgecoding/LFM2-1.2B-Extract-lesson)
for [Transformers.js](https://huggingface.co/docs/transformers.js), made with
the onnxruntime-genai model builder and laid out the way the onnx-community
LFM2 files are.

## What it does

Turns one section of a spelling lesson document, as a person might type it up
or as the app's own Word export reads back as plain text, into the lesson's
JSON: the passage paragraphs copied word for word, the spelling words, and
every question with its printed answers and working-out. It is a fine-tune of
[LiquidAI/LFM2-1.2B-Extract](https://huggingface.co/LiquidAI/LFM2-1.2B-Extract)
for [Spelling Creator](https://github.com/Spelling-Creator/spelling-creator), a
lesson builder for Spelling to Communicate (S2C), where lessons are read aloud
to nonspeaking spellers. The training and the results are on the merged
model's card.

## Files

| file                    | for                                              | note                                                                                                                                             |
| ----------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `onnx/model_q4f16.onnx` | WebGPU (`device: "webgpu"`, `dtype: "q4f16"`)    | Verified: copies a real section faithfully in Chromium. The one to ship in a browser.                                                            |
| `onnx/model_int8.onnx`  | CPU: Node and the wasm backend (`dtype: "int8"`) | Verified through transformers.js on the held-out lessons: answers 96 to 100% exact on six of seven layouts (see below). The one to use on a CPU. |
| `onnx/model_q4.onnx`    | CPU                                              | Not faithful for this checkpoint: paraphrases instead of copying. Kept for reference.                                                            |

## Results of the int8 export

Scored through transformers.js (onnxruntime-node, `dtype: "int8"`) on the two
lessons held out of training, two sections each, in all seven document layouts
the training data used:

| layout                      | parsed | passage words | spelling | prompts | answers |
| --------------------------- | -----: | ------------: | -------: | ------: | ------: |
| Word export as raw text     |   100% |          100% |     100% |    100% |    100% |
| numbered, bracketed answers |   100% |          100% |     100% |    100% |    100% |
| Q and A lines               |   100% |          100% |      81% |    100% |     98% |
| bare capitals, no headings  |    75% |           75% |      75% |     75% |     75% |
| bullets, square brackets    |   100% |          100% |     100% |    100% |    100% |
| numbered, colon             |   100% |          100% |     100% |     98% |     96% |
| working-out on its own line |   100% |          100% |     100% |    100% |    100% |

The one miss in the capitals layout is a single long section where the reply
hit the 1,500-token cap before closing its JSON; the other three sections in
that layout were perfect. The model's own question types were right 93 to 99
percent of the time here, better than on the sample scored in the training
notebook.

## Use

```javascript
import { AutoModelForCausalLM, AutoTokenizer } from "@huggingface/transformers";

const repo = "playforgecoding/LFM2-1.2B-Extract-lesson-ONNX";
const tokenizer = await AutoTokenizer.from_pretrained(repo);
const model = await AutoModelForCausalLM.from_pretrained(repo, {
  dtype: "q4f16",
  device: "webgpu",
});

const inputs = tokenizer.apply_chat_template(
  [
    {
      role: "system",
      content:
        "Return data as a JSON object with the following schema:\n" + schema,
    },
    { role: "user", content: sectionText },
  ],
  { add_generation_prompt: true, return_dict: true },
);
const output = await model.generate({
  ...inputs,
  max_new_tokens: 1500,
  do_sample: false,
});
console.log(
  tokenizer.batch_decode(output.slice(null, [inputs.input_ids.dims[1], null]), {
    skip_special_tokens: true,
  })[0],
);
```

## How it was converted

`python -m onnxruntime_genai.models.builder -i merged -p int4 -e webgpu` for
q4f16 and `-e cpu` for q4, then `relayout-onnx.py` from the Spelling Creator
repo, which renames the convolution caches to `past_conv.N`, makes the KV
cache's head dimension concrete, moves the chat template into
`tokenizer_config.json`, adds the `transformers.js_config` block, and puts the
graphs under `onnx/`. The route is written up at
[spellingcreator.org/docs/monorepo/document-import-experiment](https://spellingcreator.org/docs/monorepo/document-import-experiment).

## Licence

Derived from LFM2-1.2B-Extract and released under the same LFM Open License
v1.0 (see LICENSE).
