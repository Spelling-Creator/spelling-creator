---
license: other
license_name: lfm1.0
license_link: LICENSE
language:
  - en
pipeline_tag: text-generation
library_name: transformers.js
base_model: playforgecoding/LFM2-1.2B-Extract-facts
tags:
  - liquid
  - lfm2
  - edge
  - extraction
  - fact-checking
  - spelling-creator
---

# LFM2-1.2B-Extract, fine-tuned to list checkable facts in lesson passages (ONNX)

The ONNX export of
[playforgecoding/LFM2-1.2B-Extract-facts](https://huggingface.co/playforgecoding/LFM2-1.2B-Extract-facts)
for [Transformers.js](https://huggingface.co/docs/transformers.js), made with
the onnxruntime-genai model builder and laid out the way the onnx-community
LFM2 files are.

**Experimental.** Not used by Spelling Creator yet: it still lists a few facts
the rules leave out, which can turn into false alarms in a fact check. The
training, the results and what it does are on the merged model's card.

## Files

| file                    | for                                              |
| ----------------------- | ------------------------------------------------ |
| `onnx/model_q4f16.onnx` | WebGPU (`device: "webgpu"`, `dtype: "q4f16"`)    |
| `onnx/model_int8.onnx`  | CPU: Node and the wasm backend (`dtype: "int8"`) |

On the 24 held-out passages the int8 export finds 55 percent of the labelled
claims, 46 percent of what it lists matches a label, and it takes about 10
seconds a passage on an M4's CPU.

## Use

```javascript
import { AutoModelForCausalLM, AutoTokenizer } from "@huggingface/transformers";
import { passageClaimsMessages, parseClaimsReply } from "./factClaims.js"; // from Spelling Creator's core package

const repo = "playforgecoding/LFM2-1.2B-Extract-facts-ONNX";
const tokenizer = await AutoTokenizer.from_pretrained(repo);
const model = await AutoModelForCausalLM.from_pretrained(repo, {
  dtype: "q4f16",
  device: "webgpu",
});

const inputs = tokenizer.apply_chat_template(
  passageClaimsMessages(passage, lessonTitle),
  { add_generation_prompt: true, return_dict: true },
);
const output = await model.generate({
  ...inputs,
  max_new_tokens: 1000,
  do_sample: false,
});
const claims = parseClaimsReply(
  tokenizer.batch_decode(output.slice(null, [inputs.input_ids.dims[1], null]), {
    skip_special_tokens: true,
  })[0],
);
```

Drop any claim whose `quote` is not in the passage before looking it up.

## How it was converted

`python -m onnxruntime_genai.models.builder -i merged -p int4 -e webgpu` for
q4f16 and `-p int8 -e cpu` for int8, then `relayout-onnx.py` from the
Spelling Creator repo, which renames the convolution caches to `past_conv.N`,
makes the KV cache's head dimension concrete, moves the chat template into
`tokenizer_config.json`, adds the `transformers.js_config` block, and puts the
graphs under `onnx/`. The route is written up at
[spellingcreator.org/docs/monorepo/document-import-experiment](https://spellingcreator.org/docs/monorepo/document-import-experiment).

## Licence

Derived from LFM2-1.2B-Extract and released under the same LFM Open License
v1.0 (see LICENSE).
