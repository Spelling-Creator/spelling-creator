// Scoring one passage's claims against its labels.
//
// A claim is found when a label has the same property and either overlapping
// quotes or the same value (the same name, for a named fact). Of the found
// ones, the fields the checker looks things up by are compared: the subject
// (it picks the item), the value or stated name, the unit and the qualifier
// (they decide agreeing). A claim whose quote is not in the passage is
// invented, and production drops it, so it is counted apart rather than as a
// wrong claim.

import { prepareClaims, squashText } from "../../src/factCheck.js";
import { placeClaims } from "../../src/factClaims.js";

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const near = (a, b) =>
  a === b || Math.abs(Number(a) - Number(b)) <= Math.abs(Number(b)) * 0.005;

function overlaps(a, b) {
  const x = squashText(a);
  const y = squashText(b);
  return Boolean(x && y && (x.includes(y) || y.includes(x)));
}

function same(got, want) {
  if (got.property !== want.property) return false;
  if (overlaps(got.quote, want.quote)) return true;
  return want.stated
    ? norm(got.stated) === norm(want.stated)
    : near(got.value, want.value);
}

/**
 * The claims a model's reply holds, through the production gates.
 * @param {object[] | null} parsed  parseClaimsReply's result
 * @param {string} passage
 */
export function gate(parsed, passage) {
  if (!parsed) return { claims: [], invented: 0, malformed: 0 };
  const placed = placeClaims(
    parsed.map((c) => ({ ...c, passage: 1 })),
    [{ text: passage }],
  );
  const { claims, dropped } = prepareClaims(placed, { maxClaims: Infinity });
  return {
    claims,
    invented: parsed.length - placed.length,
    malformed: dropped.length,
  };
}

/**
 * @param {object[]} got  gated claims
 * @param {object[]} want  gated labels
 */
export function scorePassage(got, want) {
  const left = [...got];
  const fields = { subject: 0, value: 0, unit: 0, qualifier: 0 };
  let found = 0;
  for (const w of want) {
    const i = left.findIndex((g) => same(g, w));
    if (i < 0) continue;
    const [g] = left.splice(i, 1);
    found += 1;
    fields.subject += norm(g.subject) === norm(w.subject);
    fields.value += w.stated
      ? norm(g.stated) === norm(w.stated)
      : near(g.value, w.value);
    fields.unit += g.unit === w.unit;
    fields.qualifier += g.qualifier === w.qualifier;
  }
  return { want: want.length, got: got.length, found, fields };
}
