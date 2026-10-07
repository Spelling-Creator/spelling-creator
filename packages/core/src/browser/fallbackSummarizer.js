// The summarisation fallback, for browsers without the built-in Summarizer
// API: Liquid AI's LFM2.5 (1.2B, instruction-tuned) running in the page with
// transformers.js, on WebGPU.
//
// The weights are about 760 MB at q4f16, a quarter of the Gemma 4 E2B model
// this replaced. That is still a big download, which is why summarizer.js only
// reports the fallback as available on WebGPU hardware that can actually run
// it, and why the UI warns about the download before the click.
// lesson-summaries.md has the other models tried and how each did.
//
// Licence: the LFM Open License v1.0, free to use for anyone under $10M a year
// in revenue. Readers' browsers fetch the weights straight from Hugging Face,
// so the app never redistributes them itself.
//
// This module is HEAVY: transformers.js pulls in an ONNX runtime on top of the
// model download above. transformers.js caches the model in the browser's
// Cache Storage, so later runs load from disk. Nothing may static-import this
// file: it is reached only through the dynamic import() in summarizer.js,
// which keeps it in its own chunk that only a click on Summarise ever fetches.
// vite.config.js additionally stubs it out of the Worker's SSR build, where it
// could never run anyway.
//
// Model: https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-ONNX

import {
  AutoModelForCausalLM,
  AutoTokenizer,
  InterruptableStoppingCriteria,
  TextStreamer,
} from "@huggingface/transformers";
import { languageDisplayName } from "../translationLanguages.js";
import { createDownloadProgress } from "./downloadProgress.js";

// Pinned to a commit, so a later push to the repo can't change what readers
// download without someone here choosing to move the pin.
const MODEL_ID = "LiquidAI/LFM2.5-1.2B-Instruct-ONNX";
const MODEL_REVISION = "10f72e70abf67ac0fd7ebf15bc5854726891d864";

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
    short: "exactly 3 markdown bullet points, one short sentence each",
    medium: "exactly 5 markdown bullet points, one short sentence each",
    long: "exactly 7 markdown bullet points, one short sentence each",
  },
  tldr: {
    short: "one sentence",
    medium: "three sentences in one paragraph",
    long: "five sentences in one paragraph",
  },
  teaser: {
    short: "one sentence that makes a teacher curious about the lesson",
    medium:
      "three sentences in one paragraph that make a teacher curious about the lesson",
    long: "five sentences in one paragraph that make a teacher curious about the lesson",
  },
  headline: {
    short: "one headline of at most 12 words",
    medium: "one headline of at most 17 words",
    long: "one headline of at most 22 words",
  },
};

// The languages LFM2.5 is trained to write, from its model card. Asked for
// anything else it writes badly: told to answer a Danish lesson in the
// lesson's language, it wrote garbled German.
const LFM_LANGUAGES = ["en", "ar", "zh", "fr", "de", "ja", "ko", "es"];

// Which language the summary is written in, as a sentence for the prompt.
// summarizer.js passes the lesson's language when the browser could detect it
// (a bare tag like "es"). Without one (Firefox and Safari have no
// LanguageDetector) the summary is in English. Letting the model judge doesn't
// work: asked to write in the lesson's language only if it is one of the
// languages above, it wrote English for Spanish and German lessons too, and
// asked to name a lesson's language, it said English for all of them.
function summaryLanguageInstruction(language) {
  const tag = LFM_LANGUAGES.includes(language) ? language : "en";
  return `Write the summary in ${languageDisplayName(tag, "en")}.`;
}

// The same framing the built-in engine gets as sharedContext (summarizer.js),
// for the same reason: without it, a lesson full of question prompts and word
// lists reads like a worksheet to fill in rather than a lesson to describe.
// Small models need it spelled out more firmly than the built-in engine does.
// Left to themselves they answer the lesson's questions ("What surprised me
// most was..."), so the system message forbids that. They also lose track of
// an instruction that sits before three thousand tokens of lesson, so the
// shape is repeated after it, where the model reads it last.
function summaryMessages({ type, length }, languageInstruction, text) {
  const shape =
    SUMMARY_SHAPES[type]?.[length] || SUMMARY_SHAPES["key-points"].short;
  return [
    {
      role: "system",
      content:
        "You summarise spelling and literacy lessons for teachers who are " +
        "deciding whether a lesson suits their class. A lesson has reading " +
        "passages, practice questions and spelling word lists. Describe what " +
        "the lesson covers. Never answer its questions, never do its " +
        "exercises, and never write as a student. " +
        languageInstruction +
        " Reply with the summary only.",
    },
    {
      role: "user",
      content:
        `<lesson>\n${text}\n</lesson>\n\n` +
        `Summarise the lesson above for a teacher, as ${shape}.`,
    },
  ];
}

// The model is several files (the weights, tokenizer, configs); the shared
// helper sums them into the single 0-1 fraction the UI shows, and keeps
// progress visible to a second summary started during the first download
// (downloadProgress.js).
const { reportProgress, withProgress } = createDownloadProgress();

// One model per page, shared by every summary. Only a successful load is
// memoised: a cached rejection would disable summaries for the rest of the
// session, with no way back but a reload.
let modelPromise = null;

function loadModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const [tokenizer, model] = await Promise.all([
        AutoTokenizer.from_pretrained(MODEL_ID, {
          revision: MODEL_REVISION,
          progress_callback: reportProgress,
        }),
        // q4f16 keeps the download smallest, and it needs the WebGPU f16
        // support that summarizer.js probes for before offering this engine.
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

// One generation at a time: the ONNX sessions are shared module state, and two
// interleaved generate() calls would corrupt each other's KV cache. The UI
// aborts the previous run before starting a new one, so waiting here is only
// ever for an interrupted run to notice its stop signal.
let generationTurn = Promise.resolve();

// Bridge model.generate()'s callback-based streamer to the async iterable the
// summary card consumes (the same shape the built-in API's
// summarizeStreaming() returns).
async function* generateStream({
  tokenizer,
  model,
  stopper,
  messages,
  signal,
}) {
  const inputs = tokenizer.apply_chat_template(messages, {
    add_generation_prompt: true,
  });

  const queue = [];
  let wake = null;
  let finished = false;
  let failure = null;
  const settle = () => {
    wake?.();
    wake = null;
  };

  const streamer = new TextStreamer(tokenizer, {
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
        // Greedy, with the light repetition penalty Liquid recommends for this
        // model: without it a small model can loop on the same bullet.
        do_sample: false,
        repetition_penalty: 1.05,
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
 * Create a summariser session backed by LFM2.5 running in the page. Same
 * shape as a built-in Summarizer session as far as summarizer.js and the
 * summary card use one: summarizeStreaming(), inputQuota, measureInputUsage()
 * and destroy(), plus `engine` so the UI can say which model wrote the
 * summary. The first call downloads the model (about 760 MB, one time, cached
 * by the browser afterwards).
 *
 * destroy() stops the session's generation; the loaded model itself stays
 * cached for the page's lifetime, like the translation pipelines, because
 * reloading 760 MB of weights per summary would make Regenerate unusable.
 *
 * @param {{type?: string, length?: string, language?: string|null}} options
 *   language is the lesson's detected language as a bare tag, or null when
 *   the browser couldn't tell, which means English (see
 *   summaryLanguageInstruction).
 * @param {object} [hooks]
 * @param {AbortSignal} [hooks.signal]  Checked before the download starts,
 *   once the model is loaded, and between generated tokens; a download
 *   already in flight can't be interrupted.
 * @param {(loaded: number) => void} [hooks.onDownloadProgress]  0-1 fraction.
 */
export async function createFallbackSummarizer(options = {}, hooks = {}) {
  const { signal, onDownloadProgress } = hooks;
  // Before loadModel(): a run aborted while the chunk was being fetched must
  // never start the 760 MB download, because once started it runs to the end.
  if (signal?.aborted) {
    throw new DOMException("Summary aborted.", "AbortError");
  }
  const loaded = await withProgress(onDownloadProgress, loadModel);
  if (signal?.aborted) {
    throw new DOMException("Summary aborted.", "AbortError");
  }

  const { tokenizer, model } = loaded;
  const stopper = new InterruptableStoppingCriteria();
  const languageInstruction = summaryLanguageInstruction(options.language);

  return {
    engine: "lfm",
    inputQuota: INPUT_QUOTA_TOKENS,

    // In tokens, the unit inputQuota is in. Measures the lesson text alone;
    // the prompt around it is a fixed hundred-odd tokens that the quota's
    // headroom absorbs.
    async measureInputUsage(text) {
      const { input_ids } = tokenizer(text || "");
      return input_ids.dims.at(-1);
    },

    summarizeStreaming(text, { signal: runSignal } = {}) {
      stopper.reset();
      return generateStream({
        tokenizer,
        model,
        stopper,
        messages: summaryMessages(options, languageInstruction, text),
        signal: runSignal,
      });
    },

    destroy() {
      stopper.interrupt();
    },
  };
}
