// Structure through a three-way merge: which section each block ends up in.

import { describe, expect, it } from "vitest";
import { applyResolutions, mergeDocs } from "./merge.ts";
import type { Block, ImageBlock, LessonDoc } from "../types.ts";

const block = (id: string, text = id): Block => ({ id, type: "text", text });

function lesson(sections: Record<string, Block[]>): LessonDoc {
  return {
    title: "Cats",
    sections: Object.entries(sections).map(([id, blocks]) => ({
      id,
      name: id,
      blocks,
    })),
  };
}

/** Section id -> its block ids, to compare layouts at a glance. */
function layout(doc: LessonDoc) {
  return Object.fromEntries(
    doc.sections.map((section) => [
      section.id,
      section.blocks.map((b) => b.id),
    ]),
  );
}

describe("merging a lesson with several sections", () => {
  const base = lesson({
    s1: [block("a"), block("b")],
    s2: [block("c"), block("d")],
    s3: [block("e")],
  });

  it("keeps every block in its own section", () => {
    const ours = lesson({
      s1: [block("a", "a!"), block("b")],
      s2: [block("c"), block("d")],
      s3: [block("e")],
    });
    const theirs = lesson({
      s1: [block("a"), block("b")],
      s2: [block("c"), block("d", "d!")],
      s3: [block("e"), block("f")],
    });
    const { doc, conflicts } = mergeDocs(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(layout(doc)).toEqual({
      s1: ["a", "b"],
      s2: ["c", "d"],
      s3: ["e", "f"],
    });
  });

  it("follows a block one side moved to another section", () => {
    const ours = lesson({
      s1: [block("a"), block("b")],
      s2: [block("c"), block("d")],
      s3: [block("e")],
    });
    const theirs = lesson({
      s1: [block("a")],
      s2: [block("c"), block("d")],
      s3: [block("e"), block("b")],
    });
    expect(layout(mergeDocs(base, ours, theirs).doc)).toEqual({
      s1: ["a"],
      s2: ["c", "d"],
      s3: ["e", "b"],
    });
    expect(layout(mergeDocs(base, theirs, ours).doc)).toEqual({
      s1: ["a"],
      s2: ["c", "d"],
      s3: ["e", "b"],
    });
  });

  it("puts a block deleted on one side and edited on the other back where it was", () => {
    const ours = lesson({
      s1: [block("a"), block("b")],
      s2: [block("c", "c!"), block("d")],
      s3: [block("e")],
    });
    const theirs = lesson({
      s1: [block("a"), block("b")],
      s2: [block("d")],
      s3: [block("e")],
    });
    for (const [mine, other] of [
      [ours, theirs],
      [theirs, ours],
    ]) {
      const { doc, conflicts } = mergeDocs(base, mine, other);
      expect(conflicts).toHaveLength(1);
      expect(layout(doc)).toEqual({
        s1: ["a", "b"],
        s2: ["c", "d"],
        s3: ["e"],
      });
      const kept = applyResolutions(doc, conflicts, { c: "both" }, () => "x");
      expect(layout(kept).s2).toEqual(["c", "d"]);
    }
  });
});

describe("merging a section one side deleted", () => {
  const one = { id: "s1", name: "One", blocks: [block("a")] };
  const two = { id: "s2", name: "Two", blocks: [block("b")] };
  const base: LessonDoc = { title: "Cats", sections: [one, two] };
  const deleted: LessonDoc = { title: "Cats", sections: [one] };
  const edited: LessonDoc = {
    title: "Cats",
    sections: [one, { ...two, blocks: [block("b", "b!")] }],
  };
  const summary = (doc: LessonDoc) =>
    doc.sections.map((section) => [
      section.name,
      section.blocks.map((b) => b.id),
    ]);

  // Who deleted the section should make no difference to the outcome.
  describe.each([
    { deleter: "ours", mine: deleted, other: edited, keepEdit: "theirs" },
    { deleter: "theirs", mine: edited, other: deleted, keepEdit: "ours" },
  ] as const)("when $deleter deleted it", ({ mine, other, keepEdit }) => {
    const honorDelete = keepEdit === "ours" ? "theirs" : "ours";

    it("keeps its name while the conflict is open", () => {
      const { doc, conflicts } = mergeDocs(base, mine, other);
      expect(conflicts).toHaveLength(1);
      expect(summary(doc)).toEqual([
        ["One", ["a"]],
        ["Two", ["b"]],
      ]);
    });

    it("keeps the named section when the edit wins", () => {
      const { doc, conflicts } = mergeDocs(base, mine, other);
      const out = applyResolutions(doc, conflicts, { b: keepEdit }, () => "x");
      expect(summary(out)).toEqual([
        ["One", ["a"]],
        ["Two", ["b"]],
      ]);
    });

    it("removes the section when the delete wins", () => {
      const { doc, conflicts } = mergeDocs(base, mine, other);
      const out = applyResolutions(
        doc,
        conflicts,
        { b: honorDelete },
        () => "x",
      );
      expect(summary(out)).toEqual([["One", ["a"]]]);
    });
  });

  it("removes it without a question when the other side left it alone", () => {
    for (const [mine, other] of [
      [deleted, base],
      [base, deleted],
    ]) {
      const { doc, conflicts } = mergeDocs(base, mine, other);
      expect(conflicts).toEqual([]);
      expect(summary(doc)).toEqual([["One", ["a"]]]);
    }
  });

  it("keeps it, with the other side's new name, for a block added to it", () => {
    const added: LessonDoc = {
      title: "Cats",
      sections: [one, { ...two, name: "Renamed", blocks: [block("c")] }],
    };
    for (const [mine, other] of [
      [deleted, added],
      [added, deleted],
    ]) {
      const { doc } = mergeDocs(base, mine, other);
      expect(summary(doc)).toEqual([
        ["One", ["a"]],
        ["Renamed", ["c"]],
      ]);
    }
  });

  it("keeps it while a second contested block is kept", () => {
    const two2 = { ...two, blocks: [block("b"), block("c")] };
    const start: LessonDoc = { title: "Cats", sections: [one, two2] };
    const bothEdited: LessonDoc = {
      title: "Cats",
      sections: [one, { ...two, blocks: [block("b", "b!"), block("c", "c!")] }],
    };
    const { doc, conflicts } = mergeDocs(start, deleted, bothEdited);
    const out = applyResolutions(
      doc,
      conflicts,
      { b: "ours", c: "theirs" },
      () => "x",
    );
    expect(summary(out)).toEqual([
      ["One", ["a"]],
      ["Two", ["c"]],
    ]);
  });

  it("leaves alone an empty section both sides still have, or one just added", () => {
    const empty = { id: "s3", name: "Empty", blocks: [] };
    const withEmpty: LessonDoc = { title: "Cats", sections: [one, empty] };
    const start: LessonDoc = { title: "Cats", sections: [one] };
    expect(summary(mergeDocs(withEmpty, withEmpty, withEmpty).doc)).toEqual([
      ["One", ["a"]],
      ["Empty", []],
    ]);
    expect(summary(mergeDocs(start, start, withEmpty).doc)).toEqual([
      ["One", ["a"]],
      ["Empty", []],
    ]);
  });

  it("keeps a section the other side still needs in its place", () => {
    const three = { id: "s3", name: "Three", blocks: [block("c")] };
    const start: LessonDoc = { title: "Cats", sections: [one, two, three] };
    const gone: LessonDoc = { title: "Cats", sections: [one, three] };
    const kept: LessonDoc = {
      title: "Cats",
      sections: [one, { ...two, blocks: [block("b", "b!")] }, three],
    };
    for (const [mine, other] of [
      [gone, kept],
      [kept, gone],
    ]) {
      const { doc } = mergeDocs(start, mine, other);
      expect(doc.sections.map((section) => section.id)).toEqual([
        "s1",
        "s2",
        "s3",
      ]);
    }
  });

  it("keeps the base order of sections each side deleted the other needs", () => {
    const three = { id: "s3", name: "Three", blocks: [block("c")] };
    const start: LessonDoc = { title: "Cats", sections: [one, two, three] };
    // Each side edits the block in one section and deletes the other section.
    const keepsTwo: LessonDoc = {
      title: "Cats",
      sections: [one, { ...two, blocks: [block("b", "b!")] }],
    };
    const keepsThree: LessonDoc = {
      title: "Cats",
      sections: [one, { ...three, blocks: [block("c", "c!")] }],
    };
    for (const [mine, other] of [
      [keepsTwo, keepsThree],
      [keepsThree, keepsTwo],
    ]) {
      const { doc, conflicts } = mergeDocs(start, mine, other);
      expect(conflicts).toHaveLength(2);
      expect(doc.sections.map((section) => section.id)).toEqual([
        "s1",
        "s2",
        "s3",
      ]);
    }
  });

  it("keeps a first section in first place", () => {
    const start: LessonDoc = { title: "Cats", sections: [two, one] };
    const gone: LessonDoc = { title: "Cats", sections: [one] };
    const kept: LessonDoc = {
      title: "Cats",
      sections: [{ ...two, blocks: [block("b", "b!")] }, one],
    };
    const { doc } = mergeDocs(start, gone, kept);
    expect(doc.sections.map((section) => section.id)).toEqual(["s2", "s1"]);
  });

  describe("when the other side renamed it", () => {
    const renamed = (blocks: Block[]): LessonDoc => ({
      title: "Cats",
      sections: [one, { ...two, name: "Vocabulary", blocks }],
    });

    it("keeps the new name, even with no blocks left", () => {
      const other = renamed([block("b")]);
      for (const [mine, theirs] of [
        [deleted, other],
        [other, deleted],
      ]) {
        const { doc, conflicts } = mergeDocs(base, mine, theirs);
        expect(conflicts).toEqual([]);
        expect(summary(doc)).toEqual([
          ["One", ["a"]],
          ["Vocabulary", []],
        ]);
      }
    });

    it("keeps the new name when the delete of its last block wins", () => {
      const { doc, conflicts } = mergeDocs(
        base,
        deleted,
        renamed([block("b", "b!")]),
      );
      const out = applyResolutions(doc, conflicts, { b: "ours" }, () => "x");
      expect(summary(out)).toEqual([
        ["One", ["a"]],
        ["Vocabulary", []],
      ]);
    });
  });

  it("still lets one side clear the age range", () => {
    const aged: LessonDoc = { ...deleted, ageRange: "8-9" };
    expect(mergeDocs(aged, deleted, aged).doc.ageRange).toBeUndefined();
  });
});

describe("merging a picture from before credits had their own field", () => {
  const picture = (fields: Partial<ImageBlock>): ImageBlock => ({
    id: "p",
    type: "image",
    src: "x.png",
    ...fields,
  });

  it("merges a caption edit with a credit fix on the other side", () => {
    const base = lesson({
      s1: [picture({ caption: "A lion. Image by jdoe from Pixabay" })],
    });
    const ours = lesson({
      s1: [
        picture({
          caption: "A big lion.",
          credit: "Image by jdoe from Pixabay",
        }),
      ],
    });
    const theirs = lesson({
      s1: [
        picture({ caption: "A lion.", credit: "Image by jane from Pixabay" }),
      ],
    });
    const { doc, conflicts } = mergeDocs(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(doc.sections[0].blocks[0]).toMatchObject({
      caption: "A big lion.",
      credit: "Image by jane from Pixabay",
    });
  });
});
