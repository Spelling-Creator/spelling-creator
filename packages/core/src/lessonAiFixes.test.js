// The shared half of an AI fix: what the model is shown, how its edits become
// operations, and the check that decides whether a fix is offered at all.

import { describe, expect, it } from "vitest";
import { validateLesson } from "./lessonChecks.js";
import {
  aiEditsToOperations,
  applyFixOperations,
  checkFix,
  fixContext,
  hasAiFix,
} from "./lessonAiFixes.js";
import {
  markupToContent,
  textBlockMarkup,
  withTextBlockContent,
} from "./lessonText.js";

const text = (id, markup) =>
  withTextBlockContent({ id, type: "text" }, markupToContent(markup));
const question = (id, questionType, fields) => ({
  id,
  type: "question",
  questionType,
  ...fields,
});

function lesson() {
  return {
    title: "Rivers",
    sources: [{ id: "smith", title: "Rivers of the World" }],
    sections: [
      {
        id: "s1",
        name: "Rivers",
        blocks: [
          text(
            "t1",
            "A river carries SEDIMENT down to the sea.^[@smith, p. 4] It drops boulder, cobble, and silt.",
          ),
          {
            id: "img",
            type: "image",
            image: { hash: "abc", mime: "image/png", ext: "png" },
          },
          {
            id: "sp1",
            type: "spelling",
            words: [
              { id: "w1", text: "stream" },
              { id: "w2", text: "valley" },
            ],
          },
          question("q1", "single", {
            prompt: "What does a river carry down to the sea?",
            answer: "gravel",
          }),
          question("q2", "multiple", {
            prompt: "It drops ______. Name one.",
            answers: [
              { id: "a1", text: "boulder" },
              { id: "a2", text: "cobble" },
              { id: "a3", text: "silt" },
            ],
          }),
        ],
      },
      {
        id: "s2",
        name: "Seas",
        blocks: [
          text("t2", "The sea is deep and salty."),
          {
            id: "sp2",
            type: "spelling",
            words: [{ id: "w3", text: "harbour" }],
          },
          question("q3", "single", {
            prompt: "What is the sea?",
            answer: "salty",
          }),
          question("q4", "multiple_open", {
            prompt: "Give a word for small stones.",
            answers: [{ id: "a4", text: "pebble" }],
          }),
        ],
      },
    ],
  };
}

const grounding = (doc) =>
  validateLesson(doc).errors.find(
    (f) => f.code === "E_GROUNDING_SINGLE" && f.blockId === "q1",
  );

describe("hasAiFix", () => {
  it("covers judgement calls about one section, and nothing a script fixes", () => {
    expect(hasAiFix({ code: "E_GROUNDING_SINGLE", sectionId: "s1" })).toBe(
      true,
    );
    expect(hasAiFix({ code: "E_GROUNDING_SINGLE", sectionId: null })).toBe(
      false,
    );
    expect(hasAiFix({ code: "W_FORMAT_BOLD", sectionId: "s1" })).toBe(false);
    expect(hasAiFix({ code: "W_SECTION_COUNT", sectionId: null })).toBe(false);
  });
});

describe("fixContext", () => {
  it("shows the section as markup and lists words used elsewhere", () => {
    const context = fixContext(lesson(), grounding(lesson()));
    expect(context.sectionNumber).toBe(1);
    expect(context.blocks[0]).toEqual({
      id: "t1",
      type: "text",
      text: "A river carries SEDIMENT down to the sea.^[@smith, p. 4] It drops boulder, cobble, and silt.",
      editable: true,
    });
    expect(context.blocks[1]).toEqual({
      id: "img",
      type: "image",
      editable: false,
    });
    expect(context.blocks[4].answers).toEqual(["boulder", "cobble", "silt"]);
    // q4's "pebble" is missing on purpose: a loose orange question's answers
    // are suggestions, held to nothing by the checks, so forbidding them would
    // steer the model away from words that would pass.
    expect(context.usedElsewhere.sort()).toEqual(["harbour", "salty"]);
  });

  it("is null once the section is gone", () => {
    expect(fixContext(lesson(), { sectionId: "gone" })).toBeNull();
  });
});

describe("aiEditsToOperations", () => {
  const finding = { sectionId: "s1" };

  it("keeps whatever an edit leaves empty", () => {
    const ops = aiEditsToOperations(lesson(), finding, [
      { blockId: "q1", prompt: "", answer: "sediment", answers: [], steps: [] },
    ]);
    expect(ops).toEqual([
      {
        op: "replace_block",
        blockId: "q1",
        block: {
          type: "question",
          questionType: "single",
          prompt: "What does a river carry down to the sea?",
          answer: "sediment",
        },
      },
    ]);
  });

  it("moves the answer into the list when the type changes to orange", () => {
    const [op] = aiEditsToOperations(lesson(), finding, [
      { blockId: "q1", questionType: "multiple_open" },
    ]);
    expect(op.block).toMatchObject({
      questionType: "multiple_open",
      answers: ["gravel"],
    });
  });

  it("refuses blocks outside the section and blocks a fix may not touch", () => {
    expect(() =>
      aiEditsToOperations(lesson(), finding, [
        { blockId: "q3", answer: "deep" },
      ]),
    ).toThrow(/isn't in this section/);
    expect(() =>
      aiEditsToOperations(lesson(), finding, [{ blockId: "img", text: "x" }]),
    ).toThrow(/can't be changed/);
  });

  it("refuses a fix that changes nothing", () => {
    expect(() =>
      aiEditsToOperations(lesson(), finding, [
        { blockId: "q1", answer: "gravel" },
      ]),
    ).toThrow(/doesn't change anything/);
  });
});

describe("applyFixOperations", () => {
  it("keeps untouched sections, blocks and list item ids", () => {
    const doc = lesson();
    const fixed = applyFixOperations(doc, [
      {
        op: "replace_block",
        blockId: "sp1",
        block: { type: "spelling", words: ["stream", "canyon"] },
      },
    ]);
    expect(fixed.sections[1]).toBe(doc.sections[1]);
    expect(fixed.sections[0].blocks[0]).toBe(doc.sections[0].blocks[0]);
    const words = fixed.sections[0].blocks[2].words;
    expect(words[0]).toEqual({ id: "w1", text: "stream" });
    expect(words[1].text).toBe("canyon");
    expect(words[1].id).not.toBe("w2");
  });

  it("stores a changed text block as a document, the way the editor does", () => {
    const fixed = applyFixOperations(lesson(), [
      {
        op: "replace_block",
        blockId: "t1",
        block: { type: "text", text: "Plain now." },
      },
    ]);
    expect(fixed.sections[0].blocks[0].content?.type).toBe("doc");
    expect(fixed.sections[0].blocks[0].text).toBeUndefined();
  });

  it("refuses anything but replacing blocks", () => {
    expect(() =>
      applyFixOperations(lesson(), [{ op: "remove_block", blockId: "q1" }]),
    ).toThrow(/only replace blocks/);
  });
});

describe("checkFix", () => {
  it("passes a fix that clears the finding and adds nothing", () => {
    const doc = lesson();
    const finding = grounding(doc);
    const ops = aiEditsToOperations(doc, finding, [
      { blockId: "q1", answer: "sediment" },
    ]);
    const result = checkFix(doc, ops, finding);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.doc.sections[0].blocks[3].answer).toBe("sediment");
  });

  it("fails a fix that leaves the finding in place", () => {
    const doc = lesson();
    const finding = grounding(doc);
    const ops = aiEditsToOperations(doc, finding, [
      { blockId: "q1", prompt: "What does a river carry?" },
    ]);
    const result = checkFix(doc, ops, finding);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/still there/);
  });

  it("fails a fix that causes a problem of its own", () => {
    const doc = lesson();
    const finding = grounding(doc);
    // SILT is already the orange question's answer.
    const ops = aiEditsToOperations(doc, finding, [
      { blockId: "q1", answer: "silt" },
    ]);
    const result = checkFix(doc, ops, finding);
    expect(result.ok).toBe(false);
    expect(result.newErrors.map((f) => f.code)).toContain(
      "E_ANSWER_WORD_REUSED",
    );
  });

  it("fails a fix that drops a footnote", () => {
    const doc = lesson();
    const finding = grounding(doc);
    const ops = aiEditsToOperations(doc, finding, [
      {
        blockId: "t1",
        text: "A river carries SEDIMENT and gravel down to the sea. It drops boulder, cobble, and silt.",
      },
    ]);
    const result = checkFix(doc, ops, finding);
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/footnote/);
  });

  it("passes a passage fix that keeps the footnote", () => {
    const doc = lesson();
    const finding = grounding(doc);
    const ops = aiEditsToOperations(doc, finding, [
      {
        blockId: "t1",
        text: "A river carries SEDIMENT and gravel down to the sea.^[@smith, p. 4] It drops boulder, cobble, and silt.",
      },
    ]);
    const result = checkFix(doc, ops, finding);
    expect(result.ok).toBe(true);
    expect(textBlockMarkup(result.doc.sections[0].blocks[0])).toContain(
      "^[@smith, p. 4]",
    );
  });

  it("doesn't blame a fix for a pre-existing formatting defect it re-keyed", () => {
    // The section already breaks the formatting rules: a bold span past the
    // word limit, which is also most of the passage. Both findings' keys are
    // the formatted words themselves.
    const doc = {
      title: "T",
      sections: [
        {
          id: "s1",
          name: "Rivers",
          blocks: [
            text(
              "t1",
              "A river carries SEDIMENT. **The waters never stop moving at all.**",
            ),
            question("q1", "single", {
              prompt: "What does a river carry?",
              answer: "gravel",
            }),
          ],
        },
      ],
    };
    const finding = grounding(doc);
    // The fix grounds the answer by rewording the passage, and the bold span's
    // words change with it, so every formatting finding gets a new key.
    const ops = aiEditsToOperations(doc, finding, [
      {
        blockId: "t1",
        text: "A river carries SEDIMENT and gravel. **The waters never once stop moving.**",
      },
    ]);
    const result = checkFix(doc, ops, finding);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    // The re-keyed W_FORMAT_BOLD isn't reported as a new suggestion either.
    expect(result.newWarnings).toEqual([]);
    // A caller that already validated the lesson can hand the result in and
    // gets the same verdict without a second pass over the unchanged doc.
    const primed = checkFix(doc, ops, finding, {
      before: validateLesson(doc),
    });
    expect(primed.ok).toBe(true);
    expect(primed.problems).toEqual([]);
  });

  it("still fails a fix that swaps one ungrounded answer for another", () => {
    // Grounding keys change when the answer changes, and that must stay a
    // failure: the re-key allowance is for formatting findings alone.
    const doc = lesson();
    const finding = grounding(doc);
    const ops = aiEditsToOperations(doc, finding, [
      { blockId: "q1", answer: "pebbles" },
    ]);
    const result = checkFix(doc, ops, finding);
    expect(result.ok).toBe(false);
    expect(result.newErrors.map((f) => f.code)).toContain("E_GROUNDING_SINGLE");
  });
});
