// Training pairs for the fact-claim model: every labelled passage as a chat
// (system: the rules and schema, user: the lesson title and the passage,
// assistant: its claims as JSON), the same messages the app sends. Passages
// with no checkable fact stay in with an empty list, which is what teaches the
// model to say nothing.
//
//   node scripts/fact-eval/make-dataset.mjs [--out dir]
//
// The lessons in HOLDOUT_LESSONS go to holdout.jsonl and never to train.jsonl.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { prepareClaims } from "../../src/factCheck.js";
import {
  NO_UNIT,
  passageClaim,
  passageClaimsMessages,
  placeClaims,
} from "../../src/factClaims.js";

// Held out of training. Not simply the newest two, as in the import
// experiment: those (Domestic Cats and Pompeii) hold 8 claims between them,
// too few to score. Pompeii (5, the newest with more than three) and The Life
// of Albert Einstein (15) give 20 claims across 24 passages, from a place and
// a person.
export const HOLDOUT_LESSONS = [
  "3c982988-21db-4185-99ae-46c37ecfe708",
  "a119b2ea-c824-48b0-8df7-8537f971d6fa",
];

const here = path.dirname(fileURLToPath(import.meta.url));

/** A gated claim back in the model's own shape: "none" for no unit. */
const target = (c) => passageClaim({ ...c, unit: c.unit || NO_UNIT });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values: args } = parseArgs({
    options: {
      data: { type: "string", default: path.join(here, "data") },
      out: { type: "string", default: path.join(here, "out", "dataset") },
    },
  });
  const labelDir = path.join(args.data, "labels");
  const train = [];
  const holdout = [];
  for (const file of (await readdir(labelDir)).sort()) {
    const r = JSON.parse(await readFile(path.join(labelDir, file), "utf8"));
    const texts = r.passages.map((text) => ({ text }));
    const { claims } = prepareClaims(placeClaims(r.claims, texts), {
      maxClaims: Infinity,
    });
    r.passages.forEach((text, i) => {
      const messages = passageClaimsMessages(text, r.title);
      const answer = {
        claims: claims.filter((c) => c.passage === i).map(target),
      };
      (HOLDOUT_LESSONS.includes(r.lesson) ? holdout : train).push({
        lesson: r.lesson,
        passage: i + 1,
        messages: [
          ...messages,
          { role: "assistant", content: JSON.stringify(answer) },
        ],
      });
    });
  }
  await mkdir(args.out, { recursive: true });
  const jsonl = (rows) => rows.map((x) => JSON.stringify(x)).join("\n") + "\n";
  await writeFile(path.join(args.out, "train.jsonl"), jsonl(train));
  await writeFile(path.join(args.out, "holdout.jsonl"), jsonl(holdout));
  const count = (rows) =>
    rows.reduce(
      (n, x) => n + JSON.parse(x.messages[2].content).claims.length,
      0,
    );
  console.log(
    `${train.length} training passages (${count(train)} claims), ${holdout.length} holdout passages (${count(holdout)} claims)`,
  );
  console.log(`Written to ${args.out}`);
}
