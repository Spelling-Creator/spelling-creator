// The languages comment translation can work with, and the two names each one
// goes by. The browser's Translator / LanguageDetector APIs speak BCP-47 tags
// ("es"), and so does the fallback's XLM-RoBERTa detector, whose labels are
// bare two-letter codes. The NLLB fallback model instead addresses languages
// by FLORES-200 code ("spa_Latn"), an ISO 639-3 code plus a script.
//
// This table is the one place the two are tied together. It is a subset of
// what NLLB-200 can actually translate (200 languages): the widely used ones.
// Adding a language is adding a row. Note that a row only makes a language a
// possible *source* when a detector can name it: the browser's LanguageDetector
// covers the table, the fallback detector classifies twenty of these languages
// (see fallbackTranslator.js).

export const TRANSLATION_LANGUAGES = [
  { tag: "ar", flores: "arb_Arab" },
  { tag: "bg", flores: "bul_Cyrl" },
  { tag: "bn", flores: "ben_Beng" },
  { tag: "ca", flores: "cat_Latn" },
  { tag: "cs", flores: "ces_Latn" },
  { tag: "da", flores: "dan_Latn" },
  { tag: "de", flores: "deu_Latn" },
  { tag: "el", flores: "ell_Grek" },
  { tag: "en", flores: "eng_Latn" },
  { tag: "es", flores: "spa_Latn" },
  { tag: "fa", flores: "pes_Arab" },
  { tag: "fi", flores: "fin_Latn" },
  { tag: "fr", flores: "fra_Latn" },
  { tag: "he", flores: "heb_Hebr" },
  { tag: "hi", flores: "hin_Deva" },
  { tag: "hr", flores: "hrv_Latn" },
  { tag: "hu", flores: "hun_Latn" },
  { tag: "id", flores: "ind_Latn" },
  { tag: "it", flores: "ita_Latn" },
  { tag: "ja", flores: "jpn_Jpan" },
  { tag: "ko", flores: "kor_Hang" },
  { tag: "lt", flores: "lit_Latn" },
  { tag: "ms", flores: "zsm_Latn" },
  { tag: "nl", flores: "nld_Latn" },
  // "no" folds into Bokmål: it's what NLLB models.
  { tag: "nb", flores: "nob_Latn", aliases: ["no"] },
  { tag: "pl", flores: "pol_Latn" },
  { tag: "pt", flores: "por_Latn" },
  { tag: "ro", flores: "ron_Latn" },
  { tag: "ru", flores: "rus_Cyrl" },
  { tag: "sk", flores: "slk_Latn" },
  { tag: "sl", flores: "slv_Latn" },
  { tag: "sr", flores: "srp_Cyrl" },
  { tag: "sv", flores: "swe_Latn" },
  { tag: "sw", flores: "swh_Latn" },
  { tag: "ta", flores: "tam_Taml" },
  { tag: "te", flores: "tel_Telu" },
  { tag: "th", flores: "tha_Thai" },
  { tag: "tr", flores: "tur_Latn" },
  { tag: "uk", flores: "ukr_Cyrl" },
  { tag: "ur", flores: "urd_Arab" },
  { tag: "vi", flores: "vie_Latn" },
  // Traditional Chinese first so the full-tag lookups below can find it; a bare
  // "zh" resolves to the Simplified row.
  { tag: "zh-Hant", flores: "zho_Hant", aliases: ["zh-tw", "zh-hk", "zh-mo"] },
  { tag: "zh", flores: "zho_Hans" },
];

const byTag = new Map();
for (const language of TRANSLATION_LANGUAGES) {
  byTag.set(language.tag.toLowerCase(), language);
  for (const alias of language.aliases || []) byTag.set(alias, language);
}

/**
 * The bare language subtag of a BCP-47 tag, lowercased: "es-MX" and "es_MX"
 * are both "es". Empty for a missing tag.
 *
 * @param {string} tag
 * @returns {string}
 */
export function baseLanguageTag(tag) {
  return (tag || "").trim().toLowerCase().split(/[-_]/)[0];
}

/**
 * The table row for a BCP-47 tag, or null if translation doesn't cover it.
 * Tries the whole tag first ("zh-TW" is its own row), then the bare language
 * subtag, so "pt-BR" lands on "pt".
 *
 * @param {string} tag
 */
export function languageForTag(tag) {
  const lower = (tag || "").trim().toLowerCase();
  if (!lower) return null;
  return byTag.get(lower) || byTag.get(baseLanguageTag(lower)) || null;
}

/**
 * Do two BCP-47 tags name the same language, as far as translation cares?
 * "en-GB" and "en-US" are the same (translating between them is a no-op), but
 * "zh" and "zh-TW" are not, because they resolve to different rows (scripts).
 */
export function sameTranslationLanguage(a, b) {
  const langA = languageForTag(a);
  const langB = languageForTag(b);
  if (langA && langB) return langA === langB;
  // Neither (or one) is in the table: fall back to comparing bare subtags, so
  // "already in your language" still works for languages we can't translate.
  const baseA = baseLanguageTag(a);
  const baseB = baseLanguageTag(b);
  return Boolean(baseA) && baseA === baseB;
}

/**
 * The languages a reader can pick as a comment's source when detection gets it
 * wrong or can't decide: every row of the table except the reader's own
 * language, since translating into itself does nothing. As BCP-47 tags, in
 * table order; the UI sorts them by display name.
 *
 * @param {string} targetLanguage  BCP-47, the reader's language.
 * @returns {string[]}
 */
export function sourceLanguageChoices(targetLanguage) {
  return TRANSLATION_LANGUAGES.map((language) => language.tag).filter(
    (tag) => !sameTranslationLanguage(tag, targetLanguage),
  );
}

/**
 * "es" as "Spanish", named in the reader's own language. Intl carries the
 * names, so no locale file is involved; the bare tag is the fallback when
 * Intl doesn't know the tag or the platform lacks DisplayNames.
 *
 * @param {string} tag  BCP-47, the language to name.
 * @param {string} displayLanguage  BCP-47, the language to name it in.
 * @returns {string}
 */
export function languageDisplayName(tag, displayLanguage) {
  try {
    return (
      new Intl.DisplayNames([displayLanguage], { type: "language" }).of(tag) ||
      tag
    );
  } catch {
    return tag;
  }
}
