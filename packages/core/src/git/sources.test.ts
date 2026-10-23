// A lesson's sources and formatted text blocks, through the version-control
// layer: stored in the manifest, diffed into ops, and merged.

import { describe, expect, it } from "vitest";
import { memRepo } from "./memfs.ts";
import { commitDoc, readDocAt } from "./repo.ts";
import { docManifest } from "./doc.ts";
import { describeOps, diffDocs } from "./ops.ts";
import { applyResolutions, mergeDocs } from "./merge.ts";
import { markupToContent, textBlockPlain } from "../lessonText.ts";
import type { LessonDoc, RichNode, Source, TextBlock } from "../types.ts";

const author = { name: "Test", email: "test@example.com" };

function lesson({
  sources,
  text = "Words",
  content,
}: {
  // As the editor may hold them, half typed.
  sources?: Partial<Source>[];
  text?: string;
  content?: RichNode;
} = {}): LessonDoc {
  const block: TextBlock = content
    ? { id: "b1", type: "text", content }
    : { id: "b1", type: "text", text };
  return {
    title: "Cats",
    ...(sources ? { sources: sources as Source[] } : {}),
    sections: [{ id: "s1", name: "One", blocks: [block] }],
  };
}

const smith = {
  id: "smith",
  title: "Cats",
  author: "Jane Smith",
  year: "2020",
};
const jones = { id: "jones", title: "Dogs", author: "Ann Jones", year: "2019" };

describe("the manifest", () => {
  it("leaves a lesson without sources exactly as it was", () => {
    expect(docManifest(lesson())).not.toHaveProperty("sources");
  });

  it("stores sources and reads them back", async () => {
    const ctx = memRepo();
    const doc = lesson({
      sources: [smith],
      content: markupToContent("Cats^[@smith, p. 2] *purr*."),
    });
    // An empty repo always takes the commit.
    const { oid } = (await commitDoc({ ...ctx, doc, author }))!;
    expect(await readDocAt({ ...ctx, oid })).toEqual(doc);
  });
});

describe("diffing sources", () => {
  it("reports adds, edits, removals and reorders", () => {
    const before = lesson({ sources: [smith, jones] });
    const after = lesson({
      sources: [
        { ...jones, year: "2021" },
        smith,
        { id: "new", title: "Birds" },
      ],
    });
    const ops = diffDocs(before, after).filter((op) =>
      op.op.includes("source"),
    );
    expect(ops).toEqual([
      { op: "source.edit", sourceId: "jones", name: "Dogs", fields: ["year"] },
      { op: "source.add", sourceId: "new", name: "Birds" },
      { op: "sources.reorder" },
    ]);
    expect(describeOps(diffDocs(before, lesson({ sources: [jones] })))).toMatch(
      /^Remove 1 source/,
    );
  });
});

describe("merging sources", () => {
  it("takes additions and edits from both sides without asking", () => {
    const base = lesson({ sources: [smith] });
    const ours = lesson({ sources: [{ ...smith, year: "2021" }] });
    const theirs = lesson({ sources: [{ ...smith, title: "Cats!" }, jones] });
    const { doc, conflicts } = mergeDocs(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(doc.sources).toEqual([
      { ...smith, year: "2021", title: "Cats!" },
      jones,
    ]);
  });

  it("keeps ours when both sides change the same field", () => {
    const base = lesson({ sources: [smith] });
    const { doc } = mergeDocs(
      base,
      lesson({ sources: [{ ...smith, year: "1999" }] }),
      lesson({ sources: [{ ...smith, year: "2001" }] }),
    );
    expect(doc.sources?.[0].year).toBe("1999");
  });

  it("honours a delete the other side didn't touch", () => {
    const base = lesson({ sources: [smith, jones] });
    const { doc } = mergeDocs(
      base,
      lesson({ sources: [smith, jones] }),
      lesson({ sources: [jones] }),
    );
    expect(doc.sources).toEqual([jones]);
  });
});

describe("merging a text block's words", () => {
  it("is a conflict when one side formats and the other edits the words", () => {
    const base = lesson({ text: "Cats purr" });
    const ours = lesson({ content: markupToContent("Cats **purr**") });
    const theirs = lesson({ text: "Cats purr loudly" });
    const { doc, conflicts } = mergeDocs(base, ours, theirs);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].fields.map((f) => f.field)).toEqual(["content"]);

    const mine = applyResolutions(doc, conflicts, { b1: "ours" }, () => "x");
    expect((mine.sections[0].blocks[0] as TextBlock).content).toBeDefined();
    const theirsWon = applyResolutions(
      doc,
      conflicts,
      { b1: "theirs" },
      () => "x",
    );
    expect(theirsWon.sections[0].blocks[0]).toEqual({
      id: "b1",
      type: "text",
      text: "Cats purr loudly",
    });
    expect(textBlockPlain(theirsWon.sections[0].blocks[0])).toBe(
      "Cats purr loudly",
    );
  });
});
