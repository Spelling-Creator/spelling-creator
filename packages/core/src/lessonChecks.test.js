// What the editor needs from a finding on top of the MCP server's prose: where
// it is (sectionId, blockId) and its facts as data (params). The rules
// themselves are tested against a full standard lesson in
// apps/mcp/test/validate.test.js; this covers the fields that suite never reads.

import { describe, expect, it } from "vitest";
import { validateLesson } from "./lessonChecks.js";

const question = (id, questionType, fields) => ({
  id,
  type: "question",
  questionType,
  ...fields,
});

function lesson() {
  return {
    title: "Rivers",
    sources: [],
    sections: [
      {
        id: "s1",
        name: "Rivers",
        blocks: [
          {
            id: "t1",
            type: "text",
            text: "A river carries SEDIMENT down to the sea. It drops boulder, cobble, and silt.",
          },
          { id: "sp1", type: "spelling", words: [{ id: "w1", text: "ash" }] },
          question("q1", "single", {
            prompt: "What does a river carry?",
            answer: "gravel",
          }),
          question("q2", "multiple", {
            prompt: "It drops ______. Name one.",
            answers: [
              { id: "a1", text: "boulder" },
              { id: "a2", text: "cobble" },
            ],
          }),
        ],
      },
      {
        id: "s2",
        name: "Seas",
        blocks: [
          { id: "t2", type: "text", text: "The sea is deep." },
          question("q3", "number", { prompt: "How deep?", answer: "12" }),
          question("q4", "number", { prompt: "How wide?", answer: "12" }),
        ],
      },
    ],
  };
}

const find = (findings, code) => findings.find((f) => f.code === code);

describe("validateLesson finding locations", () => {
  const { errors, warnings } = validateLesson(lesson());

  it("points a question's finding at that question", () => {
    expect(find(errors, "E_GROUNDING_SINGLE")).toMatchObject({
      section: 1,
      sectionId: "s1",
      blockId: "q1",
      params: { question: 1, answer: "gravel" },
    });
  });

  it("points a spelling word's finding at its spelling block", () => {
    expect(find(errors, "E_SPELLING_LENGTH")).toMatchObject({
      sectionId: "s1",
      blockId: "sp1",
      params: { word: "ash", letters: 3 },
    });
  });

  it("names the other side of a lesson-wide collision", () => {
    expect(find(errors, "E_NUMBER_DUPLICATE")).toMatchObject({
      sectionId: "s2",
      blockId: "q4",
      params: {
        answer: "12",
        question: 2,
        otherSection: 2,
        otherQuestion: 1,
      },
    });
  });

  it("carries the item a partial list left out, as the passage wrote it", () => {
    expect(find(errors, "E_ORANGE_PARTIAL_LIST")).toMatchObject({
      blockId: "q2",
      params: { question: 2, next: "silt" },
    });
  });

  it("points a spelling word's finding at that word, even when repeated", () => {
    const doc = lesson();
    doc.sections[0].blocks.push({
      id: "sp2",
      type: "spelling",
      words: [{ id: "w9", text: "ash" }],
    });
    const found = validateLesson(doc).errors.filter(
      (f) => f.code === "E_SPELLING_LENGTH",
    );
    expect(found.map((f) => [f.blockId, f.itemId])).toEqual([
      ["sp1", "w1"],
      ["sp2", "w9"],
    ]);
  });

  it("says which limit a heavily formatted section broke", () => {
    const doc = lesson();
    doc.sections[0].blocks[0] = {
      id: "t1",
      type: "text",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "A river carries " },
              {
                type: "text",
                text: "SEDIMENT down",
                marks: [{ type: "italic" }],
              },
              {
                type: "text",
                text: " to the sea. It drops boulder, cobble, and silt.",
              },
            ],
          },
        ],
      },
    };
    const heavy = validateLesson(doc).errors.find(
      (f) => f.code === "E_FORMAT_HEAVY",
    );
    expect(heavy?.params).toMatchObject({ count: 1, tooMany: false });
  });

  it("leaves lesson-wide findings without a section", () => {
    expect(find(warnings, "W_SECTION_COUNT")).toMatchObject({
      section: null,
      sectionId: null,
      blockId: null,
      params: { count: 2, expected: 6 },
    });
  });

  it("gives every finding the same fields", () => {
    for (const f of [...errors, ...warnings]) {
      expect(f).toHaveProperty("sectionId");
      expect(f).toHaveProperty("blockId");
      expect(typeof f.params).toBe("object");
    }
  });
});
