// The model behind Import from text, running in the page with transformers.js
// on WebGPU: LFM2-1.2B-Extract fine-tuned on lesson documents.
//
// This module is HEAVY: transformers.js pulls in an ONNX runtime on top of the
// 643 MB model download. transformers.js caches the model in the browser's
// Cache Storage, so later runs load from disk. Nothing may static-import this
// file: it is reached only through the dynamic import() in documentModel.js,
// which keeps it in its own chunk that only a click ever fetches.
// vite.config.js additionally stubs it out of the Worker's SSR build.
//
// The prompt, the section text and the reply handling live in
// core/documentImportModel.js, shared with the scripts that trained the
// model, so what the app sends is exactly what the model learned.
//
// Model: https://huggingface.co/playforgecoding/LFM2-1.2B-Extract-lesson-ONNX
// Licence: the LFM Open License v1.0, as the base model.

import {
  AutoModelForCausalLM,
  AutoTokenizer,
  InterruptableStoppingCriteria,
} from "@huggingface/transformers";
import { parseModelReply, sectionMessages } from "../documentImportModel.js";
import { createDownloadProgress } from "./downloadProgress.js";

// Pinned to a commit, so a later push to the repo can't change what readers
// download without someone here choosing to move the pin.
const MODEL_ID = "playforgecoding/LFM2-1.2B-Extract-lesson-ONNX";
// The second fine-tune, trained on the layouts the rules cannot read too.
const MODEL_REVISION = "6dbcb514d221857b5d2b17ecae1cce91b8047d08";

// A section's JSON is usually 700 to 1,300 tokens; the longest sections in
// the training data (seventeen questions with working-out) passed 1,500,
// which is where the experiment's cap cut one off. A reply that still runs
// past this is closed up by parseModelReply and keeps what it finished.
const MAX_NEW_TOKENS = 2500;

const { reportProgress, withProgress } = createDownloadProgress();

let modelPromise = null;

function loadModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const [tokenizer, model] = await Promise.all([
        AutoTokenizer.from_pretrained(MODEL_ID, {
          revision: MODEL_REVISION,
          progress_callback: reportProgress,
        }),
        AutoModelForCausalLM.from_pretrained(MODEL_ID, {
          revision: MODEL_REVISION,
          dtype: "q4f16",
          device: "webgpu",
          progress_callback: reportProgress,
        }),
      ]);
      return { tokenizer, model };
    })().catch((err) => {
      modelPromise = null;
      throw err;
    });
  }
  return modelPromise;
}

// One generation at a time: the ONNX sessions are shared module state, and
// two interleaved generate() calls would corrupt each other's caches.
let generationTurn = Promise.resolve();

function aborted() {
  return new DOMException("Import aborted.", "AbortError");
}

async function readOne({ tokenizer, model }, section, signal) {
  const inputs = tokenizer.apply_chat_template(sectionMessages(section), {
    add_generation_prompt: true,
    return_dict: true,
  });
  const stopper = new InterruptableStoppingCriteria();
  const onAbort = () => stopper.interrupt();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const output = await (generationTurn = generationTurn
      .catch(() => {})
      .then(() =>
        model.generate({
          ...inputs,
          max_new_tokens: MAX_NEW_TOKENS,
          // Greedy, as the model card prescribes and as it was scored. No
          // repetition penalty: the job is to copy text, repeats included.
          do_sample: false,
          stopping_criteria: stopper,
        }),
      ));
    if (signal?.aborted) throw aborted();
    const reply = tokenizer.batch_decode(
      output.slice(null, [inputs.input_ids.dims[1], null]),
      { skip_special_tokens: true },
    )[0];
    return parseModelReply(reply);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

/** See documentModel.js readSectionsWithModel. */
export async function readSections(sections, hooks = {}) {
  const { signal, onDownloadProgress, onSection } = hooks;
  // Before loadModel(): a run aborted while the chunk was being fetched must
  // never start the download, because once started it runs to the end.
  if (signal?.aborted) throw aborted();
  const loaded = await withProgress(onDownloadProgress, loadModel);
  if (signal?.aborted) throw aborted();

  const results = [];
  for (const section of sections) {
    if (signal?.aborted) throw aborted();
    // Before the section, so the caller can say which one is being read from
    // the moment the model is ready, rather than only once the first is done.
    onSection?.(results.length + 1, sections.length);
    results.push(await readOne(loaded, section, signal));
  }
  return results;
}
