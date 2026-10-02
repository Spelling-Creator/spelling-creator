import { describe, expect, it } from "vitest";

import { OPUS_MT_TO_ENGLISH, opusMtModelFor } from "./opusMtModels.js";
import { languageForTag } from "./translationLanguages.js";

describe("Opus-MT model table", () => {
  it("keys every model by a canonical table tag", () => {
    // A key that isn't a canonical tag could never match: opusMtModelFor looks
    // rows up through languageForTag and indexes by the row's own tag.
    for (const tag of Object.keys(OPUS_MT_TO_ENGLISH)) {
      expect(languageForTag(tag)?.tag, tag).toBe(tag);
    }
  });

  it("only names into-English models", () => {
    // The conservative rule this table encodes: Opus-MT translates into
    // English only, everything else is NLLB's.
    expect(OPUS_MT_TO_ENGLISH.en).toBeUndefined();
    for (const modelId of Object.values(OPUS_MT_TO_ENGLISH)) {
      expect(modelId).toMatch(/^[\w-]+\/opus-mt-[\w-]+-en$/);
    }
  });
});

describe("opusMtModelFor", () => {
  it("finds the model for a covered pair", () => {
    expect(opusMtModelFor("de", "en")).toBe("Xenova/opus-mt-de-en");
  });

  it("resolves regional tags on both sides", () => {
    expect(opusMtModelFor("de-AT", "en-GB")).toBe("Xenova/opus-mt-de-en");
  });

  it("is null for any target but English", () => {
    expect(opusMtModelFor("de", "fr")).toBeNull();
    expect(opusMtModelFor("en", "de")).toBeNull();
  });

  it("keeps Traditional Chinese on NLLB", () => {
    // opus-mt-zh-en was trained mostly on Simplified text; zh-TW resolves to
    // the zh-Hant row, which the table deliberately leaves out.
    expect(opusMtModelFor("zh", "en")).toBe("Xenova/opus-mt-zh-en");
    expect(opusMtModelFor("zh-TW", "en")).toBeNull();
  });

  it("is null for sources without a model", () => {
    // Greek is in the language table but has no Opus-MT conversion; Klingon
    // is outside the table entirely.
    expect(opusMtModelFor("el", "en")).toBeNull();
    expect(opusMtModelFor("tlh", "en")).toBeNull();
  });
});
