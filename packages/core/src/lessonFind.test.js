import { describe, expect, it } from "vitest";

import {
  findInLesson,
  findRanges,
  findTerms,
  lessonFindEntries,
} from "./lessonFind.js";

const doc = {
  title: "Volcanoes",
  sections: [
    {
      id: "s1",
      name: "What a volcano is",
      blocks: [
        { id: "h1", type: "heading", text: "Fire mountains" },
        {
          id: "t1",
          type: "text",
          text: "A VOLCANO is an opening in the Earth's crust.\nHot rock, gas and ash escape through it.",
        },
        {
          id: "t2",
          type: "text",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Mount " },
                  { type: "text", text: "Etna", marks: [{ type: "italic" }] },
                  { type: "text", text: " rises " },
                  {
                    type: "math",
                    attrs: { format: "asciimath", source: "3357 m" },
                  },
                  { type: "text", text: " above Sicily." },
                ],
              },
            ],
          },
        },
        {
          id: "img",
          type: "image",
          caption: "Etna at night",
          credit: "Wikimedia",
        },
        {
          id: "sp",
          type: "spelling",
          words: [
            { id: "w1", text: "crater" },
            { id: "w2", text: "magma" },
          ],
        },
        {
          id: "q1",
          type: "question",
          questionType: "single",
          prompt: "What escapes through a volcano?",
          answer: "Ash",
        },
        {
          id: "q2",
          type: "question",
          questionType: "number",
          prompt: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "How tall is Etna?" }],
              },
            ],
          },
          answer: "3357",
          steps: [{ id: "st", text: "Read the height from the passage" }],
        },
        {
          id: "v",
          type: "vakt",
          text: "Feel a pumice stone",
          links: [
            { id: "l1", label: "Pumice video", url: "https://example.com" },
          ],
        },
      ],
    },
    {
      id: "s2",
      name: "",
      blocks: [{ id: "t3", type: "text", text: "Pompeii was buried in ash." }],
    },
  ],
};

describe("lessonFindEntries", () => {
  it("lists every place words can be, in reading order", () => {
    const entries = lessonFindEntries(doc);
    expect(entries.map((e) => [e.kind, e.blockId, e.number])).toEqual([
      ["section", null, null],
      ["heading", "h1", null],
      ["text", "t1", 1],
      ["text", "t2", 2],
      ["image", "img", null],
      ["spelling", "sp", null],
      ["question", "q1", 1],
      ["question", "q2", 2],
      ["vakt", "v", null],
      ["text", "t3", 1],
    ]);
  });

  it("reads formatted text, formulas and inline prompts as their words", () => {
    const byId = new Map(lessonFindEntries(doc).map((e) => [e.blockId, e]));
    expect(byId.get("t1").text).toBe(
      "A VOLCANO is an opening in the Earth's crust. Hot rock, gas and ash escape through it.",
    );
    expect(byId.get("t2").text).toBe("Mount Etna rises 3357 m above Sicily.");
    expect(byId.get("q2").text).toBe(
      "How tall is Etna? 3357 Read the height from the passage",
    );
    expect(byId.get("sp").text).toBe("crater magma");
    expect(byId.get("v").text).toBe("Feel a pumice stone Pumice video");
  });

  it("indexes a picture's caption but not its credit", () => {
    const image = lessonFindEntries(doc).find((e) => e.kind === "image");
    expect(image.text).toBe("Etna at night");
  });

  it("skips a section with no name and blocks with nothing in them", () => {
    const entries = lessonFindEntries({
      sections: [
        { id: "s", name: "  ", blocks: [{ id: "t", type: "text", text: "" }] },
      ],
    });
    expect(entries).toEqual([]);
  });

  it("carries the section the entry is in", () => {
    const last = lessonFindEntries(doc).at(-1);
    expect(last).toMatchObject({
      sectionId: "s2",
      sectionIndex: 1,
      sectionName: "",
    });
  });
});

describe("findTerms", () => {
  it("splits on whitespace and keeps everything else", () => {
    expect(findTerms('  hot  rock\t"ash" ')).toEqual(["hot", "rock", '"ash"']);
    expect(findTerms("")).toEqual([]);
  });
});

describe("findRanges", () => {
  it("matches any part of a word, ignoring case", () => {
    expect(findRanges("A VOLCANO is hot", ["olc"])).toEqual([[3, 6]]);
  });

  it("ignores accents in the text and in the query", () => {
    expect(findRanges("Café in Zürich", ["cafe"])).toEqual([[0, 4]]);
    expect(findRanges("Cafe in Zurich", ["zür"])).toEqual([[8, 11]]);
  });

  it("maps a match back through a letter that folds to two", () => {
    expect(findRanges("İstanbul", ["ist"])).toEqual([[0, 3]]);
  });

  it("needs every term, and marks every occurrence of each", () => {
    expect(findRanges("ash and gas and ash", ["ash", "gas"])).toEqual([
      [0, 3],
      [8, 11],
      [16, 19],
    ]);
    expect(findRanges("ash and gas", ["ash", "lava"])).toBeNull();
  });

  it("merges overlapping matches", () => {
    expect(findRanges("volcanoes", ["volcano", "canoes"])).toEqual([[0, 9]]);
  });

  it("matches nothing for no terms", () => {
    expect(findRanges("anything", [])).toBeNull();
    expect(findRanges("anything", ["́"])).toBeNull();
  });
});

describe("findInLesson", () => {
  it("returns the matching entries with their matches marked", () => {
    const results = findInLesson(doc, "etna");
    expect(results.map((r) => r.blockId)).toEqual(["t2", "img", "q2"]);
    expect(results[0].ranges).toEqual([[6, 10]]);
    expect(results[0].snippet).toEqual({
      parts: [
        { text: "Mount ", hit: false },
        { text: "Etna", hit: true },
        { text: " rises 3357 m above Sicily.", hit: false },
      ],
      clippedStart: false,
      clippedEnd: false,
    });
  });

  it("finds a section by its name", () => {
    expect(findInLesson(doc, "what a").map((r) => r.kind)).toEqual([
      "section",
      "question",
    ]);
  });

  it("needs every word of the query in the same block", () => {
    expect(findInLesson(doc, "ash pompeii").map((r) => r.blockId)).toEqual([
      "t3",
    ]);
  });

  it("matches nothing for an empty query", () => {
    expect(findInLesson(doc, "   ")).toEqual([]);
  });

  it("takes entries built earlier", () => {
    const entries = lessonFindEntries(doc);
    expect(findInLesson(doc, "crater", entries)[0].blockId).toBe("sp");
  });

  it("clips a long entry to a window around the first match", () => {
    const long = {
      sections: [
        {
          id: "s",
          name: "",
          blocks: [
            {
              id: "t",
              type: "text",
              text: `${"word ".repeat(30)}needle here ${"word ".repeat(40)}`,
            },
          ],
        },
      ],
    };
    const [result] = findInLesson(long, "needle");
    const { parts, clippedStart, clippedEnd } = result.snippet;
    expect(clippedStart).toBe(true);
    expect(clippedEnd).toBe(true);
    const shown = parts.map((p) => p.text).join("");
    expect(shown.startsWith("word ")).toBe(true);
    expect(shown.endsWith(" word")).toBe(true);
    expect(shown.length).toBeLessThanOrEqual(150);
    expect(parts.find((p) => p.hit).text).toBe("needle");
  });
});
