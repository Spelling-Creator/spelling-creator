// Can a small local model turn a lesson document back into lesson JSON?
//
//   node scripts/extract-eval/run.mjs --lessons 4 --sections 2 \
//     --models onnx-community/LFM2-1.2B-Extract-ONNX,onnx-community/LFM2-350M-Extract-ONNX
//   node scripts/extract-eval/run.mjs --strategy rules --styles all
//
// Renders the newest hub lessons as documents (render.mjs, layouts.mjs), splits
// them into sections (split.mjs), turns each section into the lesson shape,
// scores the result against the lesson it came from (score.mjs), and writes a
// summary. Two strategies:
//
//   model    the model reads the whole section and writes the JSON (extract.mjs)
//   rules    the import's own rule-based parser (core/documentImport.js, via
//            parse.mjs) reads the section; no model is loaded. "hybrid" is
//            accepted as an older name for the same thing.
//
// Run it from packages/core. --dry-run stops after the split and reports how
// well the splitter found the sections, with no model involved.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { extractSection, loadModel, unloadModel } from "./extract.mjs";
import { LAYOUTS } from "./layouts.mjs";
import { fetchLessons } from "./lessons.mjs";
import { parseSection } from "./parse.mjs";
import { renderDocxText } from "./render.mjs";
import {
  checkCounts,
  groundTruthSection,
  lessonFromExtraction,
  scoreSection,
} from "./score.mjs";
import { splitSections } from "./split.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);

const { values: args } = parseArgs({
  options: {
    lessons: { type: "string", default: "4" },
    sections: { type: "string", default: "6" },
    strategy: { type: "string", default: "model" },
    models: {
      type: "string",
      default:
        "onnx-community/LFM2-1.2B-Extract-ONNX,onnx-community/LFM2-350M-Extract-ONNX",
    },
    dtype: { type: "string", default: "q4" },
    styles: { type: "string", default: "docx,plain" },
    "max-new-tokens": { type: "string", default: "1500" },
    out: { type: "string", default: path.join(here, "out") },
    cache: { type: "string", default: path.join(here, ".cache") },
    skip: { type: "string", default: "" },
    "dry-run": { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
  },
});

const lessonCount = Number(args.lessons);
const sectionLimit = Number(args.sections);
const maxNewTokens = Number(args["max-new-tokens"]);
const strategy = args.strategy === "hybrid" ? "rules" : args.strategy;
if (!["model", "rules"].includes(strategy)) {
  throw new Error(`Unknown strategy "${args.strategy}"; use model or rules`);
}
const models =
  args.models === "none" ? [] : args.models.split(",").filter(Boolean);
const styles =
  args.styles === "all"
    ? ["docx", ...Object.keys(LAYOUTS)]
    : args.styles.split(",").filter(Boolean);
const log = (...a) => console.log(...a);
const pct = (x) => `${Math.round(x * 100)}%`;
const mean = (xs) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const slugOf = (title) => title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

for (const style of styles) {
  if (style !== "docx" && !LAYOUTS[style]) {
    throw new Error(
      `Unknown style "${style}"; use docx or ${Object.keys(LAYOUTS).join(", ")}`,
    );
  }
}
if (strategy === "model" && !models.length) {
  throw new Error("--strategy model needs --models");
}

await mkdir(args.out, { recursive: true });

// 1. Lessons and their renderings.
const lessons = await fetchLessons({
  count: lessonCount,
  cacheDir: path.join(args.cache, "lessons"),
  skip: args.skip.split(",").filter(Boolean),
});
log(`Lessons: ${lessons.map((l) => l.title).join(" | ")}`);

const cases = [];
for (const lesson of lessons) {
  const doc = lesson.doc;
  const originalChecks = checkCounts(doc);
  for (const style of styles) {
    const text =
      style === "docx"
        ? await renderDocxText(doc, { author: lesson.author })
        : LAYOUTS[style](doc);
    await writeFile(
      path.join(args.out, `${slugOf(lesson.title)}.${style}.txt`),
      text,
    );
    const split = splitSections(text);
    cases.push({ lesson, style, text, split, originalChecks });
    log(
      `  ${lesson.title} [${style}]: ${split.sections.length}/${doc.sections.length} sections found` +
        (split.dropped ? `, ${split.dropped} trailing chunk(s) dropped` : ""),
    );
  }
}

if (args["dry-run"]) {
  const ok = cases.filter(
    (c) => c.split.sections.length === c.lesson.doc.sections.length,
  ).length;
  log(
    `Splitter: ${ok}/${cases.length} documents split into the right number of sections`,
  );
  process.exit(0);
}

// 2. One pass per model, or a single pass for the parser, which uses none.
const results = [];
const passes = strategy === "rules" ? ["none"] : models;
for (const id of passes) {
  const label = `${strategy}:${id === "none" ? "rules" : id.split("/").pop()}`;
  let ctx = null;
  if (id !== "none") {
    log(`\nLoading ${id} (${args.dtype})`);
    ctx = await loadModel({ id, dtype: args.dtype, cacheDir: args.cache, log });
  }
  for (const c of cases) {
    const gtSections = c.lesson.doc.sections.map(groundTruthSection);
    const n = Math.min(
      sectionLimit,
      gtSections.length,
      c.split.sections.length,
    );
    const extracted = [];
    for (let i = 0; i < n; i += 1) {
      const chunk = c.split.sections[i];
      const t0 = performance.now();
      let r;
      if (strategy === "rules") {
        const json = parseSection(chunk);
        r = {
          raw: "",
          json,
          promptTokens: 0,
          generated: 0,
          ms: performance.now() - t0,
          truncated: false,
          modelCalls: json.modelCalls,
        };
      } else {
        r = await extractSection(ctx, chunk.text, {
          maxNewTokens,
          onChunk: (s) => {
            if (args.verbose) process.stdout.write(s);
          },
        });
        if (args.verbose) process.stdout.write("\n");
        r.modelCalls = 1;
      }
      const score = scoreSection(gtSections[i], r.json);
      extracted.push(r.json);
      const row = {
        model: label,
        lesson: c.lesson.title,
        style: c.style,
        section: i + 1,
        promptTokens: r.promptTokens,
        generated: r.generated,
        seconds: r.ms / 1000,
        tokensPerSecond: r.generated ? r.generated / (r.ms / 1000) : 0,
        modelCalls: r.modelCalls,
        truncated: r.truncated,
        ...score,
      };
      results.push(row);
      log(
        `  ${c.lesson.title} [${c.style}] s${i + 1}: ${row.seconds.toFixed(1)}s, ${r.modelCalls} model call(s)` +
          `${r.truncated ? " TRUNCATED" : ""}${score.parsed ? "" : " NO JSON"} ` +
          `passage ${pct(score.passageCoverage)} spell ${pct(score.spellingF1)} ` +
          `prompts ${pct(score.promptRecall)} types ${pct(score.typeAccuracy)} ` +
          `(derived ${pct(score.derivedTypeAccuracy)}) answers ${pct(score.answerAccuracy)}`,
      );
      await writeFile(
        path.join(
          args.out,
          `${label.replace(":", ".")}.${slugOf(c.lesson.title)}.${c.style}.s${i + 1}.json`,
        ),
        JSON.stringify(
          { chunk: chunk.text, raw: r.raw, json: r.json, score },
          null,
          2,
        ),
      );
    }
    // The lesson checks on what an import would actually hand the editor.
    let rebuilt;
    try {
      rebuilt = checkCounts(lessonFromExtraction(c.split.title, extracted));
    } catch (err) {
      rebuilt = { errors: NaN, warnings: NaN, failed: String(err.message) };
    }
    results.push({
      model: label,
      lesson: c.lesson.title,
      style: c.style,
      section: 0,
      rebuiltChecks: rebuilt,
      originalChecks: c.originalChecks,
    });
    log(
      `  ${c.lesson.title} [${c.style}] rebuilt lesson: ${rebuilt.errors} errors, ${rebuilt.warnings} warnings ` +
        `(original: ${c.originalChecks.errors} errors, ${c.originalChecks.warnings} warnings)` +
        (rebuilt.failed ? ` ${rebuilt.failed}` : ""),
    );
  }
  if (ctx) await unloadModel(ctx);
}

// 3. Summary.
const lines = [
  "| strategy | style | sections | parsed | passage words | paragraphs | spelling | prompts F1 | types (model) | types (derived) | answers | composite | model calls | s/section |",
  "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
];
for (const label of [...new Set(results.map((r) => r.model))]) {
  for (const style of styles) {
    const rows = results.filter(
      (r) => r.model === label && r.style === style && r.section > 0,
    );
    if (!rows.length) continue;
    const f1 = rows.map((r) =>
      r.promptRecall + r.promptPrecision
        ? (2 * r.promptRecall * r.promptPrecision) /
          (r.promptRecall + r.promptPrecision)
        : 0,
    );
    const col = (f) => pct(mean(rows.map(f)));
    lines.push(
      `| ${label} | ${style} | ${rows.length} | ${col((r) => (r.parsed ? 1 : 0))} | ` +
        `${col((r) => r.passageCoverage)} | ${col((r) => r.passageRecall)} | ${col((r) => r.spellingF1)} | ` +
        `${pct(mean(f1))} | ${col((r) => r.typeAccuracy)} | ${col((r) => r.derivedTypeAccuracy)} | ` +
        `${col((r) => r.answerAccuracy)} | ${col((r) => r.composite)} | ` +
        `${mean(rows.map((r) => r.modelCalls)).toFixed(1)} | ${mean(rows.map((r) => r.seconds)).toFixed(1)} |`,
    );
  }
}
const summary = lines.join("\n");
log(`\n${summary}`);
await writeFile(
  path.join(args.out, "results.json"),
  JSON.stringify(results, null, 2),
);
await writeFile(path.join(args.out, "summary.md"), `${summary}\n`);
