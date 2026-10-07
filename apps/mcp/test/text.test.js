// Text blocks and sources as the tools speak them: markup in, stored documents
// out, and the same markup back out of get_lesson.

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDoc,
  buildSources,
  presentDoc,
} from "@spelling-creator/core/lessonBuild";
import { applyPatch } from "@spelling-creator/core/lessonPatch";

function lesson(text, sources) {
  return buildDoc({
    title: "t",
    ...(sources ? { sources } : {}),
    sections: [{ name: "One", blocks: [{ type: "text", text }] }],
  });
}

test("an unformatted paragraph is stored as plain text", () => {
  const block = lesson("Cats purr.").sections[0].blocks[0];
  assert.deepEqual(Object.keys(block).sort(), ["id", "text", "type"]);
  assert.equal(block.text, "Cats purr.");
});

test("markup is stored as a formatted document", () => {
  const block = lesson("Cats *purr*.^[A note.]").sections[0].blocks[0];
  assert.equal(block.text, undefined);
  assert.equal(block.content.type, "doc");
  assert.deepEqual(block.content.content[0].content.at(-1), {
    type: "footnote",
    attrs: { sourceId: null, locator: "", note: "A note." },
  });
});

test("get_lesson's view round-trips through update_lesson unchanged", () => {
  const doc = lesson("A *cat* \\* 2 ^[@smith, p. 4 | Why.]\nLine two", [
    { id: "smith", title: "Cats", author: "Jane Smith" },
  ]);
  const shown = presentDoc(doc);
  assert.equal(
    shown.sections[0].blocks[0].text,
    "A *cat* \\* 2 ^[@smith, p. 4 | Why.]\nLine two",
  );
  const rebuilt = buildDoc({
    title: shown.title,
    sources: shown.sources,
    sections: shown.sections.map((s) => ({ name: s.name, blocks: s.blocks })),
  });
  assert.deepEqual(
    rebuilt.sections[0].blocks[0].content,
    doc.sections[0].blocks[0].content,
  );
  assert.deepEqual(rebuilt.sources, doc.sources);
});

test("sources are checked as they come in", () => {
  assert.throws(() => buildSources([{ id: "has space", title: "x" }]), /"id"/);
  assert.throws(() => buildSources([{ id: "a" }]), /title/);
  assert.throws(
    () =>
      buildSources([
        { id: "a", title: "x" },
        { id: "a", title: "y" },
      ]),
    /used twice/,
  );
  assert.throws(() => buildSources([{ id: "a", url: "javascript:x" }]), /url/);
  assert.throws(
    () => buildSources([{ id: "a", title: "x", isbn: "1" }]),
    /unknown field/,
  );
  assert.deepEqual(buildSources([{ id: "a", title: " T " }]), [
    { id: "a", title: "T", author: "", publisher: "", year: "", url: "" },
  ]);
});

test("patch_lesson adds, replaces and removes sources", () => {
  const doc = lesson("Cats.^[@a]^[@a | Kept.]", [{ id: "a", title: "A" }]);
  const added = applyPatch(doc, [
    { op: "add_source", source: { id: "b", title: "B" } },
    { op: "replace_source", sourceId: "a", source: { title: "A2" } },
  ]);
  assert.deepEqual(
    added.sources.map((s) => [s.id, s.title]),
    [
      ["a", "A2"],
      ["b", "B"],
    ],
  );

  const removed = applyPatch(added, [{ op: "remove_source", sourceId: "a" }]);
  assert.deepEqual(
    removed.sources.map((s) => s.id),
    ["b"],
  );
  assert.deepEqual(
    removed.sections[0].blocks[0].content.content[0].content.slice(1),
    [
      {
        type: "footnote",
        attrs: { sourceId: null, locator: "", note: "Kept." },
      },
    ],
  );

  assert.throws(
    () =>
      applyPatch(doc, [
        { op: "add_source", source: { id: "a", title: "dupe" } },
      ]),
    /already has a source/,
  );
  assert.throws(
    () => applyPatch(doc, [{ op: "remove_source", sourceId: "zzz" }]),
    /no source/,
  );
});
