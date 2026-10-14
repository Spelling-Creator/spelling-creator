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

test("a prompt and its steps take the markup too, and come back as it", () => {
  const doc = buildDoc({
    title: "t",
    sections: [
      {
        name: "One",
        blocks: [
          {
            type: "question",
            questionType: "number",
            prompt: "How many is {tex: \\frac{60}{5}}?^[Dropped.]",
            answer: "{asciimath: 3/4}",
            steps: [
              "There are 60 seconds in a minute.",
              "{tex: \\frac{60}{5} = 12}{spoken: sixty over five is twelve}",
            ],
          },
        ],
      },
    ],
  });
  const [block] = doc.sections[0].blocks;
  assert.equal(block.prompt.type, "doc");
  assert.equal(block.answer.type, "doc");
  assert.equal(block.steps[0].text, "There are 60 seconds in a minute.");
  assert.equal(block.steps[1].text.type, "doc");
  const [shown] = presentDoc(doc).sections[0].blocks;
  assert.equal(shown.prompt, "How many is {tex: \\frac{60}{5}}?");
  assert.equal(shown.answer, "{asciimath: 3/4}");
  // A bare number is still an answer, and comes back as its digits.
  const plain = buildDoc({
    title: "t",
    sections: [
      {
        blocks: [
          {
            type: "question",
            questionType: "number",
            prompt: "How?",
            answer: 12,
          },
        ],
      },
    ],
  });
  assert.equal(plain.sections[0].blocks[0].answer, "12");
  assert.deepEqual(shown.steps, [
    "There are 60 seconds in a minute.",
    "{tex: \\frac{60}{5} = 12}{spoken: sixty over five is twelve}",
  ]);
  const rebuilt = buildDoc({
    title: "t",
    sections: [{ name: "One", blocks: [shown] }],
  });
  assert.deepEqual(rebuilt.sections[0].blocks[0].prompt, block.prompt);
  assert.deepEqual(
    rebuilt.sections[0].blocks[0].steps.map((s) => s.text),
    block.steps.map((s) => s.text),
  );
});

test("get_lesson shows an older picture's credit apart from its caption", () => {
  const credit = "Image (by Jane Doe, CC BY-SA 4.0) via Wikimedia Commons";
  const doc = {
    title: "t",
    sections: [
      {
        id: "s",
        name: "One",
        blocks: [
          {
            id: "i",
            type: "image",
            image: { hash: "abc", mime: "image/png", ext: "png" },
            caption: `A lion. ${credit}`,
          },
        ],
      },
    ],
  };
  const [shown] = presentDoc(doc).sections[0].blocks;
  assert.equal(shown.caption, "A lion.");
  assert.equal(shown.credit, credit);
  // Passed back as shown, the attribution survives.
  const rebuilt = buildDoc({ title: "t", sections: [{ blocks: [shown] }] });
  assert.equal(rebuilt.sections[0].blocks[0].credit, credit);
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
