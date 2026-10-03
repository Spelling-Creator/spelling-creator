// Covers the lesson-level fields a .json lesson file carries alongside its
// sections: what Export JSON writes, and what Import JSON keeps when it reads
// the file back.

import { describe, expect, it } from "vitest";

import { normalizeLessonFile } from "./jsonImport.js";
import { buildLessonFile } from "./lessonFile.js";

const sections = [
  {
    id: "s1",
    name: "What Is a Penguin?",
    blocks: [{ id: "b1", type: "text", text: "Penguins are AQUATIC birds." }],
  },
];

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
