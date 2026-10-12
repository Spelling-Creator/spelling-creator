// The readers: a typed text file, a Word document of the same text, and a
// .json lesson file, each coming out as a lesson the checks can run on, with
// the notes a typed document earns.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Document, Packer, Paragraph } from "docx";

import { readLesson, sourceOf } from "../src/lesson.ts";
import { withTempDir, writeTemp } from "./helpers.ts";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const TYPED = join(fixtures, "domestic-cats.txt");

test("sourceOf picks a reader by extension", () => {
  assert.equal(sourceOf("a.json"), "json");
  assert.equal(sourceOf("a.DOCX"), "docx");
  assert.equal(sourceOf("a.txt"), "text");
  assert.equal(sourceOf("a.md"), "text");
  assert.equal(sourceOf("notes"), "text");
});

test("a typed text file reads as a lesson, with a note that it was guessed", async () => {
  const { doc, source, notes } = await readLesson(TYPED);
  assert.equal(source, "text");
  assert.equal(doc.title, "The History of Domestic Cats");
  assert.equal(doc.sections.length, 2);
  assert.equal(doc.sections[0]!.name, "The Wildcat Ancestor");
  const questions = doc.sections[0]!.blocks.filter(
    (b) => b.type === "question",
  );
  assert.equal(questions.length, 7);
  assert.match(notes[0]!, /worked out from the wording/);
  assert.equal(notes.length, 1, "a clean read earns no further notes");
});

test("a Word document reads the same way as its text", async () => {
  const text = await readFile(TYPED, "utf8");
  const docx = new Document({
    sections: [
      {
        children: text.split("\n").map((line) => new Paragraph(line)),
      },
    ],
  });
  await withTempDir(async (dir) => {
    const path = await writeTemp(
      dir,
      "domestic-cats.docx",
      await Packer.toBuffer(docx),
    );
    const { doc, source, notes } = await readLesson(path);
    assert.equal(source, "docx");
    assert.equal(doc.title, "The History of Domestic Cats");
    assert.equal(doc.sections.length, 2);
    assert.equal(
      doc.sections[1]!.blocks.filter((b) => b.type === "vakt").length,
      1,
    );
    assert.match(notes[0]!, /worked out from the wording/);
  });
});

test("a .json lesson file reads without notes", async () => {
  const { doc, source, notes } = await readLesson(
    join(fixtures, "bold-passage.json"),
  );
  assert.equal(source, "json");
  assert.deepEqual(notes, []);
  assert.equal(doc.sections[0]!.blocks.length, 4);
});

test("a line the rules cannot place is named in the notes", async () => {
  await withTempDir(async (dir) => {
    const text = await readFile(TYPED, "utf8");
    const path = await writeTemp(
      dir,
      "stray.txt",
      text.replace(
        "5. Name a wild animal that hunts.",
        "5. Name a wild animal that hunts.\n(turn over for more)",
      ),
    );
    const { notes } = await readLesson(path);
    assert.ok(
      notes.some(
        (n) => n.includes("couldn't be placed") && n.includes("turn over"),
      ),
      notes.join("\n"),
    );
  });
});

test("a file with no lesson in it is refused with a reason", async () => {
  await withTempDir(async (dir) => {
    const path = await writeTemp(dir, "shopping.txt", "milk\neggs\nbread\n");
    await assert.rejects(readLesson(path), /No lesson was found/);
  });
});

test("a missing file is refused with its path", async () => {
  await assert.rejects(readLesson("/nowhere/lesson.json"), /nowhere/);
});
