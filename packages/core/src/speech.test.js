import { describe, expect, it } from "vitest";

import {
  chunkSpeech,
  hasFormulaSpeech,
  normalizeSpokenText,
  speechLines,
  speechText,
  spellOut,
  spokenForBrowser,
  spokenWords,
  textBlockSpeech,
  withFormulaSpeech,
} from "./speech.js";

const block = (...paragraphs) => ({
  type: "text",
  content: {
    type: "doc",
    content: paragraphs.map((content) => ({ type: "paragraph", content })),
  },
});
const text = (t, speech) =>
  speech
    ? { type: "text", text: t, marks: [{ type: "speech", attrs: speech }] }
    : { type: "text", text: t };

describe("normalizeSpokenText", () => {
  it("reads a string and the format's runs, and joins neighbouring words", () => {
    expect(
      normalizeSpokenText([
        "60 divided by ",
        "5",
        { pause: "short" },
        { text: "buoy", ipa: "ˈbuːi" },
        { text: "WWF", alias: "World Wide Fund" },
        { text: "REEF", sayAs: "characters" },
      ]),
    ).toEqual([
      "60 divided by 5",
      { pause: "short" },
      { text: "buoy", ipa: "ˈbuːi" },
      { text: "WWF", alias: "World Wide Fund" },
      { text: "REEF", sayAs: "characters" },
    ]);
    expect(normalizeSpokenText("one\ntwo")).toEqual(["one two"]);
  });

  it("says an unknown run's text and skips one without any", () => {
    expect(
      normalizeSpokenText([
        "a ",
        { text: "b", emphasis: "strong" },
        { audio: "https://example.org/x.mp3" },
        { pause: "forever" },
      ]),
    ).toEqual(["a b"]);
  });
});

describe("a text block as spoken text", () => {
  it("gives each paragraph's runs, without footnotes, skipping empty ones", () => {
    const lines = textBlockSpeech(
      block(
        [
          text("Augustin "),
          text("Fresnel", { ipa: "freɪˈnɛl" }),
          { type: "footnote", attrs: { note: "A note." } },
          text(" described it."),
        ],
        [],
        [text("Wait"), { type: "pause", attrs: { length: "long" } }],
      ),
    );
    expect(lines).toEqual([
      ["Augustin ", { text: "Fresnel", ipa: "freɪˈnɛl" }, " described it."],
      ["Wait", { pause: "long" }],
    ]);
    expect(speechText(lines)).toBe("Augustin Fresnel described it.\nWait");
  });
});

describe("spokenForBrowser", () => {
  it("says aliases, spells words out, and reads pronunciations as written", () => {
    expect(
      spokenForBrowser([
        "The ",
        { text: "WWF", alias: "World Wide Fund" },
        " spelled ",
        { text: "REEF", sayAs: "characters" },
        { pause: "short" },
        " by ",
        { text: "Fresnel", ipa: "freɪˈnɛl" },
        ".",
      ]),
    ).toBe("The World Wide Fund spelled R, E, E, F, by Fresnel.");
  });

  it("doesn't stack a pause onto punctuation", () => {
    expect(spokenForBrowser(["One,", { pause: "short" }, " two"])).toBe(
      "One, two",
    );
  });
});

describe("spellOut", () => {
  it("separates the characters and drops spaces", () => {
    expect(spellOut("RE EF")).toBe("R, E, E, F");
  });
});

describe("chunkSpeech", () => {
  it("keeps a short line whole, and accepts a plain string", () => {
    expect(chunkSpeech("Lions\nA lion roars.")).toEqual([
      { runs: ["Lions"], pauseAfter: false },
      { runs: ["A lion roars."], pauseAfter: false },
    ]);
  });

  it("cuts at a long pause and marks the chunk before it", () => {
    expect(
      chunkSpeech([["Ready", { pause: "long" }, "go!", { pause: "long" }]]),
    ).toEqual([
      { runs: ["Ready"], pauseAfter: true },
      { runs: ["go!"], pauseAfter: true },
    ]);
  });

  it("splits a long line by sentence and never splits a hint", () => {
    const sentence = "word ".repeat(30).trim();
    const chunks = chunkSpeech(
      [
        [
          `${sentence}. `,
          { text: "Fresnel", ipa: "freɪˈnɛl" },
          ` ${sentence}.`,
        ],
      ],
      100,
    );
    const said = chunks.map((chunk) => spokenWords(chunk.runs));
    expect(said.every((s) => s.length <= 100)).toBe(true);
    expect(said.join(" ")).toBe(`${sentence}. Fresnel ${sentence}.`);
    expect(
      chunks.some((chunk) => chunk.runs.some((run) => run.ipa === "freɪˈnɛl")),
    ).toBe(true);
  });

  it("keeps the space between two hints", () => {
    const [chunk] = chunkSpeech([
      [{ text: "A", sayAs: "characters" }, " ", { text: "B", alias: "bee" }],
    ]);
    expect(spokenWords(chunk.runs)).toBe("A B");
  });

  it("drops lines with nothing to say", () => {
    expect(speechLines(["", "  ", ["x"]])).toEqual([["  "], ["x"]]);
    expect(chunkSpeech(["", "  "])).toEqual([]);
  });
});

describe("formulas in spoken text", () => {
  const formula = { format: "asciimath", source: "3/4" };
  const block = (spoken) => ({
    type: "text",
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Then " },
            { type: "math", attrs: { ...formula, spoken } },
            { type: "text", text: " of them." },
          ],
        },
      ],
    },
  });

  it("says the author's words where there are any, else a formula run", () => {
    expect(textBlockSpeech(block("three quarters"))).toEqual([
      ["Then three quarters of them."],
    ]);
    expect(textBlockSpeech(block(null))).toEqual([
      ["Then ", { text: "3/4", formula }, " of them."],
    ]);
    // A formula run survives normalizing again.
    expect(normalizeSpokenText(["a ", { text: "3/4", formula }])).toEqual([
      "a ",
      { text: "3/4", formula },
    ]);
  });

  it("is read as its source by a voice that gets the run as it is", () => {
    expect(spokenForBrowser(["Then ", { text: "3/4", formula }, "."])).toBe(
      "Then 3/4.",
    );
  });

  it("has its words made once per formula, and keeps the source when that fails", async () => {
    const chunks = chunkSpeech([
      ["Then ", { text: "3/4", formula }, " and ", { text: "3/4", formula }],
      [{ text: "x^2", formula: { format: "tex", source: "x^2" } }],
    ]);
    expect(hasFormulaSpeech(chunks)).toBe(true);
    const asked = [];
    const said = await withFormulaSpeech(chunks, async ({ source }) => {
      asked.push(source);
      if (source === "x^2") throw new Error("no");
      return "three quarters";
    });
    expect(asked).toEqual(["3/4", "x^2"]);
    expect(said[0].runs).toEqual([
      "Then ",
      { text: "3/4", alias: "three quarters" },
      " and ",
      { text: "3/4", alias: "three quarters" },
    ]);
    expect(said[1].runs).toEqual([
      { text: "x^2", formula: { format: "tex", source: "x^2" } },
    ]);
    expect(hasFormulaSpeech(chunkSpeech("no math here"))).toBe(false);
  });
});
