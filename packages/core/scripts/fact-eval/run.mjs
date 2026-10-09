// Score local ONNX models at listing a passage's checkable facts, against the
// labels label.mjs made. One passage at a time, with the prompt the app would
// send (core/src/factClaims.js), greedy decoding, on the CPU.
//
//   node scripts/fact-eval/run.mjs [--models a,b] [--dtype q4] [--holdout]
//                                  [--local-models dir] [--limit n]
//
// --holdout scores only the lessons make-dataset.mjs holds out of training;
// without it every labelled lesson is scored, which is fair for a model that
// was never trained on them.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { prepareClaims } from "../../src/factCheck.js";
import {
  parseClaimsReply,
  passageClaimsMessages,
  placeClaims,
} from "../../src/factClaims.js";
import { generate, loadModel, unloadModel } from "../extract-eval/extract.mjs";
import { HOLDOUT_LESSONS } from "./make-dataset.mjs";
import { gate, scorePassage } from "./score.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const { values: args } = parseArgs({
  options: {
    models: {
      type: "string",
      default:
        "onnx-community/LFM2-350M-Extract-ONNX,onnx-community/LFM2-1.2B-Extract-ONNX",
    },
    dtype: { type: "string", default: "q4" },
    holdout: { type: "boolean", default: false },
    "local-models": { type: "string" },
    limit: { type: "string" },
    data: { type: "string", default: path.join(here, "data") },
    out: { type: "string", default: path.join(here, "out") },
  },
});

// Every labelled passage, with its gated labels.
const labelDir = path.join(args.data, "labels");
const labelled = [];
for (const file of (await readdir(labelDir)).sort()) {
  labelled.push(JSON.parse(await readFile(path.join(labelDir, file), "utf8")));
}
let passages = [];
for (const r of labelled) {
  if (args.holdout && !HOLDOUT_LESSONS.includes(r.lesson)) continue;
  const texts = r.passages.map((text) => ({ text }));
  const { claims } = prepareClaims(placeClaims(r.claims, texts), {
    maxClaims: Infinity,
  });
  r.passages.forEach((text, i) =>
    passages.push({
      lesson: r.lesson,
      title: r.title,
      index: i,
      text,
      want: claims.filter((c) => c.passage === i),
    }),
  );
}
if (args.limit) passages = passages.slice(0, Number(args.limit));
console.log(
  `${passages.length} passages, ${passages.reduce((n, p) => n + p.want.length, 0)} labelled claims`,
);

await mkdir(args.out, { recursive: true });
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "n/a");
const rows = [];
for (const id of args.models.split(",")) {
  console.log(`\n${id} (${args.dtype})`);
  const ctx = await loadModel({
    id,
    dtype: args.dtype,
    cacheDir: path.join(here, "..", "extract-eval", ".cache"),
    localDir: args["local-models"],
    log: console.log,
  });
  const t = {
    passages: 0,
    parsed: 0,
    want: 0,
    got: 0,
    found: 0,
    invented: 0,
    malformed: 0,
    quiet: 0,
    quietRight: 0,
    subject: 0,
    value: 0,
    unit: 0,
    qualifier: 0,
    ms: 0,
  };
  const outputs = [];
  for (const [n, p] of passages.entries()) {
    const reply = await generate(ctx, passageClaimsMessages(p.text, p.title), {
      maxNewTokens: 1000,
    });
    const parsed = parseClaimsReply(reply.raw);
    const gated = gate(parsed, p.text);
    const s = scorePassage(gated.claims, p.want);
    t.passages += 1;
    t.parsed += parsed !== null;
    t.want += s.want;
    t.got += s.got;
    t.found += s.found;
    t.invented += gated.invented;
    t.malformed += gated.malformed;
    if (!p.want.length) {
      t.quiet += 1;
      // Quiet means an empty list, not a list the gates emptied.
      t.quietRight += parsed !== null && parsed.length === 0;
    }
    for (const k of ["subject", "value", "unit", "qualifier"]) {
      t[k] += s.fields[k];
    }
    t.ms += reply.ms;
    outputs.push({ ...p, raw: reply.raw, got: gated.claims, score: s });
    console.log(
      `  ${n + 1}/${passages.length} ${p.title} [${p.index + 1}]: ${s.found}/${s.want} found, ${s.got} listed${gated.invented ? `, ${gated.invented} invented` : ""}, ${(reply.ms / 1000).toFixed(1)}s`,
    );
  }
  await unloadModel(ctx);
  const name = `${id.split("/").pop()}.${args.dtype}`;
  await writeFile(
    path.join(args.out, `${name}.json`),
    JSON.stringify(outputs, null, 2),
  );
  rows.push(
    `| ${name} | ${pct(t.parsed, t.passages)} | ${pct(t.found, t.want)} | ${pct(t.found, t.got)} | ${t.invented} | ${t.malformed} | ${pct(t.quietRight, t.quiet)} | ${pct(t.subject, t.found)} | ${pct(t.value, t.found)} | ${pct(t.unit, t.found)} | ${pct(t.qualifier, t.found)} | ${(t.ms / t.passages / 1000).toFixed(1)} |`,
  );
}

const table = [
  "| model | parsed | recall | precision | invented | malformed | quiet when none | subject | value | unit | qualifier | s/passage |",
  "| ----- | -----: | -----: | --------: | -------: | --------: | --------------: | ------: | ----: | ---: | --------: | --------: |",
  ...rows,
].join("\n");
await writeFile(path.join(args.out, "summary.md"), `${table}\n`);
console.log(`\n${table}`);
