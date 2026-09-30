// The translation fallback: Meta's NLLB-200 (distilled, 600M) running in the
// page with transformers.js, for browsers whose built-in Translator API is
// missing or can't do the language pair. An XLM-RoBERTa language-detection
// model rides along as the fallback detector, for the same browsers that lack
// the LanguageDetector API.
//
// This module is HEAVY: transformers.js pulls in an ONNX runtime, the quantised
// translation model is a ~600 MB one-time download, and the quantised detector
// another ~280 MB. transformers.js caches both in the browser's Cache Storage,
// so later runs load from disk. Nothing may static-import this file: it is
// reached only through the dynamic import() in translator.js, which keeps it in
// its own chunk that only a click on Translate ever fetches. vite.config.js
// additionally stubs it out of the Worker's SSR build, where it could never run
// anyway.
//
// Models:
//   https://huggingface.co/Xenova/nllb-200-distilled-600M
//   https://huggingface.co/onnx-community/xlm-roberta-base-language-detection-ONNX
//     (papluca/xlm-roberta-base-language-detection converted for transformers.js;
//     classifies 20 widely used languages, labelled with the same two-letter
//     codes translationLanguages.js keys on)

import { pipeline } from "@huggingface/transformers";
import { languageForTag } from "../translationLanguages.js";

const TRANSLATION_MODEL_ID = "Xenova/nllb-200-distilled-600M";
const DETECTION_MODEL_ID =
  "onnx-community/xlm-roberta-base-language-detection-ONNX";

// Below this confidence, the detector's best guess is noise (a very short or
// mixed-language comment, or a language outside its twenty), and translating
// from a wrong source is worse than saying we couldn't tell.
const MIN_DETECTION_SCORE = 0.5;

// Download progress goes through a listener set rather than a callback bound at
// pipeline creation, so a second comment translated during the first download
// still sees progress.
const progressListeners = new Set();

// transformers.js reports per-file progress events, and a model is several
// files (weights, tokenizer, config), so sum them into the single 0–1 fraction
// the UI shows. Two models can download through here, so entries are keyed per
// model AND per file. Files announce their totals as they start, which can make
// the fraction dip when a new large file joins the denominator; harmless, and
// truthful.
const fileProgress = new Map();

function reportProgress(event) {
  if (event.status !== "progress" || !event.total) return;
  fileProgress.set(`${event.name}/${event.file}`, {
    loaded: event.loaded,
    total: event.total,
  });
  let loaded = 0;
  let total = 0;
  for (const file of fileProgress.values()) {
    loaded += file.loaded;
    total += file.total;
  }
  if (!total) return;
  const fraction = Math.min(loaded / total, 1);
  for (const listener of progressListeners) listener(fraction);
}

// One pipeline of each kind per page, shared by every translation. Only a
// successful load is memoised: a cached rejection would disable translation for
// the rest of the session, with no way back but a reload.
function memoisePipeline(task, modelId) {
  let promise = null;
  return () => {
    if (!promise) {
      // q8 quarters the download against fp32 and quality holds up; it's the
      // same quantisation the model cards demo.
      promise = pipeline(task, modelId, {
        dtype: "q8",
        progress_callback: reportProgress,
      }).catch((err) => {
        promise = null;
        throw err;
      });
    }
    return promise;
  };
}

const getTranslator = memoisePipeline("translation", TRANSLATION_MODEL_ID);
const getDetector = memoisePipeline("text-classification", DETECTION_MODEL_ID);

// Subscribe `onDownloadProgress` for the duration of `run`, however it ends.
async function withProgress(onDownloadProgress, run) {
  const listener = onDownloadProgress
    ? (fraction) => onDownloadProgress(fraction)
    : null;
  if (listener) progressListeners.add(listener);
  try {
    return await run();
  } finally {
    if (listener) progressListeners.delete(listener);
  }
}

/**
 * XLM-RoBERTa's guess at the language of `text`, as a BCP-47 tag, or null when
 * it can't tell (low confidence, or a language outside the table). The first
 * call downloads the detection model; a one-time cost, like the translator's.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]  Checked after the model loads; a
 *   single classification can't be interrupted mid-way.
 * @param {(loaded: number) => void} [options.onDownloadProgress]
 * @returns {Promise<string|null>}
 */
export async function detectLanguage(
  text,
  { signal, onDownloadProgress } = {},
) {
  return withProgress(onDownloadProgress, async () => {
    const detector = await getDetector();
    if (signal?.aborted) {
      throw new DOMException("Detection aborted.", "AbortError");
    }
    const [best] = await detector(text || "");
    if (!best || best.score < MIN_DETECTION_SCORE) return null;
    return languageForTag(best.label)?.tag || null;
  });
}

/**
 * Translate text blocks with the NLLB model. Same contract as
 * translator.js's translateBlocks, minus the engine field.
 *
 * @param {string[]} blocks
 * @param {object} options
 * @param {string} options.sourceLanguage  BCP-47; must be in the table.
 * @param {string} options.targetLanguage  BCP-47; must be in the table.
 * @param {AbortSignal} [options.signal]  Checked between blocks; a single
 *   block's generation can't be interrupted mid-way.
 * @param {(loaded: number) => void} [options.onDownloadProgress]
 * @returns {Promise<string[]>}
 */
export async function translateBlocks(blocks, options) {
  const { sourceLanguage, targetLanguage, signal, onDownloadProgress } =
    options;
  const source = languageForTag(sourceLanguage);
  const target = languageForTag(targetLanguage);
  if (!source || !target) {
    // translator.js checks this before loading the chunk; belt and braces.
    const error = new Error("This language isn't supported for translation.");
    error.readerFacing = true;
    throw error;
  }

  return withProgress(onDownloadProgress, async () => {
    const translator = await getTranslator();
    const out = [];
    for (const block of blocks) {
      if (signal?.aborted) {
        throw new DOMException("Translation aborted.", "AbortError");
      }
      const [result] = await translator(block, {
        src_lang: source.flores,
        tgt_lang: target.flores,
      });
      out.push(result.translation_text);
    }
    return out;
  });
}
