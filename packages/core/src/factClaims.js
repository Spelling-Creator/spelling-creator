// Finding the checkable facts in a lesson's passages: the prompt, the schema
// and the reply handling, in one place for every reader of them.
//
// The Worker sends a whole lesson's passages, numbered, to its AI provider
// (factCheckPrompt with FACT_CLAIMS_SCHEMA). The on-device model reads one
// passage at a time (passageClaimsMessages), and the training scripts in
// scripts/fact-eval build its examples from the same text, so the prompt it is
// trained on is the prompt it is sent. Either way the model only extracts:
// judging a claim is factCheck.js's job, and a claim whose quote is not in its
// passage is dropped (placeClaims) before anything is looked up.

import { parseModelJson } from "./documentImportModel.js";
import {
  FACT_PROPERTIES,
  FACT_PROPERTY_KEYS,
  FACT_QUALIFIERS,
  FACT_UNIT_KEYS,
  squashText,
} from "./factCheck.js";

// A unit-less claim (a population, a date) says "none" to the model: an empty
// string is a legal enum value in JSON Schema but not one every provider
// accepts.
export const NO_UNIT = "none";
export const CLAIM_UNITS = FACT_UNIT_KEYS.map((key) => key || NO_UNIT);

const CLAIM_FIELDS = {
  quote: { type: "string" },
  subject: { type: "string" },
  kind: { type: "string" },
  property: { type: "string", enum: FACT_PROPERTY_KEYS },
  stated: { type: "string" },
  value: { type: "number" },
  unit: { type: "string", enum: CLAIM_UNITS },
  month: { type: "integer" },
  day: { type: "integer" },
  qualifier: { type: "string", enum: FACT_QUALIFIERS },
};

function claimsSchema(fields) {
  return {
    type: "object",
    properties: {
      claims: {
        type: "array",
        items: {
          type: "object",
          properties: fields,
          required: Object.keys(fields),
          additionalProperties: false,
        },
      },
    },
    required: ["claims"],
    additionalProperties: false,
  };
}

/** A whole lesson's claims, each naming the passage it is in. */
export const FACT_CLAIMS_SCHEMA = claimsSchema({
  passage: { type: "integer" },
  ...CLAIM_FIELDS,
});

/** One passage's claims, for the on-device model. */
export const PASSAGE_CLAIMS_SCHEMA = claimsSchema(CLAIM_FIELDS);

const KINDS_OF_FACT = () =>
  `Only these kinds of fact count. Use the matching "property":
${FACT_PROPERTY_KEYS.map((key) => `- ${key}: ${FACT_PROPERTIES[key].hint}`).join("\n")}`;

const FIELD_LINES = () => [
  `- "quote": the shortest words from the passage that state the number, date or name, copied exactly, keeping its capital letters ("8,849 METRES", "CANBERRA").`,
  `- "subject": the English name of the thing, the way an encyclopedia titles it, with no "the" and nothing in brackets ("Mount Everest", "Nile", "Marie Curie").`,
  `- "kind": one or two words for what sort of thing it is ("mountain", "river", "scientist", "country").`,
  `- "property": one of the keys above.`,
  `- "stated": for a fact that names a thing rather than giving a number, the English name of what the passage says it is, as an encyclopedia titles it ("Canberra", "Alexander Fleming", "Pacific Ocean"). Otherwise "". A fact with a "stated" name has "value" 0 and "unit" "${NO_UNIT}".`,
  `- "value": the number as a plain number ("4.5 million" is 4500000). For a date, the year, negative for BC ("2560 BC" is -2560; "4.5 billion years ago" is -4500000000).`,
  `- "unit": the unit the passage uses, one of: ${CLAIM_UNITS.join(", ")}. Use "${NO_UNIT}" for a population and for dates.`,
  `- "month" and "day": for a date given to the month or the day, the month (1 to 12) and the day. Otherwise 0.`,
  `- "qualifier": "about" when the passage hedges ("about", "around", "almost", "nearly"), "more_than" for "more than" or "over", "less_than" for "less than", "under" or "up to", and "exact" otherwise.`,
];

/**
 * The Worker's prompt: every passage of a lesson, numbered.
 * @param {{ text: string }[]} passages
 * @param {string} [documentName]
 */
export function factCheckPrompt(passages, documentName) {
  const numbered = passages.map((p, i) => `[${i + 1}]\n${p.text}`).join("\n\n");
  const title = documentName ? ` The lesson is titled "${documentName}".` : "";
  return `The passages below come from a lesson for students.${title} List the facts in them that can be checked against Wikidata: a number, a date, or a named thing (a capital, a country, a discoverer) stated about one specific, named, real-world thing.

${KINDS_OF_FACT()}

Leave out everything else: opinions, comparisons ("bigger than a bus"), facts about a whole kind of thing ("cats sleep 16 hours a day"), numbers in a made-up story or a word problem, and anything that states neither a number, a date nor a named thing. If a passage has none, list nothing for it.

For each fact give:
${['- "passage": the number of the passage it is in.', ...FIELD_LINES()].join("\n")}

Passages:

${numbered}`;
}

/**
 * The on-device model's instructions, its system turn. LFM2 Extract models
 * take the schema and the rules there and the document as the user turn.
 */
export function passageClaimsSystemPrompt() {
  return `The user gives you one passage from a lesson for students, after the lesson's title. List the facts in it that can be checked against Wikidata: a number, a date, or a named thing (a capital, a country, a discoverer) stated about one specific, named, real-world thing.

${KINDS_OF_FACT()}

Leave out everything else: opinions, comparisons ("bigger than a bus"), facts about a whole kind of thing ("cats sleep 16 hours a day"), numbers in a made-up story or a word problem, and anything that states neither a number, a date nor a named thing. If the passage has none, return an empty list.

For each fact give:
${FIELD_LINES().join("\n")}

Return data as a JSON object with the following schema:
${JSON.stringify(PASSAGE_CLAIMS_SCHEMA)}`;
}

/** The user turn: the lesson's title, then the passage. */
export function passageClaimsText(passage, documentName = "") {
  return `Lesson: ${documentName || "Untitled lesson"}\n\n${passage}`;
}

export function passageClaimsMessages(passage, documentName) {
  return [
    { role: "system", content: passageClaimsSystemPrompt() },
    { role: "user", content: passageClaimsText(passage, documentName) },
  ];
}

/**
 * A claim with exactly the on-device schema's fields, in its order: what a
 * training target holds and what a reply is read back into.
 */
export function passageClaim(raw) {
  return Object.fromEntries(
    Object.keys(CLAIM_FIELDS).map((key) => [key, raw?.[key]]),
  );
}

/**
 * The claims in a model's reply to passageClaimsMessages, or null when the
 * reply is not JSON or holds no list of claims (a shape of the model's own).
 * A reply cut off mid-list keeps the claims it finished.
 * @returns {object[] | null}
 */
export function parseClaimsReply(raw) {
  const json = parseModelJson(raw);
  if (!json) return null;
  const claims = Array.isArray(json) ? json : json.claims;
  return Array.isArray(claims)
    ? claims.filter((c) => c && typeof c === "object").map(passageClaim)
    : null;
}

/**
 * Find each claim's passage by its quote. A model sometimes numbers a passage
 * wrong, so a quote found elsewhere is moved there; one found nowhere is
 * dropped, since the author would be shown a fact the lesson never stated.
 *
 * Matched with squashText, the same way the editor later asks whether the
 * quote is still there, so a placed finding can't read as changed. `passage`
 * comes back as an index into `passages`, and "none" as an empty unit.
 */
export function placeClaims(claims, passages) {
  const texts = passages.map((p) => squashText(p.text));
  const out = [];
  for (const claim of claims || []) {
    const quote = squashText(claim?.quote);
    if (!quote) continue;
    const stated = Number(claim.passage) - 1;
    const index = texts[stated]?.includes(quote)
      ? stated
      : texts.findIndex((t) => t.includes(quote));
    if (index === -1) continue;
    out.push({
      ...claim,
      passage: index,
      unit: claim.unit === NO_UNIT ? "" : claim.unit,
    });
  }
  return out;
}
