// Covers the lesson-level fields a .json lesson file carries alongside its
// sections: what Export JSON writes, and what Import JSON keeps when it reads
// the file back.

import { describe, expect, it } from "vitest";

import { normalizeLessonFile } from "./jsonImport.ts";
import { buildLessonFile } from "./lessonFile.ts";
import type { QuestionBlock, Section, Source, TextBlock } from "./types.ts";

const sections: Section[] = [
  {
    id: "s1",
    name: "What Is a Penguin?",
    blocks: [{ id: "b1", type: "text", text: "Penguins are AQUATIC birds." }],
  },
];

describe("three-board questions in a lesson file", () => {
  const multiple = (fields: Record<string, unknown>) => ({
    id: "q1",
    type: "question",
    questionType: "multiple",
    prompt: "Name one.",
    answers: [
      { id: "a1", text: "ROCKS" },
      { id: "a2", text: "REEFS" },
    ],
    ...fields,
  });
  const read = (block: unknown) =>
    normalizeLessonFile({
      title: "T",
      sections: [{ id: "s1", name: "S", blocks: [block] }],
    }).sections[0].blocks[0] as QuestionBlock;

  it("keeps the three-board mark and a Besides answer the list has", () => {
    const block = read(multiple({ threeBoard: true, besides: "reefs" }));
    expect(block.threeBoard).toBe(true);
    // Spelled the way the answer list spells it.
    expect(block.besides).toBe("REEFS");
  });

  it("drops a Besides answer the list no longer has, and both from other types", () => {
    expect("besides" in read(multiple({ besides: "GRAVEL" }))).toBe(false);
    const loose = read(
      multiple({
        questionType: "multiple_open",
        threeBoard: true,
        besides: "ROCKS",
      }),
    );
    expect("threeBoard" in loose).toBe(false);
    expect("besides" in loose).toBe(false);
  });
});

describe("heading blocks in a lesson file", () => {
  const read = (block: unknown) =>
    normalizeLessonFile({
      title: "T",
      sections: [
        {
          id: "s1",
          name: "S",
          blocks: [{ id: "b1", type: "text", text: "Prose." }, block],
        },
      ],
    }).sections[0].blocks;

  it("keeps a heading's text, trimmed", () => {
    expect(
      read({ id: "h1", type: "heading", text: " WOULD YOU RATHER " }),
    ).toEqual([
      { id: "b1", type: "text", text: "Prose." },
      { id: "h1", type: "heading", text: "WOULD YOU RATHER" },
    ]);
  });

  it("drops an empty heading", () => {
    expect(read({ id: "h1", type: "heading", text: "  " })).toHaveLength(1);
  });
});

describe("lesson file age range", () => {
  it("survives an export and import round trip", () => {
    const file = buildLessonFile({
      title: "Penguins",
      ageRange: "11-14 years",
      sections,
    });
    expect(file.doc.ageRange).toBe("11-14 years");
    expect(normalizeLessonFile(file).ageRange).toBe("11-14 years");
  });

  it("is read from a bare doc too, like the hub's own lesson JSON", () => {
    const doc = normalizeLessonFile({
      title: "Penguins",
      ageRange: "11-14 years",
      sections,
    });
    expect(doc.ageRange).toBe("11-14 years");
  });

  it("is left off when the lesson has none", () => {
    expect("ageRange" in buildLessonFile({ title: "T", sections }).doc).toBe(
      false,
    );
    expect(
      "ageRange" in normalizeLessonFile({ title: "T", ageRange: "", sections }),
    ).toBe(false);
  });

  it("drops a range the editor has no option for", () => {
    for (const ageRange of ["any", "10-12 years", 12, null]) {
      expect(
        "ageRange" in normalizeLessonFile({ title: "T", ageRange, sections }),
      ).toBe(false);
    }
  });

  it("trims stray whitespace around a known range", () => {
    expect(
      normalizeLessonFile({ title: "T", ageRange: " 5-7 years ", sections })
        .ageRange,
    ).toBe("5-7 years");
  });
});

describe("lesson file trusted collaborators", () => {
  it("are never written to the file", () => {
    const file = buildLessonFile({
      title: "T",
      sections,
      trustedCollaborators: [{ email: "someone@example.com" }],
    });
    expect("trustedCollaborators" in file.doc).toBe(false);
  });
});

describe("lesson file sources and formatted text", () => {
  const content = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Penguins ", marks: [{ type: "bold" }] },
          { type: "text", text: "swim." },
          {
            type: "footnote",
            attrs: { sourceId: "nat", locator: "p. 4", note: "" },
          },
          {
            type: "footnote",
            attrs: { sourceId: "gone", locator: "", note: "" },
          },
          {
            type: "footnote",
            attrs: { sourceId: "gone", locator: "", note: "Kept." },
          },
        ],
      },
    ],
  };
  const file = buildLessonFile({
    title: "Penguins",
    sources: [
      { id: "nat", title: "Penguins of the World", url: "https://example.com" },
      { id: "empty" },
    ] as Source[],
    sections: [
      { id: "s1", name: "One", blocks: [{ id: "b1", type: "text", content }] },
    ],
  });

  it("keeps the sources that say something", () => {
    const doc = normalizeLessonFile(file);
    expect(doc.sources?.map((s) => s.id)).toEqual(["nat"]);
  });

  it("keeps formatting and drops citations of sources the file doesn't list", () => {
    const block = normalizeLessonFile(file).sections[0].blocks[0] as TextBlock;
    expect(block.text).toBeUndefined();
    expect(block.content?.content?.[0].content).toEqual([
      { type: "text", text: "Penguins ", marks: [{ type: "bold" }] },
      { type: "text", text: "swim." },
      {
        type: "footnote",
        attrs: { sourceId: "nat", locator: "p. 4", note: "" },
      },
      {
        type: "footnote",
        attrs: { sourceId: null, locator: "", note: "Kept." },
      },
    ]);
  });

  it("stores unformatted content as plain text", () => {
    const doc = normalizeLessonFile({
      title: "t",
      sections: [
        {
          blocks: [
            {
              type: "text",
              content: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Hi" }],
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(doc.sections[0].blocks[0]).toMatchObject({
      type: "text",
      text: "Hi",
    });
    expect(doc).not.toHaveProperty("sources");
  });
});
