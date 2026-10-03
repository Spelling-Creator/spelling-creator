// The translation fallback's fast path: Helsinki-NLP's Opus-MT, one small
// model per language pair, converted for transformers.js. A pair model is a
// ~110-140 MB download at q8 against NLLB's ~600 MB, so when one covers the
// request it wins; NLLB stays the catch-all for every other pair.
//
// Deliberately X -> English only. Into-English is both the best-covered
// direction on the hub and the one the 2020-era Opus-MT models are reliably
// good at; out of English and between other languages their coverage is
// patchy and their quality varies too much, so those pairs stay on NLLB.
// Keys are canonical table tags from translationLanguages.js, which is why
// "zh" (Simplified) is here but "zh-Hant" is not: opus-mt-zh-en was trained
// mostly on Simplified text, while NLLB models zho_Hant in its own right.
//
// Every id below was checked against the Hugging Face hub for the exact files
// transformers.js fetches at dtype "q8" (onnx/encoder_model_quantized.onnx,
// onnx/decoder_model_merged_quantized.onnx, tokenizer.json, config.json).
// The Xenova org carries all of these pairs with proper q8 files at roughly
// half the size of the onnx-community conversions, several of which ship no
// quantised files at all.
//
// Files existing is not enough, though. The hub conversions approximate
// Marian's SentencePiece tokenizer with a tokenizer.json whose scores don't
// always reproduce the original segmentation (transformers.js warns as much
// when it loads one), and a Marian model fed a segmentation it never saw in
// training can output anything at all. Danish was the worst case: the
// converted tokenizer split "prinsessen" differently from the model's own
// source.spm, and the model answered with chained profanity and repetition
// loops where the upstream Helsinki-NLP checkpoint translates the same
// sentences cleanly. Czech and Dutch failed the same comparison on core
// vocabulary (both orgs' conversions share the defect, so there is no better
// id to swap in), which is why da, cs and nl are absent below and ride NLLB
// instead. So adding a pair means verifying the files exist AND comparing the
// converted tokenizer's ids against the Python MarianTokenizer on a few
// sentences, then spot-checking translations against the upstream model.

import { languageForTag } from "./translationLanguages.js";

export const OPUS_MT_TO_ENGLISH = {
  ar: "Xenova/opus-mt-ar-en",
  de: "Xenova/opus-mt-de-en",
  es: "Xenova/opus-mt-es-en",
  fi: "Xenova/opus-mt-fi-en",
  fr: "Xenova/opus-mt-fr-en",
  hi: "Xenova/opus-mt-hi-en",
  hu: "Xenova/opus-mt-hu-en",
  id: "Xenova/opus-mt-id-en",
  it: "Xenova/opus-mt-it-en",
  ja: "Xenova/opus-mt-ja-en",
  ko: "Xenova/opus-mt-ko-en",
  pl: "Xenova/opus-mt-pl-en",
  ru: "Xenova/opus-mt-ru-en",
  sv: "Xenova/opus-mt-sv-en",
  th: "Xenova/opus-mt-th-en",
  tr: "Xenova/opus-mt-tr-en",
  uk: "Xenova/opus-mt-uk-en",
  vi: "Xenova/opus-mt-vi-en",
  zh: "Xenova/opus-mt-zh-en",
};

/**
 * The Opus-MT model id covering sourceLanguage -> targetLanguage, or null when
 * the pair is NLLB's to handle. Tags resolve through the language table first,
 * so "de-AT" finds the German model and "en-GB" counts as English, while
 * "zh-TW" resolves to the zh-Hant row and correctly misses the
 * Simplified-trained zh model.
 *
 * @param {string} sourceLanguage  BCP-47.
 * @param {string} targetLanguage  BCP-47.
 * @returns {string|null}
 */
export function opusMtModelFor(sourceLanguage, targetLanguage) {
  if (languageForTag(targetLanguage)?.tag !== "en") return null;
  const source = languageForTag(sourceLanguage);
  return (source && OPUS_MT_TO_ENGLISH[source.tag]) || null;
}
