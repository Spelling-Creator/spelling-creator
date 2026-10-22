// The speech rule engine fed its rules from the package on disk, the way the
// browser feeds it from the app's assets: a lesson's kind of formula in the
// words a teacher would say.

import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

import { createFormulaSpeech } from "./formulaSpeech.ts";

const rules = new URL(
  "../../node_modules/speech-rule-engine/lib/mathmaps/",
  import.meta.url,
);
const loaded = [];

let speech;
beforeAll(async () => {
  speech = await createFormulaSpeech({
    loadLocale: (locale) => {
      loaded.push(locale);
      return readFile(new URL(`${locale}.json`, rules), "utf8");
    },
  });
});

describe("createFormulaSpeech", () => {
  it("takes its rules from the loader, base first", () => {
    expect(loaded).toEqual(["base", "en"]);
  });

  it("says a lesson's arithmetic the way a teacher would", () => {
    const say = (mathml) => speech.speak(`<math>${mathml}</math>`);
    expect(say("<mn>120</mn><mo>×</mo><mn>3</mn><mo>=</mo><mn>360</mn>")).toBe(
      "120 times 3 equals 360",
    );
    expect(
      say("<mfrac><mn>60</mn><mn>5</mn></mfrac><mo>=</mo><mn>12</mn>"),
    ).toBe("60 over 5 equals 12");
    expect(say("<msqrt><mn>81</mn></msqrt><mo>=</mo><mn>9</mn>")).toBe(
      "the square root of 81 equals 9",
    );
    expect(say("<msup><mn>10</mn><mn>6</mn></msup>")).toBe(
      "10 to the sixth power",
    );
    expect(say("<mn>48</mn><mo>÷</mo><mn>6</mn>")).toBe("48 divided by 6");
  });
});
