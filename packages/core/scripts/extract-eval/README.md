# Document to lesson extraction experiment

Can a small on-device model turn a lesson document (a Word export, a hand-typed
page) back into lesson JSON? This script answers that with numbers before any
import feature is built on it.

```bash
cd packages/core
node scripts/extract-eval/run.mjs --dry-run              # render + split only
node scripts/extract-eval/run.mjs --lessons 4 --sections 2
node scripts/extract-eval/run.mjs --models onnx-community/Qwen3-0.6B-ONNX --dtype q4
node scripts/extract-eval/run.mjs --strategy rules --styles all
node scripts/extract-eval/make-dataset.mjs               # fine-tuning pairs
```

Two strategies. `model` hands a whole section to the model and takes the JSON
it writes back. `rules` (`hybrid` is accepted as its older name) parses the
section with the import's own rule-based parser from
`packages/core/src/documentImport.js`, through `parse.mjs`, and loads no model
at all. `layouts.mjs` holds
the typed-up document styles (`--styles all` runs every one plus the Word
export), and `make-dataset.mjs` renders every published lesson in every layout
into chat-format JSONL for a supervised fine-tune, holding out the newest
lessons.

`finetune-colab.ipynb` is the fine-tune itself: open it in Google Colab, upload
the two JSONL files, fill in your Hugging Face name in the first cell and run
it top to bottom. It trains a LoRA adapter on LFM2-1.2B-Extract, scores the
held-out sections, merges, converts to ONNX with the transformers.js script and
pushes a repo that `run.mjs --models` can take. The conversion uses Microsoft's
onnxruntime-genai model builder, which is what the onnx-community LFM2 files
were made with, and `relayout-onnx.py` turns the builder's output into the
layout transformers.js loads (cache names, a concrete cache dimension, the
chat template and config settings, the `onnx/` folder). The docs page has the
details and the browser verification. To score an export before it is
uploaded, pass `--local-models <dir>` and name the folder under it with
`--models`.

`publish-colab.ipynb` picks up after a training run whose session has ended:
from the merged model on the Hub it builds the int8 CPU export, checks that it
copies a section rather than paraphrasing it, and uploads it.

The model cards for the two published repos are in `model-cards/`, one file
per repo, and go up with the Hub CLI along with the base model's licence,
which the derived repos must carry:

```bash
hf download LiquidAI/LFM2-1.2B-Extract LICENSE --local-dir /tmp/lfm2
hf upload playforgecoding/LFM2-1.2B-Extract-lesson model-cards/LFM2-1.2B-Extract-lesson.md README.md
hf upload playforgecoding/LFM2-1.2B-Extract-lesson /tmp/lfm2/LICENSE LICENSE
hf upload playforgecoding/LFM2-1.2B-Extract-lesson-ONNX model-cards/LFM2-1.2B-Extract-lesson-ONNX.md README.md
hf upload playforgecoding/LFM2-1.2B-Extract-lesson-ONNX /tmp/lfm2/LICENSE LICENSE
```

What it does:

1. `lessons.mjs` fetches the newest six-section lessons from the public hub and
   caches them in `.cache/lessons`.
2. `render.mjs` turns each into two documents: the app's own DOCX export read
   back as raw text (no headings, types only in colour), and a hand-typed style
   with headings, a "Spelling words:" line and numbered questions with answers
   in brackets. The texts land in `out/`.
3. `split.mjs` cuts a document into sections by structure (a passage after
   questions starts a new one), since a small model does better on one section
   than on a whole lesson.
4. `extract.mjs` runs an ONNX model from Hugging Face through transformers.js on
   the CPU, one section at a time, greedy decoding, with the lesson shape as the
   schema in the system prompt. LFM2 Extract models get the model card's
   prompt; any other chat model gets the same schema inside an instruction.
5. `score.mjs` compares each extraction with the section it was rendered from
   (passage text, spelling words, question prompts, types and answers), rebuilds
   a lesson from the extractions and runs the lesson checks on it.

`out/results.json` has every row; `out/summary.md` the table per model and
style. `rescore.mjs` re-scores the saved outputs in `out/` with the current
`score.mjs`, so a scoring change needs no model run. Models are cached in
`.cache` (gitignored) and are large: the 1.2B Extract model is about 1.2 GB at
q4, the 350M one about 460 MB.

The results and what they mean are written up in the docs site under
Monorepo, "Document import experiment".
