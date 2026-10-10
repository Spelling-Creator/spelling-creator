// Structure through a three-way merge: which section each block ends up in.

import { describe, expect, it } from "vitest";
import { applyResolutions, mergeDocs } from "./merge.js";

const block = (id, text = id) => ({ id, type: "text", text });

function lesson(sections) {
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
function layout(doc) {
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

describe("merging a picture from before credits had their own field", () => {
  const picture = (fields) => ({
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
