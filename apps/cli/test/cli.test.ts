// The commands end to end: the built bin (what the package ships; `pnpm test`
// builds it first), spawned the way a script or a CI job would run it, judged
// on its exit code and its --json output.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { FileReport } from "../src/report.ts";
import { withTempDir } from "./helpers.ts";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const TYPED = join(fixtures, "domestic-cats.txt");
const BOLD = join(fixtures, "bold-passage.json");

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function reportsOf(stdout: string): FileReport[] {
  return JSON.parse(stdout) as FileReport[];
}

test("check reports a lesson's problems and exits 1", () => {
  const { code, stdout } = run("check", BOLD, "--json");
  assert.equal(code, 1);
  const [report] = reportsOf(stdout);
  assert.equal(report!.source, "json");
  // "A MAMMAL" is nowhere in the passage.
  assert.ok(report!.errors.some((f) => f.code === "E_GROUNDING_SINGLE"));
  // The bold run is a formatting finding with a quick fix.
  assert.ok(report!.warnings.some((f) => f.code === "W_FORMAT_BOLD"));
});

test("check prints prose by default", () => {
  const { code, stdout } = run("check", BOLD);
  assert.equal(code, 1);
  assert.match(stdout, /bold-passage\.json: \d+ problems?, \d+ suggestions?/);
  assert.match(stdout, /Problems/);
  assert.match(stdout, /\[E_GROUNDING_SINGLE\]/);
});

test("check reads a typed document and shows its import notes", () => {
  const { code, stdout } = run("check", TYPED, "--json");
  const [report] = reportsOf(stdout);
  assert.equal(report!.source, "text");
  assert.match(report!.notes[0]!, /worked out from the wording/);
  // The sample has two sections, so the usual-shape checks have things to say,
  // but nothing in it is a problem.
  assert.equal(report!.errors.length, 0, JSON.stringify(report!.errors));
  assert.equal(code, 0);
});

test("--strict fails on suggestions", () => {
  assert.equal(run("check", TYPED, "--strict").code, 1);
});

test("check takes several files and exits on the worst of them", () => {
  const { code, stdout } = run("check", TYPED, BOLD, "--json");
  assert.equal(code, 1);
  assert.equal(reportsOf(stdout).length, 2);
});

test("an unreadable file exits 2 and the rest are still reported", () => {
  const { code, stdout } = run("check", TYPED, "/nowhere/x.json", "--json");
  assert.equal(code, 2);
  const reports = reportsOf(stdout);
  assert.equal(reports.length, 2);
  assert.match(reports[1]!.error!, /nowhere/);
});

test("fix makes the quick fixes in place and leaves the rest", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "lesson.json");
    await copyFile(BOLD, path);
    const { code, stdout } = run("fix", path, "--json");
    const [report] = reportsOf(stdout);
    // The one bold span is both a heavy-formatting problem and a bold
    // suggestion. Whichever fix runs first clears the other, so what matters
    // is that a formatting fix was made and no formatting finding remains.
    const formatting = (f: { code: string }) => /_FORMAT_/.test(f.code);
    assert.ok(report!.fixed!.some(formatting), JSON.stringify(report!.fixed));
    assert.ok(![...report!.errors, ...report!.warnings].some(formatting));
    assert.ok(report!.errors.some((f) => f.code === "E_GROUNDING_SINGLE"));
    assert.equal(report!.wrote, path);
    assert.equal(code, 1, "the grounding problem is still there");

    const written = JSON.parse(await readFile(path, "utf8"));
    assert.equal(written.format, "spelling-creator-lesson");
    const [block] = written.doc.sections[0].blocks;
    assert.ok(
      !JSON.stringify(block).includes('"bold"'),
      "the bold mark is gone from the file",
    );
  });
});

test("fix --dry-run writes nothing", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "lesson.json");
    await copyFile(BOLD, path);
    const before = await readFile(path, "utf8");
    const { stdout } = run("fix", path, "--dry-run", "--json");
    assert.equal(reportsOf(stdout)[0]!.wrote, undefined);
    assert.equal(await readFile(path, "utf8"), before);
  });
});

test("convert writes a lesson file beside a document and refuses to overwrite it", async () => {
  await withTempDir(async (dir) => {
    const input = join(dir, "cats.txt");
    await copyFile(TYPED, input);
    const first = run("convert", input, "--json");
    assert.equal(first.code, 0);
    const out = join(dir, "cats.json");
    assert.equal(reportsOf(first.stdout)[0]!.wrote, out);
    const written = JSON.parse(await readFile(out, "utf8"));
    assert.equal(written.doc.title, "The History of Domestic Cats");

    const again = run("convert", input, "--json");
    assert.equal(again.code, 2);
    assert.match(reportsOf(again.stdout)[0]!.error!, /--force/);
    assert.equal(run("convert", input, "--force").code, 0);
  });
});

test("fix on a document converts it, and takes --out", async () => {
  await withTempDir(async (dir) => {
    const out = join(dir, "fixed.json");
    const { code, stdout } = run("fix", TYPED, "--out", out, "--json");
    assert.equal(code, 0);
    assert.equal(reportsOf(stdout)[0]!.wrote, out);
    assert.equal(
      JSON.parse(await readFile(out, "utf8")).doc.sections.length,
      2,
    );
  });
});

test("fix won't write a lesson file over the document it read without --force", async () => {
  await withTempDir(async (dir) => {
    const input = join(dir, "cats.txt");
    await copyFile(TYPED, input);
    const before = await readFile(input, "utf8");
    const { code, stdout } = run("fix", input, "--out", input, "--json");
    assert.equal(code, 2);
    assert.match(reportsOf(stdout)[0]!.error!, /--force/);
    assert.equal(await readFile(input, "utf8"), before);
  });
});

test("fix rewrites a .json lesson in place however its path is spelled", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "lesson.json");
    await copyFile(BOLD, path);
    const { stdout } = run("fix", path, "--out", join(dir, ".", "lesson.json"));
    assert.match(stdout, /1 fix\b|\d+ fixes/);
    assert.doesNotMatch(stdout, /already exists/);
  });
});

test("a lesson that can't be written is reported and exits 2", async () => {
  await withTempDir(async (dir) => {
    const out = join(dir, "missing", "cats.json");
    const { code, stdout } = run("convert", TYPED, "--out", out, "--json");
    assert.equal(code, 2);
    assert.match(reportsOf(stdout)[0]!.error!, /Couldn't write/);
  });
});

test("convert doesn't claim a lesson has no problems", async () => {
  await withTempDir(async (dir) => {
    const out = join(dir, "cats.json");
    const { stdout } = run("convert", TYPED, "--out", out);
    assert.match(stdout, /converted, not checked/);
    assert.doesNotMatch(stdout, /0 problems/);
  });
});

test("fix leaves a lesson with nothing to fix exactly as it was", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "lesson.json");
    await copyFile(BOLD, path);
    run("fix", path);
    // Squeezed onto one line: a rewrite would put the indentation back.
    const fixed = JSON.stringify(JSON.parse(await readFile(path, "utf8")));
    await writeFile(path, fixed);
    const { stdout } = run("fix", path, "--json");
    const [report] = reportsOf(stdout);
    assert.deepEqual(report!.fixed, []);
    assert.equal(report!.wrote, undefined);
    assert.equal(await readFile(path, "utf8"), fixed);
  });
});

test("fix won't rewrite in place what the lesson format would drop", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "lesson.json");
    const lesson = JSON.parse(await readFile(BOLD, "utf8"));
    lesson.doc.sections[0].blocks[0].reviewedBy = "Sam";
    const before = JSON.stringify(lesson, null, 2);
    await writeFile(path, before);

    const refused = run("fix", path, "--json");
    assert.equal(refused.code, 2);
    const [report] = reportsOf(refused.stdout);
    assert.match(report!.error!, /doc\.sections\[0\]\.blocks\[0\]\.reviewedBy/);
    assert.match(report!.error!, /--out/);
    assert.equal(await readFile(path, "utf8"), before);

    // A dry run says the same thing without failing.
    const dry = reportsOf(run("fix", path, "--dry-run", "--json").stdout)[0]!;
    assert.equal(dry.error, undefined);
    assert.ok(dry.notes.some((n) => n.includes("reviewedBy")));

    const copy = join(dir, "fixed.json");
    assert.equal(
      reportsOf(run("fix", path, "--out", copy, "--json").stdout)[0]!.wrote,
      copy,
    );
    assert.equal(await readFile(path, "utf8"), before);

    assert.equal(
      reportsOf(run("fix", path, "--force", "--json").stdout)[0]!.wrote,
      path,
    );
    assert.notEqual(await readFile(path, "utf8"), before);
  });
});

test("the bin shows help and refuses an unknown command", () => {
  const help = run("--help");
  assert.equal(help.code, 0);
  assert.match(help.stdout, /check <files\.\.>/);
  assert.match(help.stdout, /fix <file>/);
  assert.match(help.stdout, /convert <file>/);
  assert.notEqual(run("publish").code, 0);
});
