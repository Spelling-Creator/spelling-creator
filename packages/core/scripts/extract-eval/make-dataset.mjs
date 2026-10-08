// Training pairs for fine-tuning an extraction model: every published hub
// lesson, rendered in every layout, cut into sections, paired with the section
// it came from. Written as chat-format JSONL (system schema, user document,
// assistant JSON), which is what TRL's SFT trainer and Liquid's LFM2 Extract
// notebooks take.
//
//   node scripts/extract-eval/make-dataset.mjs [--holdout 2] [--out dir]
//
// The newest --holdout lessons go to holdout.jsonl and never to train.jsonl,
// so the fine-tuned model is measured on lessons it has not seen.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { SCHEMA, TYPE_GUIDE } from "./extract.mjs";
import { LAYOUTS } from "./layouts.mjs";
import { DEFAULT_API, fetchLessons } from "./lessons.mjs";
import { renderDocxText } from "./render.mjs";
import { groundTruthSection } from "./score.mjs";
import { splitSections } from "./split.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const { values: args } = parseArgs({
  options: {
    holdout: { type: "string", default: "2" },
    out: { type: "string", default: path.join(here, "out", "dataset") },
    cache: { type: "string", default: path.join(here, ".cache") },
    api: { type: "string", default: DEFAULT_API },
  },
});

await mkdir(args.out, { recursive: true });

// Every published lesson, whatever its section count.
const list = JSON.parse(
  await readFile(path.join(args.cache, "lessons", "list.json"), "utf8").catch(
    async () => {
      const res = await fetch(`${args.api}/lessons`);
      return JSON.stringify((await res.json()).lessons);
    },
  ),
);
const counts = [...new Set(list.map((l) => l.sectionCount))];
const lessons = [];
for (const sectionCount of counts) {
  lessons.push(
    ...(await fetchLessons({
      count: Infinity,
      api: args.api,
      cacheDir: path.join(args.cache, "lessons"),
      sectionCount,
    })),
  );
}
lessons.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
const holdoutIds = new Set(
  lessons.slice(0, Number(args.holdout)).map((l) => l.id),
);

const system = `Return data as a JSON object with the following schema:\n${SCHEMA}\n\n${TYPE_GUIDE}`;
const train = [];
const holdout = [];
let skipped = 0;
for (const lesson of lessons) {
  const renderings = [
    ["docx", await renderDocxText(lesson.doc, { author: lesson.author })],
    ...Object.entries(LAYOUTS).map(([name, layout]) => [
      name,
      layout(lesson.doc),
    ]),
  ];
  for (const [style, text] of renderings) {
    const split = splitSections(text);
    if (split.sections.length !== lesson.doc.sections.length) {
      skipped += 1;
      continue;
    }
    split.sections.forEach((chunk, i) => {
      const gt = groundTruthSection(lesson.doc.sections[i]);
      const target = {
        name: style === "docx" ? "" : gt.name,
        paragraphs: gt.paragraphs.map((p) => p.replace(/\n+/g, " ")),
        spellingWords: gt.spellingWords,
        questions: gt.questions.map((q) => ({
          prompt: q.prompt,
          type: q.type,
          answers: q.answers,
          steps: style === "docx" || style === "worked" ? q.steps : [],
        })),
      };
      const example = {
        lesson: lesson.id,
        style,
        section: i + 1,
        messages: [
          { role: "system", content: system },
          { role: "user", content: chunk.text },
          { role: "assistant", content: JSON.stringify(target) },
        ],
      };
      (holdoutIds.has(lesson.id) ? holdout : train).push(example);
    });
  }
}

const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
await writeFile(path.join(args.out, "train.jsonl"), jsonl(train));
await writeFile(path.join(args.out, "holdout.jsonl"), jsonl(holdout));
console.log(
  `${lessons.length} lessons, ${Object.keys(LAYOUTS).length + 1} layouts: ` +
    `${train.length} training examples, ${holdout.length} holdout examples` +
    (skipped
      ? `, ${skipped} document(s) skipped (section count mismatch)`
      : ""),
);
console.log(`Written to ${args.out}`);
