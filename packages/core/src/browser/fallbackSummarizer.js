// The summarisation fallback, for browsers without the built-in Summarizer
// API: Gemma 4 (E2B, instruction-tuned) running in the page with
// transformers.js, on WebGPU.
//
// The model repo is multimodal, but loading it through Gemma4ForCausalLM puts
// transformers.js in text-only mode, so only the text components are fetched:
// the embedding and decoder weights, about 3 GB at q4f16, skipping the vision
// and audio encoders entirely. That is five times the NLLB translation
// fallback, which is why summarizer.js only reports the fallback as available
// on WebGPU hardware that can actually run it, and why the UI warns about the
// download before the click.
//
// This module is HEAVY: transformers.js pulls in an ONNX runtime on top of the
// model download above. transformers.js caches the model in the browser's
// Cache Storage, so later runs load from disk. Nothing may static-import this
// file: it is reached only through the dynamic import() in summarizer.js,
// which keeps it in its own chunk that only a click on Summarise ever fetches.
// vite.config.js additionally stubs it out of the Worker's SSR build, where it
// could never run anyway.
//
// Model: https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX

import {
  AutoProcessor,
  Gemma4ForCausalLM,
  InterruptableStoppingCriteria,
  TextStreamer,
} from "@huggingface/transformers";
import { createDownloadProgress } from "./downloadProgress.js";

const MODEL_ID = "onnx-community/gemma-4-E2B-it-ONNX";

// The session's input budget, in tokens (what measureInputUsage reports). The
// model's context window is far larger, but prefill time and KV-cache memory
// on consumer GPUs are the real limit, and a lesson that overruns this is
// better cut than left to exhaust the tab's GPU memory.
const INPUT_QUOTA_TOKENS = 4096;

// Enough for the longest shape we ask for (seven bullet points); generation
// stops at the end-of-turn token long before this on every other shape.
const MAX_NEW_TOKENS = 512;

// What each type/length pair asks the model to write. Mirrors the output the
// built-in Summarizer API produces for the same options (3/5/7 bullets for
// key points, 1/3/5 sentences for prose, 12/17/22 words for a headline), so
// the dropdowns mean the same thing whichever engine answers.
const SUMMARY_SHAPES = {
  "key-points": {
    short: "a markdown bulleted list of the 3 most important points",
    medium: "a markdown bulleted list of the 5 most important points",
    long: "a markdown bulleted list of the 7 most important points",
  },
  tldr: {
    short: "a one-sentence summary",
    medium: "a summary of about three sentences",
    long: "a summary of about five sentences",
  },
  teaser: {
    short:
      "a one-sentence teaser that makes a teacher curious about the lesson",
    medium:
      "a teaser of about three sentences that makes a teacher curious about the lesson",
    long: "a teaser of about five sentences that makes a teacher curious about the lesson",
  },
  headline: {
    short: "a single headline of at most 12 words",
    medium: "a single headline of at most 17 words",
    long: "a single headline of at most 22 words",
  },
};

// Same instruction the built-in engine gets as sharedContext (summarizer.js),
// for the same reason: without it, a lesson full of question prompts and word
// lists reads like a worksheet to fill in rather than a lesson to describe.
function summaryPrompt({ type, length }, text) {
  const shape =
    SUMMARY_SHAPES[type]?.[length] || SUMMARY_SHAPES["key-points"].short;
  return (
    "The text below is a spelling and literacy lesson written by a teacher, " +
    "containing lesson text, practice questions and spelling word lists. " +
    `Summarise it for another teacher deciding whether the lesson suits their class, as ${shape}. ` +
    "Write the summary in the same language as the lesson. " +
    "Reply with the summary only.\n\n" +
    `Lesson:\n\n${text}`
  );
}

// The model is several files (embedding weights, decoder weights, tokenizer,
// configs); the shared helper sums them into the single 0-1 fraction the UI
// shows, and keeps progress visible to a second summary started during the
// first download (downloadProgress.js).
const { reportProgress, withProgress } = createDownloadProgress();

// One model per page, shared by every summary. Only a successful load is
// memoised: a cached rejection would disable summaries for the rest of the
// session, with no way back but a reload.
let modelPromise = null;

function loadModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const [processor, model] = await Promise.all([
        AutoProcessor.from_pretrained(MODEL_ID, {
          progress_callback: reportProgress,
        }),
        // The ForCausalLM class on a multimodal repo is what selects
        // transformers.js's text-only session set; q4f16 is the quantisation
        // the model card demos, and it needs the WebGPU f16 support that
        // summarizer.js probes for before offering this engine.
        Gemma4ForCausalLM.from_pretrained(MODEL_ID, {
          dtype: "q4f16",
          device: "webgpu",
          progress_callback: reportProgress,
        }),
      ]);
      return { processor, model };
    })().catch((err) => {
      modelPromise = null;
      throw err;
    });
  }
  return modelPromise;
}

// One generation at a time: the ONNX sessions are shared module state, and two
// interleaved generate() calls would corrupt each other's KV cache. The UI
// aborts the previous run before starting a new one, so waiting here is only
// ever for an interrupted run to notice its stop signal.
let generationTurn = Promise.resolve();

// Bridge model.generate()'s callback-based streamer to the async iterable the
// summary card consumes (the same shape the built-in API's
// summarizeStreaming() returns).
async function* generateStream({ processor, model, stopper, prompt, signal }) {
  const chat = processor.apply_chat_template(
    [{ role: "user", content: [{ type: "text", text: prompt }] }],
    { add_generation_prompt: true, enable_thinking: false },
  );
  const inputs = await processor(chat, null, null, {
    add_special_tokens: false,
  });

  const queue = [];
  let wake = null;
  let finished = false;
  let failure = null;
  const settle = () => {
    wake?.();
    wake = null;
  };

  const streamer = new TextStreamer(processor.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (chunk) => {
      queue.push(chunk);
      settle();
    },
  });

  // Generation only checks its stopping criteria between tokens, so an abort
  // interrupts it there; the loop below then throws the AbortError.
  const onAbort = () => {
    stopper.interrupt();
    settle();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const run = (generationTurn = generationTurn
    .catch(() => {})
    .then(() => {
      if (signal?.aborted) return null;
      return model.generate({
        ...inputs,
        max_new_tokens: MAX_NEW_TOKENS,
        do_sample: false,
        streamer,
        stopping_criteria: stopper,
      });
    }))
    .then(() => {
      finished = true;
      settle();
    })
    .catch((err) => {
      failure = err;
      finished = true;
      settle();
    });

  try {
    for (;;) {
      while (queue.length) yield queue.shift();
      if (signal?.aborted) {
        throw new DOMException("Summary aborted.", "AbortError");
      }
      if (finished) {
        if (failure) throw failure;
        return;
      }
      await new Promise((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    stopper.interrupt();
    await run;
  }
}

/**
 * Create a summariser session backed by Gemma 4 running in the page. Same
 * shape as a built-in Summarizer session as far as summarizer.js and the
 * summary card use one: summarizeStreaming(), inputQuota, measureInputUsage()
 * and destroy(), plus `engine` so the UI can say which model wrote the
 * summary. The first call downloads the model (about 3 GB, one time, cached
 * by the browser afterwards).
 *
 * destroy() stops the session's generation; the loaded model itself stays
 * cached for the page's lifetime, like the translation pipelines, because
 * reloading 3 GB of weights per summary would make Regenerate unusable.
 *
 * @param {{type?: string, length?: string}} options
 * @param {object} [hooks]
 * @param {AbortSignal} [hooks.signal]  Checked before the download starts,
 *   once the model is loaded, and between generated tokens; a download
 *   already in flight can't be interrupted.
 * @param {(loaded: number) => void} [hooks.onDownloadProgress]  0-1 fraction.
 */
export async function createFallbackSummarizer(options = {}, hooks = {}) {
  const { signal, onDownloadProgress } = hooks;
  // Before loadModel(): a run aborted while the chunk was being fetched must
  // never start the 3 GB download, because once started it runs to the end.
  if (signal?.aborted) {
    throw new DOMException("Summary aborted.", "AbortError");
  }
  const loaded = await withProgress(onDownloadProgress, loadModel);
  if (signal?.aborted) {
    throw new DOMException("Summary aborted.", "AbortError");
  }

  const { processor, model } = loaded;
  const stopper = new InterruptableStoppingCriteria();

  return {
    engine: "gemma",
    inputQuota: INPUT_QUOTA_TOKENS,

    // In tokens, the unit inputQuota is in. Measures the lesson text alone;
    // the prompt around it is a fixed hundred-odd tokens that the quota's
    // headroom absorbs.
    async measureInputUsage(text) {
      const { input_ids } = processor.tokenizer(text || "");
      return input_ids.dims.at(-1);
    },

    summarizeStreaming(text, { signal: runSignal } = {}) {
      stopper.reset();
      return generateStream({
        processor,
        model,
        stopper,
        prompt: summaryPrompt(options, text),
        signal: runSignal,
      });
    },

    destroy() {
      stopper.interrupt();
    },
  };
}
