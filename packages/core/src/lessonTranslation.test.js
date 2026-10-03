// What lesson translation covers, and just as deliberately what it skips:
// spelling words and VAKT link labels stay in the lesson's own language (the
// module comment says why).

import { describe, expect, it } from "vitest";

import {
  lessonLanguageSample,
  lessonSegmentKey,
  lessonTranslationBatches,
  questionStepsWithText,
  sameTranslationSource,
} from "./lessonTranslation.js";

const doc = {
  title: "Volcanoes",
  sections: [
    {
      id: "a",
      blocks: [
        { id: "t1", type: "text", text: "Magma rises.\n\nIt cools into rock." },
        {
          id: "i1",
          type: "image",
          src: "x.png",
          caption: "Image by Someone via Wikimedia Commons",
        },
        {
          id: "q1",
          type: "question",
          questionType: "number",
          prompt: "How hot is lava?",
          answer: "700-1200 C",
          steps: [
            { id: "s1", text: "Find the number in the text." },
            { id: "s2", text: "   " },
            { id: "s3", text: "Say it in degrees." },
          ],
        },
        {
          id: "sp1",
          type: "spelling",
          words: [
            { id: "w1", text: "pumice" },
            { id: "w2", text: "basalt" },
          ],
        },
      ],
    },
    {
      id: "b",
      blocks: [
        {
          id: "v1",
          type: "vakt",
          text: "VAKT: Squeeze a stress ball like cooling magma.",
          links: [{ id: "l1", label: "Video", url: "https://example.com" }],
        },
      ],
    },
    { id: "c", blocks: [{ id: "t2", type: "text", text: "  \n " }] },
  ],
};

describe("lessonTranslationBatches", () => {
  it("batches the title alone, then one batch per section with text", () => {
    const batches = lessonTranslationBatches(doc);
    expect(batches).toEqual([
      [{ key: "title", text: "Volcanoes" }],
      [
        { key: "s0.b0.line0", text: "Magma rises." },
        { key: "s0.b0.line2", text: "It cools into rock." },
        {
          key: "s0.b1.caption",
          text: "Image by Someone via Wikimedia Commons",
        },
        { key: "s0.b2.prompt", text: "How hot is lava?" },
        { key: "s0.b2.answer0", text: "700-1200 C" },
        { key: "s0.b2.step0", text: "Find the number in the text." },
        { key: "s0.b2.step1", text: "Say it in degrees." },
      ],
      [
        {
          key: "s1.b0.vakt",
          text: "Squeeze a stress ball like cooling magma.",
        },
      ],
    ]);
  });

  it("never emits spelling words or link labels", () => {
    const texts = lessonTranslationBatches(doc)
      .flat()
      .map((s) => s.text);
    for (const kept of ["pumice", "basalt", "Video"]) {
      expect(texts.join("\n")).not.toContain(kept);
    }
  });

  it("gives each accepted answer of a multiple question its own segment", () => {
    const batches = lessonTranslationBatches({
      title: "",
      sections: [
        {
          id: "m",
          blocks: [
            {
              id: "q",
              type: "question",
              questionType: "multiple",
              prompt: "Name a volcanic rock.",
              answers: [
                { id: "a1", text: "basalt" },
                { id: "a2", text: "  " },
                { id: "a3", text: "pumice" },
              ],
            },
          ],
        },
      ],
    });
    expect(batches).toEqual([
      [
        { key: "s0.b0.prompt", text: "Name a volcanic rock." },
        { key: "s0.b0.answer0", text: "basalt" },
        { key: "s0.b0.answer1", text: "pumice" },
      ],
    ]);
  });

  it("skips the caption of an image block with nothing to draw", () => {
    const batches = lessonTranslationBatches({
      title: "",
      sections: [
        {
          id: "s",
          blocks: [{ id: "i", type: "image", caption: "A sourceless image" }],
        },
      ],
    });
    expect(batches).toEqual([]);
  });

  it("handles an empty or blank document", () => {
    expect(lessonTranslationBatches(null)).toEqual([]);
    expect(lessonTranslationBatches({ title: " ", sections: [] })).toEqual([]);
  });
});

describe("questionStepsWithText", () => {
  it("keeps only steps with text, in order, matching the renderer's filter", () => {
    const block = doc.sections[0].blocks[2];
    expect(questionStepsWithText(block).map((s) => s.id)).toEqual(["s1", "s3"]);
    expect(questionStepsWithText({})).toEqual([]);
  });
});

describe("lessonSegmentKey", () => {
  it("gives every slot a distinct key", () => {
    const keys = [
      lessonSegmentKey.title(),
      lessonSegmentKey.textLine(0, 1, 2),
      lessonSegmentKey.prompt(0, 1),
      lessonSegmentKey.step(0, 1, 2),
      lessonSegmentKey.vakt(0, 1),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("sameTranslationSource", () => {
  it("holds across a re-fetch that rebuilds the same lesson", () => {
    // What the lesson page does for a signed-in reader: the same lesson comes
    // back as a brand-new object, so a reader's translation must survive it.
    const refetched = JSON.parse(JSON.stringify(doc));
    expect(
      sameTranslationSource(
        lessonTranslationBatches(doc),
        lessonTranslationBatches(refetched),
      ),
    ).toBe(true);
  });

  it("rejects text that changed under the same keys", () => {
    const edited = JSON.parse(JSON.stringify(doc));
    edited.sections[0].blocks[0].text = "Magma rises.\n\nIt cools into glass.";
    expect(
      sameTranslationSource(
        lessonTranslationBatches(doc),
        lessonTranslationBatches(edited),
      ),
    ).toBe(false);
  });

  it("rejects a document with segments added or removed", () => {
    const shorter = JSON.parse(JSON.stringify(doc));
    // The VAKT section, the one whose removal actually drops a segment: the
    // last section is blank and never contributed one.
    shorter.sections.splice(1, 1);
    expect(
      sameTranslationSource(
        lessonTranslationBatches(doc),
        lessonTranslationBatches(shorter),
      ),
    ).toBe(false);
  });

  it("treats the same array, and two empty ones, as unchanged", () => {
    const batches = lessonTranslationBatches(doc);
    expect(sameTranslationSource(batches, batches)).toBe(true);
    expect(sameTranslationSource([], [])).toBe(true);
    expect(sameTranslationSource(null, [])).toBe(true);
  });
});

describe("lessonLanguageSample", () => {
  it("reads from the top and stops once it has enough", () => {
    const batches = lessonTranslationBatches(doc);
    expect(lessonLanguageSample(batches, { maxChars: 10 })).toBe("Volcanoes");
    expect(lessonLanguageSample(batches)).toContain("cooling magma");
  });

  it("returns everything when the lesson is short of the cap", () => {
    expect(lessonLanguageSample([[{ key: "title", text: "Hi" }]])).toBe("Hi");
    expect(lessonLanguageSample([])).toBe("");
  });
});
