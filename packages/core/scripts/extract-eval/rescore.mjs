// Re-score the saved model outputs in out/ with the current score.mjs, without
// running any model again. Timing comes from the last results.json when it has
// a matching row.
//
//   node scripts/extract-eval/rescore.mjs [--out dir] [--cache dir]

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  checkCounts,
  groundTruthSection,
  lessonFromExtraction,
  scoreSection,
} from "./score.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const { values: args } = parseArgs({
  options: {
    out: { type: "string", default: path.join(here, "out") },
    cache: { type: "string", default: path.join(here, ".cache") },
  },
});

const slugOf = (title) => title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
const pct = (x) => `${Math.round(x * 100)}%`;
const mean = (xs) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

const lessonDir = path.join(args.cache, "lessons");
const lessons = new Map();
for (const file of await readdir(lessonDir)) {
  if (file === "list.json") continue;
  const lesson = JSON.parse(await readFile(path.join(lessonDir, file), "utf8"));
  lessons.set(slugOf(lesson.title), lesson);
}

let timing = [];
try {
  timing = JSON.parse(
    await readFile(path.join(args.out, "results.json"), "utf8"),
  );
} catch {
  // no earlier run
}

// "<label>.<lesson slug>.<style>.s<n>.json"; the label may itself hold dots
// ("model.LFM2-1.2B-Extract-ONNX"), the slug never does.
const pattern =
  /^(.+)\.([a-z0-9-]+)\.(docx|plain|qa|caps|bullets|colon|worked)\.s(\d+)\.json$/;
const rows = [];
const byCase = new Map();
for (const file of (await readdir(args.out)).sort()) {
  const m = pattern.exec(file);
  if (!m) continue;
  const [, model, slug, style, section] = m;
  const lesson = lessons.get(slug);
  if (!lesson) continue;
  const saved = JSON.parse(await readFile(path.join(args.out, file), "utf8"));
  const gt = groundTruthSection(lesson.doc.sections[Number(section) - 1]);
  const score = scoreSection(gt, saved.json);
  const earlier = timing.find(
    (r) =>
      r.model.endsWith(model) &&
      r.lesson === lesson.title &&
      r.style === style &&
      r.section === Number(section),
  );
  rows.push({
    model,
    lesson: lesson.title,
    style,
    section: Number(section),
    tokensPerSecond: earlier?.tokensPerSecond ?? NaN,
    seconds: earlier?.seconds ?? NaN,
    ...score,
  });
  const key = `${model}|${slug}|${style}`;
  if (!byCase.has(key)) byCase.set(key, { model, lesson, style, sections: [] });
  byCase.get(key).sections[Number(section) - 1] = saved.json;
}

for (const c of byCase.values()) {
  let rebuilt;
  try {
    rebuilt = checkCounts(lessonFromExtraction(c.lesson.title, c.sections));
  } catch (err) {
    rebuilt = { errors: NaN, warnings: NaN, failed: String(err.message) };
  }
  rows.push({
    model: c.model,
    lesson: c.lesson.title,
    style: c.style,
    section: 0,
    rebuiltChecks: rebuilt,
    originalChecks: checkCounts(c.lesson.doc),
  });
}

const models = [...new Set(rows.map((r) => r.model))];
const styles = [...new Set(rows.map((r) => r.style))];
const lines = [
  "| model | style | sections | parsed | passage words | paragraphs | spelling | prompts F1 | types (model) | types (derived) | answers | composite | tok/s | s/section |",
  "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
];
for (const model of models) {
  for (const style of styles) {
    const r = rows.filter(
      (x) => x.model === model && x.style === style && x.section > 0,
    );
    if (!r.length) continue;
    const f1 = r.map((x) =>
      x.promptRecall + x.promptPrecision
        ? (2 * x.promptRecall * x.promptPrecision) /
          (x.promptRecall + x.promptPrecision)
        : 0,
    );
    const col = (f) => pct(mean(r.map(f)));
    lines.push(
      `| ${model} | ${style} | ${r.length} | ${col((x) => (x.parsed ? 1 : 0))} | ` +
        `${col((x) => x.passageCoverage)} | ${col((x) => x.passageRecall)} | ${col((x) => x.spellingF1)} | ` +
        `${pct(mean(f1))} | ${col((x) => x.typeAccuracy)} | ${col((x) => x.derivedTypeAccuracy)} | ` +
        `${col((x) => x.answerAccuracy)} | ${col((x) => x.composite)} | ` +
        `${mean(r.map((x) => x.tokensPerSecond)).toFixed(1)} | ${mean(r.map((x) => x.seconds)).toFixed(0)} |`,
    );
  }
}
const checks = [
  "",
  "| model | style | rebuilt errors | rebuilt warnings | original errors | original warnings |",
  "| --- | --- | ---: | ---: | ---: | ---: |",
];
for (const model of models) {
  for (const style of styles) {
    const r = rows.filter(
      (x) => x.model === model && x.style === style && x.section === 0,
    );
    if (!r.length) continue;
    checks.push(
      `| ${model} | ${style} | ${mean(r.map((x) => x.rebuiltChecks.errors)).toFixed(1)} | ` +
        `${mean(r.map((x) => x.rebuiltChecks.warnings)).toFixed(1)} | ` +
        `${mean(r.map((x) => x.originalChecks.errors)).toFixed(1)} | ` +
        `${mean(r.map((x) => x.originalChecks.warnings)).toFixed(1)} |`,
    );
  }
}
const summary = [...lines, ...checks].join("\n");
console.log(summary);
await writeFile(path.join(args.out, "summary.md"), `${summary}\n`);
await writeFile(
  path.join(args.out, "rescored.json"),
  JSON.stringify(rows, null, 2),
);
