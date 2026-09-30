import { describe, expect, it } from "vitest";

import {
  TRANSLATION_LANGUAGES,
  languageForTag,
  sameTranslationLanguage,
} from "./translationLanguages.js";

// The languages the fallback's XLM-RoBERTa detector classifies (its labels,
// which are also its model card's list). Every one must resolve in the table,
// or a fallback detection would name a source the fallback then can't accept.
const DETECTOR_LABELS =
  "ar bg de el en es fr hi it ja nl pl pt ru sw th tr ur vi zh".split(" ");

describe("translationLanguages table", () => {
  it("has no duplicate tags or aliases", () => {
    // A tag claimed by two rows would make lookups order-dependent: whichever
    // row registered last would win silently.
    const tags = [];
    for (const language of TRANSLATION_LANGUAGES) {
      tags.push(language.tag.toLowerCase(), ...(language.aliases || []));
    }
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("covers every label the fallback detector can answer with", () => {
    for (const label of DETECTOR_LABELS) {
      expect(languageForTag(label), label).not.toBeNull();
    }
  });

  it("uses well-formed FLORES-200 codes", () => {
    for (const language of TRANSLATION_LANGUAGES) {
      expect(language.flores).toMatch(/^[a-z]{3}_[A-Z][a-z]{3}$/);
    }
  });
});

describe("languageForTag", () => {
  it("resolves a bare tag", () => {
    expect(languageForTag("es")?.flores).toBe("spa_Latn");
  });

  it("falls back from a regional tag to its language", () => {
    expect(languageForTag("pt-BR")?.flores).toBe("por_Latn");
    expect(languageForTag("en-GB")?.flores).toBe("eng_Latn");
  });

  it("prefers a full-tag row over the bare-subtag fallback", () => {
    expect(languageForTag("zh-TW")?.flores).toBe("zho_Hant");
    expect(languageForTag("zh")?.flores).toBe("zho_Hans");
  });

  it("is case-insensitive and null for unknowns", () => {
    expect(languageForTag("ES")?.tag).toBe("es");
    expect(languageForTag("tlh")).toBeNull();
    expect(languageForTag("")).toBeNull();
    expect(languageForTag(undefined)).toBeNull();
  });
});

describe("sameTranslationLanguage", () => {
  it("treats regional variants as the same language", () => {
    expect(sameTranslationLanguage("en-US", "en-GB")).toBe(true);
    expect(sameTranslationLanguage("pt", "pt-BR")).toBe(true);
  });

  it("keeps different languages and scripts apart", () => {
    expect(sameTranslationLanguage("es", "en")).toBe(false);
    expect(sameTranslationLanguage("zh", "zh-TW")).toBe(false);
  });

  it("compares bare subtags when a language is outside the table", () => {
    expect(sameTranslationLanguage("cy", "cy-GB")).toBe(true);
    expect(sameTranslationLanguage("cy", "en")).toBe(false);
  });
});
