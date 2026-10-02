// The translation fallback, for browsers whose built-in Translator API is
// missing or can't do the language pair: translation models running in the
// page with transformers.js. Two kinds of model share the work:
//
//   - Opus-MT: one small per-pair model, for the into-English pairs listed in
//     opusMtModels.js. A ~110-140 MB one-time download.
//   - NLLB-200 (distilled, 600M): every other pair. A ~600 MB one-time
//     download, but one download covers the whole language table in both
//     directions.
//
// An XLM-RoBERTa language-detection model rides along as the fallback
// detector (another ~280 MB), for the same browsers that lack the
// LanguageDetector API.
//
// This module is HEAVY: transformers.js pulls in an ONNX runtime on top of
// the quantised model downloads above. transformers.js caches the models in
// the browser's Cache Storage, so later runs load from disk. Nothing may
// static-import this file: it is reached only through the dynamic import() in
// translator.js, which keeps it in its own chunk that only a click on
// Translate ever fetches. vite.config.js additionally stubs it out of the
// Worker's SSR build, where it could never run anyway.
//
// Models:
//   https://huggingface.co/Xenova/opus-mt-de-en and friends (opusMtModels.js)
//   https://huggingface.co/Xenova/nllb-200-distilled-600M
//   https://huggingface.co/onnx-community/xlm-roberta-base-language-detection-ONNX
//     (papluca/xlm-roberta-base-language-detection converted for transformers.js;
//     classifies 20 widely used languages, labelled with the same two-letter
//     codes translationLanguages.js keys on)

import { pipeline } from "@huggingface/transformers";
import { opusMtModelFor } from "../opusMtModels.js";
import { languageForTag } from "../translationLanguages.js";

const NLLB_MODEL_ID = "Xenova/nllb-200-distilled-600M";
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
// the UI shows. Several models can download through here, so entries are keyed
// per model AND per file. Files announce their totals as they start, which can
// make the fraction dip when a new large file joins the denominator; harmless,
// and truthful.
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

// One pipeline per model per page, shared by every translation; different
// pairs may want different translation models (opusMtModelFor decides), so
// the memo is keyed by model id. Only a successful load is memoised: a cached
// rejection would disable translation for the rest of the session, with no
// way back but a reload.
const pipelinePromises = new Map();

function getPipeline(task, modelId) {
  let promise = pipelinePromises.get(modelId);
  if (!promise) {
    // q8 quarters the download against fp32 and quality holds up; it's the
    // same quantisation the model cards demo.
    promise = pipeline(task, modelId, {
      dtype: "q8",
      progress_callback: reportProgress,
    }).catch((err) => {
      pipelinePromises.delete(modelId);
      throw err;
    });
    pipelinePromises.set(modelId, promise);
  }
  return promise;
}

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
 * call downloads the detection model; a one-time cost, like the translators'.
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
    const detector = await getPipeline(
      "text-classification",
      DETECTION_MODEL_ID,
    );
    if (signal?.aborted) {
      throw new DOMException("Detection aborted.", "AbortError");
    }
    const [best] = await detector(text || "");
    if (!best || best.score < MIN_DETECTION_SCORE) return null;
    return languageForTag(best.label)?.tag || null;
  });
}

/**
 * Translate text blocks with an in-page model: the pair's Opus-MT model when
 * opusMtModels.js lists one (into English only), NLLB for everything else.
 * Same contract as translator.js's translateBlocks, minus the "browser"
 * engine.
 *
 * @param {string[]} blocks
 * @param {object} options
 * @param {string} options.sourceLanguage  BCP-47; must be in the table.
 * @param {string} options.targetLanguage  BCP-47; must be in the table.
 * @param {AbortSignal} [options.signal]  Checked between blocks; a single
 *   block's generation can't be interrupted mid-way.
 * @param {(loaded: number) => void} [options.onDownloadProgress]
 * @returns {Promise<{blocks: string[], engine: "opus-mt"|"nllb"}>}
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

  // An Opus-MT model is single-pair, so it takes no language options; NLLB is
  // multilingual and addresses languages by FLORES-200 code.
  const opusModelId = opusMtModelFor(sourceLanguage, targetLanguage);
  const translationOptions = opusModelId
    ? {}
    : { src_lang: source.flores, tgt_lang: target.flores };

  return withProgress(onDownloadProgress, async () => {
    const translator = await getPipeline(
      "translation",
      opusModelId || NLLB_MODEL_ID,
    );
    const out = [];
    for (const block of blocks) {
      if (signal?.aborted) {
        throw new DOMException("Translation aborted.", "AbortError");
      }
      const [result] = await translator(block, translationOptions);
      out.push(result.translation_text);
    }
    return { blocks: out, engine: opusModelId ? "opus-mt" : "nllb" };
  });
}
