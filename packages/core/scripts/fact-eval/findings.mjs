// What an author would see: a model's claims (from run.mjs) and the labels,
// both run through the real checker against Wikidata, compared as findings.
//
//   node scripts/fact-eval/findings.mjs out/<model>.int8.json
//
// Recall and precision count claims; this counts what reaches the author. A
// "Wikidata disagrees" finding the labels do not produce is a false alarm,
// the costly mistake, since it tells the author a right fact is wrong. A
// label's finding the model misses is a check that quietly did not happen.
// A finding is matched by its passage and an overlapping quote.

import { readFile } from "node:fs/promises";

import { checkClaims, squashText } from "../../src/factCheck.js";

const file = process.argv[2];
if (!file) throw new Error("Usage: findings.mjs <run.mjs output file>");
const rows = JSON.parse(await readFile(file, "utf8"));

const opts = {
  maxClaims: Infinity,
  userAgent:
    "SpellingCreator/1.0 (https://spellingcreator.org; fact model evaluation)",
};
const tag = (claims, i) => claims.map((c) => ({ ...c, passage: i }));

// Wikipedia and Wikidata throttle a burst of lookups from one address, which
// comes back as "lookup-failed". Those are asked again after a pause, a few
// times, so a throttled lookup is not scored as an answer.
async function check(claims) {
  let results = await checkClaims(claims, opts);
  for (let attempt = 0; attempt < 4; attempt++) {
    const failed = results
      .map((r, i) => (r.reason === "lookup-failed" ? i : -1))
      .filter((i) => i >= 0);
    if (!failed.length) break;
    await new Promise((resolve) => setTimeout(resolve, 10000));
    const again = await checkClaims(
      failed.map((i) => claims[i]),
      opts,
    );
    failed.forEach((i, k) => (results[i] = again[k]));
  }
  return results;
}

const model = await check(rows.flatMap((r, i) => tag(r.got, i)));
const labels = await check(rows.flatMap((r, i) => tag(r.want, i)));

const overlaps = (a, b) => {
  const x = squashText(a.quote);
  const y = squashText(b.quote);
  return a.passage === b.passage && x && y && (x.includes(y) || y.includes(x));
};
const count = (list) =>
  list.reduce((n, c) => {
    const key = c.status === "unknown" ? `unknown (${c.reason})` : c.status;
    return { ...n, [key]: (n[key] ?? 0) + 1 };
  }, {});
const describe = (c) =>
  `[${rows[c.passage].title.slice(0, 20)} ${rows[c.passage].index + 1}] ${c.property} "${c.quote}" on ${c.entity?.label ?? c.subject}`;

console.log("model's findings:", count(model));
console.log("labels' findings:", count(labels));

const falseAlarms = model.filter(
  (m) =>
    m.status === "disagrees" &&
    !labels.some((l) => l.status === "disagrees" && overlaps(m, l)),
);
const missed = labels.filter(
  (l) =>
    (l.status === "agrees" || l.status === "disagrees") &&
    !model.some((m) => m.status === l.status && overlaps(m, l)),
);
console.log(
  `\nfalse alarms (model says Wikidata disagrees, labels do not): ${falseAlarms.length}`,
);
for (const c of falseAlarms) console.log("  " + describe(c));
console.log(`\nlabel findings the model does not reproduce: ${missed.length}`);
for (const c of missed) console.log(`  ${c.status}: ${describe(c)}`);
