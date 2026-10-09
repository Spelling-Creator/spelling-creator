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

| file                    | for                                              | note                                                                                                                |
| ----------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `onnx/model_q4f16.onnx` | WebGPU (`device: "webgpu"`, `dtype: "q4f16"`)    | What Spelling Creator ships in the browser.                                                                         |
| `onnx/model_int8.onnx`  | CPU: Node and the wasm backend (`dtype: "int8"`) | Scored below. The one to use on a CPU. There is no `q4` CPU file: for this model it paraphrased instead of copying. |

## Results of the int8 export

Scored through transformers.js (onnxruntime-node, `dtype: "int8"`) on every
section of the two lessons held out of training, 12 per layout:

| layout                       | parsed | passage words | spelling | prompts | answers |
| ---------------------------- | -----: | ------------: | -------: | ------: | ------: |
| no question marks or numbers |   100% |          100% |      98% |     98% |     97% |
| numbered list on one line    |    92% |           92% |      92% |     91% |     91% |
| Word export as raw text      |   100% |           99% |      98% |     97% |     99% |
| numbered, bracketed answers  |   100% |          100% |     100% |     98% |    100% |
| Q and A lines                |   100% |           99% |      85% |     99% |    100% |
| bare capitals, no headings   |   100% |           99% |      98% |     98% |     99% |
| bullets, square brackets     |    92% |           91% |      92% |     90% |     92% |
| numbered, colon              |   100% |           99% |     100% |     99% |     96% |
| working-out on its own line  |    92% |           89% |      92% |     89% |     92% |

The first two are the layouts Spelling Creator actually hands the model,
where its rules score 66 and 40 percent. Each row under 100 percent parsed is
one section in twelve whose reply is not valid JSON; none hit the token cap.
About 30 seconds a section on an M4's CPU.

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
q4f16 and `-p int8 -e cpu` for int8, then `relayout-onnx.py` from the Spelling Creator
repo, which renames the convolution caches to `past_conv.N`, makes the KV
cache's head dimension concrete, moves the chat template into
`tokenizer_config.json`, adds the `transformers.js_config` block, and puts the
graphs under `onnx/`. The route is written up at
[spellingcreator.org/docs/monorepo/document-import-experiment](https://spellingcreator.org/docs/monorepo/document-import-experiment).

## Licence

Derived from LFM2-1.2B-Extract and released under the same LFM Open License
v1.0 (see LICENSE).
