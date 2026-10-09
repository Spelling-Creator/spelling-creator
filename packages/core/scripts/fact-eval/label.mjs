// Labels for the fact-claim model: every published hub lesson's checkable
// facts, and those of the passages write-passages.mjs wrote, listed by Claude
// through the Claude Code CLI (claude.mjs, so it runs on a Claude
// subscription, no API key), with the exact prompt and schema the Worker sends
// its own provider.
//
//   node scripts/fact-eval/label.mjs [--model opus] [--jobs 3] [--check]
//
// Each reply is kept in data/labels/<id>.json, which is committed: labels cost
// a Claude call each and come out a little different every time, so they are
// archived rather than remade, and a re-run only asks about what has no label
// yet. Every claim then goes through the same gates
// as in production: its quote must be in a passage (placeClaims) and its shape
// must be one the checker takes (prepareClaims). --check also runs the kept
// claims against Wikidata and reports how many it could judge, which is a read
// on the labels, not a filter.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  checkClaims,
  lessonPassages,
  prepareClaims,
} from "../../src/factCheck.js";
import {
  FACT_CLAIMS_SCHEMA,
  factCheckPrompt,
  placeClaims,
} from "../../src/factClaims.js";
import { askClaude } from "./claude.mjs";
import { allLessons } from "./lessons.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const { values: args } = parseArgs({
  options: {
    model: { type: "string", default: "opus" },
    jobs: { type: "string", default: "3" },
    check: { type: "boolean", default: false },
    data: { type: "string", default: path.join(here, "data") },
  },
});

const SYSTEM =
  "You list the checkable facts in lesson passages, exactly as the user's instructions say. Answer only with the structured output.";

// What gets labelled: the hub's lessons, and the written passages.
const sources = (await allLessons()).map((lesson) => ({
  id: lesson.id,
  title: lesson.doc.title,
  passages: lessonPassages(lesson.doc).map((p) => p.text),
}));
const syntheticDir = path.join(args.data, "synthetic");
for (const file of await readdir(syntheticDir).catch(() => [])) {
  sources.push(
    JSON.parse(await readFile(path.join(syntheticDir, file), "utf8")),
  );
}

const labelDir = path.join(args.data, "labels");
await mkdir(labelDir, { recursive: true });
console.log(
  `${sources.length} lessons and topics, labelling with ${args.model}`,
);

async function label(source) {
  const file = path.join(labelDir, `${source.id}.json`);
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    // not labelled yet
  }
  const t0 = Date.now();
  const reply = await askClaude(
    factCheckPrompt(
      source.passages.map((text) => ({ text })),
      source.title,
    ),
    {
      model: args.model,
      system: SYSTEM,
      schema: FACT_CLAIMS_SCHEMA,
    },
  );
  const labelled = {
    lesson: source.id,
    title: source.title,
    model: args.model,
    passages: source.passages,
    claims: reply.claims,
  };
  await writeFile(file, JSON.stringify(labelled, null, 2));
  console.log(
    `  ${source.title}: ${reply.claims.length} claims in ${source.passages.length} passages, ${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );
  return labelled;
}

const queue = [...sources];
const results = [];
await Promise.all(
  Array.from({ length: Number(args.jobs) }, async () => {
    while (queue.length) {
      const source = queue.shift();
      try {
        results.push(await label(source));
      } catch (e) {
        console.log(`  ${source.title}: ${e.message}`);
      }
    }
  }),
);

// The gates every production claim goes through.
let asked = 0;
let kept = 0;
const statuses = {};
for (const r of results) {
  const passages = r.passages.map((text) => ({ text }));
  const { claims } = prepareClaims(placeClaims(r.claims, passages), {
    maxClaims: Infinity,
  });
  asked += r.claims.length;
  kept += claims.length;
  if (args.check) {
    for (const c of await checkClaims(claims, {
      maxClaims: Infinity,
      userAgent:
        "SpellingCreator/1.0 (https://spellingcreator.org; fact model labels)",
    })) {
      const key = c.status === "unknown" ? `unknown (${c.reason})` : c.status;
      statuses[key] = (statuses[key] ?? 0) + 1;
    }
  }
}
console.log(
  `${results.length}/${sources.length} labelled: ${asked} claims, ${kept} kept after the quote and shape gates`,
);
if (args.check) console.log("Wikidata says:", statuses);
