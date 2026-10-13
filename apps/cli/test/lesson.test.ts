// The readers: a typed text file, a Word document of the same text, and a
// .json lesson file, each coming out as a lesson the checks can run on, with
// the notes a typed document earns. Then the writer, and what it leaves on
// disk when it replaces a file or fails to.

import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Document, Packer, Paragraph } from "docx";

import { normalizeLessonFile } from "@spelling-creator/core/jsonImport";

import {
  droppedFields,
  LessonChangedError,
  LessonWriteError,
  OutputExistsError,
  readLesson,
  sourceOf,
  writeLesson,
} from "../src/lesson.ts";
import { withTempDir, writeTemp } from "./helpers.ts";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const TYPED = join(fixtures, "domestic-cats.txt");

test("sourceOf picks a reader by extension", () => {
  assert.equal(sourceOf("a.json"), "json");
  assert.equal(sourceOf("a.oslf.xml"), "xml");
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

test("a forced write replaces the file whole and leaves nothing beside it", async () => {
  const { doc } = await readLesson(join(fixtures, "bold-passage.json"));
  await withTempDir(async (dir) => {
    const path = await writeTemp(dir, "lesson.json", "the old lesson");
    await assert.rejects(writeLesson(path, doc), OutputExistsError);
    assert.equal(await readFile(path, "utf8"), "the old lesson");

    await writeLesson(path, doc, { force: true });
    const written = JSON.parse(await readFile(path, "utf8"));
    assert.equal(written.doc.title, "Domestic Cats");
    assert.deepEqual(await readdir(dir), ["lesson.json"]);
  });
});

test("an OSLF path writes the format, and a blank answer the format needs is a failed write", async () => {
  const { doc } = await readLesson(join(fixtures, "bold-passage.json"));
  await withTempDir(async (dir) => {
    const path = join(dir, "lesson.oslf.json");
    await writeLesson(path, doc);
    const written = JSON.parse(await readFile(path, "utf8"));
    assert.equal(written.oslf, "0.1");
    assert.equal(written.title, "Domestic Cats");

    const blank = {
      ...doc,
      sections: [
        {
          ...doc.sections[0]!,
          blocks: [
            ...doc.sections[0]!.blocks,
            {
              id: "blank",
              type: "question",
              questionType: "single",
              prompt: "Which way?",
              answer: "",
            },
          ],
        },
        ...doc.sections.slice(1),
      ],
    };
    await assert.rejects(
      writeLesson(join(dir, "blank.oslf.json"), blank as typeof doc),
      (err: unknown) =>
        err instanceof LessonWriteError &&
        /blank\.oslf\.json.*Section 1, question \d+ \("Which way\?"\) has no answer/.test(
          err.message,
        ),
    );
    assert.deepEqual(await readdir(dir), ["lesson.oslf.json"]);
  });
});

test("an .oslf.xml path writes the format's XML form, which reads back as the same lesson", async () => {
  const { doc } = await readLesson(join(fixtures, "bold-passage.json"));
  await withTempDir(async (dir) => {
    const path = join(dir, "lesson.oslf.xml");
    await writeLesson(path, doc);
    const xml = await readFile(path, "utf8");
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<lesson /);
    assert.match(xml, /<title>Domestic Cats<\/title>/);

    const back = await readLesson(path);
    assert.equal(back.source, "xml");
    const viaJson = join(dir, "lesson.oslf.json");
    await writeLesson(viaJson, doc);
    const fromJson = await readLesson(viaJson);
    assert.deepEqual(stripIds(back.doc), stripIds(fromJson.doc));
    // Read as OSLF, so a rewrite in place can't be said to drop anything.
    assert.deepEqual(droppedFields(back.raw, back.doc), []);
  });
});

test("an .oslf.xml that isn't a lesson is a failed read, with a reason", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "broken.oslf.xml");
    await writeFile(path, "<lesson><title>Unclosed");
    await assert.rejects(readLesson(path), /isn't valid XML/);
  });
});

// Ids are made fresh on every import, so two reads of one lesson differ there.
function stripIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIds);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "id")
        .map(([key, v]) => [key, stripIds(v)]),
    );
  }
  return value;
}

test("a write is refused when the file changed after it was read", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "lesson.json");
    await copyFile(join(fixtures, "bold-passage.json"), path);
    const { doc, hash } = await readLesson(path);
    await writeFile(path, "saved by the editor in the meantime");

    await assert.rejects(
      writeLesson(path, doc, { force: true, unchangedSince: hash }),
      LessonChangedError,
    );
    assert.equal(
      await readFile(path, "utf8"),
      "saved by the editor in the meantime",
    );
    assert.deepEqual(await readdir(dir), ["lesson.json"]);

    const fresh = await readLesson(join(fixtures, "bold-passage.json"));
    await writeFile(path, await readFile(join(fixtures, "bold-passage.json")));
    await writeLesson(path, doc, { force: true, unchangedSince: fresh.hash });
    assert.equal(
      JSON.parse(await readFile(path, "utf8")).doc.title,
      "Domestic Cats",
    );
  });
});

test("droppedFields names what a rewrite would lose, and only that", async () => {
  const lesson = JSON.parse(
    await readFile(join(fixtures, "bold-passage.json"), "utf8"),
  );
  const keep = (raw: unknown) => droppedFields(raw, normalizeLessonFile(raw));

  assert.deepEqual(
    keep(lesson),
    [],
    "a lesson in the app's own shape loses nothing",
  );

  // The editor writes even plain text as a `content` document; the import
  // stores it as `text`, which is the same words.
  const plain = structuredClone(lesson);
  plain.doc.sections[0].blocks[0].content.content[0].content = [
    {
      type: "text",
      text: "Every pet cat is descended from the AFRICAN WILDCAT.",
    },
  ];
  assert.deepEqual(keep(plain), []);

  const extra = structuredClone(lesson);
  extra.doc.trustedCollaborators = ["sam@example.com"];
  extra.doc.sections[0].blocks.push({ id: "x1", type: "poll", options: [] });
  extra.version = 2;
  assert.deepEqual(keep(extra), [
    "version (2)",
    "doc.sections[0].blocks (5 items, 4 kept)",
    "doc.trustedCollaborators",
  ]);

  // A bare doc, with no envelope, is named from its own root.
  assert.deepEqual(keep({ ...lesson.doc, note: "hi" }), ["note"]);
});

test("a forced write that fails reports it and removes its temporary file", async () => {
  const { doc } = await readLesson(join(fixtures, "bold-passage.json"));
  await withTempDir(async (dir) => {
    // A directory where the file should go: the temporary file is written,
    // and the rename over the directory is what fails.
    await mkdir(join(dir, "lesson.json"));
    await assert.rejects(
      writeLesson(join(dir, "lesson.json"), doc, { force: true }),
      (err) =>
        err instanceof LessonWriteError && !(err instanceof OutputExistsError),
    );
    assert.deepEqual(await readdir(dir), ["lesson.json"]);
  });
});
