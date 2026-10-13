// The natural voice's text to IPA, with the Node build of the same espeak-ng
// the browser runs, so the phonemes checked here are the ones Kokoro is given.

import { beforeAll, describe, expect, it } from "vitest";
import { createEspeak } from "@spelling-creator/spellophone/node";

import { kokoroIpa, phonemize, phonemizeSpoken } from "./readAloudText.js";

let espeak;
beforeAll(async () => {
  espeak = await createEspeak({ languages: ["en"] });
});

describe("kokoroIpa", () => {
  it("swaps the ASCII people type for the symbols Kokoro knows", () => {
    expect(kokoroIpa("'bu:i")).toBe("ˈbuːi");
    expect(kokoroIpa("ˈgɑrdən")).toBe("ˈɡɑɹdən");
  });
});

describe("phonemizeSpoken", () => {
  it("reads plain words the way phonemize does", () => {
    expect(phonemizeSpoken(espeak, ["A lighthouse."], "a")).toBe(
      phonemize(espeak, "A lighthouse.", "a"),
    );
  });

  it("puts a pronunciation in as written, between the words around it", () => {
    const ipa = phonemizeSpoken(
      espeak,
      ["Augustin ", { text: "FRESNEL", ipa: "freɪˈnɛl" }, " described it."],
      "a",
    );
    expect(ipa).toContain(" fɹeɪˈnɛl ");
    expect(ipa).not.toContain("fɹˈɛznəl");
    expect(ipa.endsWith(".")).toBe(true);
  });

  it("says an alias in place of its text", () => {
    expect(
      phonemizeSpoken(espeak, [{ text: "WWF", alias: "World Wide Fund" }], "a"),
    ).toBe(phonemize(espeak, "World Wide Fund", "a"));
  });

  it("spells a word out one letter at a time, with a pause between", () => {
    expect(
      phonemizeSpoken(espeak, [{ text: "REEF", sayAs: "characters" }], "a"),
    ).toBe("ˈɑːɹ, ˈiː, ˈiː, ˈɛf");
  });

  it("makes a short pause a comma, without doubling one already there", () => {
    expect(
      phonemizeSpoken(espeak, ["Ready", { pause: "short" }, " go"], "a"),
    ).toMatch(/^\S+, \S+$/);
    expect(
      phonemizeSpoken(espeak, ["Ready,", { pause: "short" }, " go"], "a"),
    ).not.toContain(",,");
  });
});
