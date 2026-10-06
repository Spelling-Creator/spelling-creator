// The Worker's half of fact checking: turning a lesson's passages into claims.
//
// Checking a claim against Wikidata is deterministic and lives in
// @spelling-creator/core/factCheck, shared with the MCP server. Finding the
// claims in prose is not, so this asks the configured AI provider to list them,
// constrained by a schema to the properties and units the checker understands.
//
// The model only ever extracts. It never says whether a fact is right, and a
// claim whose quote isn't actually in the passage is dropped before anything is
// looked up, so an invented fact can't reach the author as a finding.

import {
	FACT_PROPERTIES,
	FACT_PROPERTY_KEYS,
	FACT_QUALIFIERS,
	FACT_UNIT_KEYS,
	checkClaims,
	squashText,
} from '@spelling-creator/core/factCheck';
import { generateWithFallback } from './ai/index.js';

// Wikimedia's User-Agent policy wants a name and a way to reach the operator;
// requests without one are throttled or refused.
const USER_AGENT = 'SpellingCreator/1.0 (https://spellingcreator.org; lesson fact checking)';

// Bounds on one request, so a huge lesson can't turn into a huge prompt or a
// flood of Wikidata lookups.
export const MAX_PASSAGES = 60;
const MAX_PASSAGE_CHARS = 4000;
const MAX_TOTAL_CHARS = 40000;
const MAX_CLAIMS = 40;

// A unit-less claim (a population, a date) says "none" to the model: an empty
// string is a legal enum value in JSON Schema but not one every provider
// accepts.
const NO_UNIT = 'none';
const CLAIM_UNITS = FACT_UNIT_KEYS.map((key) => key || NO_UNIT);

export const FACT_CLAIMS_SCHEMA = {
	type: 'object',
	properties: {
		claims: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					passage: { type: 'integer' },
					quote: { type: 'string' },
					subject: { type: 'string' },
					kind: { type: 'string' },
					property: { type: 'string', enum: FACT_PROPERTY_KEYS },
					value: { type: 'number' },
					unit: { type: 'string', enum: CLAIM_UNITS },
					month: { type: 'integer' },
					day: { type: 'integer' },
					qualifier: { type: 'string', enum: FACT_QUALIFIERS },
				},
				required: ['passage', 'quote', 'subject', 'kind', 'property', 'value', 'unit', 'month', 'day', 'qualifier'],
				additionalProperties: false,
			},
		},
	},
	required: ['claims'],
	additionalProperties: false,
};

/**
 * The request's passages, trimmed to what one check will read. Anything that
 * isn't a non-empty string is dropped; `blockId` is the client's and is only
 * echoed back.
 * @returns {{ blockId: string, text: string }[]}
 */
export function cleanPassages(raw) {
	if (!Array.isArray(raw)) return [];
	const out = [];
	let total = 0;
	for (const p of raw.slice(0, MAX_PASSAGES)) {
		const text = typeof p?.text === 'string' ? p.text.trim().slice(0, MAX_PASSAGE_CHARS) : '';
		if (!text) continue;
		if (total + text.length > MAX_TOTAL_CHARS) break;
		total += text.length;
		out.push({ blockId: typeof p.blockId === 'string' ? p.blockId.slice(0, 100) : '', text });
	}
	return out;
}

export function factCheckPrompt(passages, documentName) {
	const properties = FACT_PROPERTY_KEYS.map((key) => `- ${key}: ${FACT_PROPERTIES[key].hint}`).join('\n');
	const units = CLAIM_UNITS.join(', ');
	const numbered = passages.map((p, i) => `[${i + 1}]\n${p.text}`).join('\n\n');
	const title = documentName ? ` The lesson is titled "${documentName}".` : '';
	return `The passages below come from a lesson for students.${title} List the facts in them that can be checked against Wikidata: a number or a date stated about one specific, named, real-world thing.

Only these kinds of fact count. Use the matching "property":
${properties}

Leave out everything else: opinions, comparisons ("bigger than a bus"), facts about a whole kind of thing ("cats sleep 16 hours a day"), numbers in a made-up story or a word problem, and anything without a number or date. If a passage has none, list nothing for it.

For each fact give:
- "passage": the number of the passage it is in.
- "quote": the shortest words from the passage that state the number or date, copied exactly, keeping its capital letters ("8,849 METRES").
- "subject": the English name of the thing, the way an encyclopedia titles it, with no "the" and nothing in brackets ("Mount Everest", "Nile", "Marie Curie").
- "kind": one or two words for what sort of thing it is ("mountain", "river", "scientist", "country").
- "property": one of the keys above.
- "value": the number as a plain number ("4.5 million" is 4500000). For a date, the year, negative for BC ("2560 BC" is -2560; "4.5 billion years ago" is -4500000000).
- "unit": the unit the passage uses, one of: ${units}. Use "${NO_UNIT}" for a population and for dates.
- "month" and "day": for a date given to the month or the day, the month (1 to 12) and the day. Otherwise 0.
- "qualifier": "about" when the passage hedges ("about", "around", "almost", "nearly"), "more_than" for "more than" or "over", "less_than" for "less than", "under" or "up to", and "exact" otherwise.

Passages:

${numbered}`;
}

/**
 * Find each claim's passage by its quote. A model sometimes numbers a passage
 * wrong, so a quote found elsewhere is moved there; one found nowhere is
 * dropped, since the author would be shown a fact the lesson never stated.
 *
 * Matched with core's squashText, the same way the editor later asks whether
 * the quote is still there, so a placed finding can't read as changed.
 */
export function placeClaims(claims, passages) {
	const texts = passages.map((p) => squashText(p.text));
	const out = [];
	for (const claim of claims || []) {
		const quote = squashText(claim?.quote);
		if (!quote) continue;
		const stated = Number(claim.passage) - 1;
		const index = texts[stated]?.includes(quote) ? stated : texts.findIndex((t) => t.includes(quote));
		if (index === -1) continue;
		out.push({ ...claim, passage: index, unit: claim.unit === NO_UNIT ? '' : claim.unit });
	}
	return out;
}

// Wikidata's answers change slowly; hold them at the edge for a day so a lesson
// checked twice, or two lessons about Everest, don't ask twice. The option is
// Cloudflare's and other runtimes ignore it.
const cachedFetch = (url, init) => fetch(url, { ...init, cf: { cacheTtl: 86400, cacheEverything: true } });

/**
 * Check a lesson's passages. Returns the facts with `passage` as an index into
 * `passages`; the caller adds whatever ids it needs.
 * @param {{ blockId: string, text: string }[]} passages  From cleanPassages.
 * @throws when no AI provider answers.
 */
export async function checkPassages(passages, documentName, env) {
	if (!passages.length) return [];
	const response = await generateWithFallback({
		prompt: factCheckPrompt(passages, documentName),
		schema: FACT_CLAIMS_SCHEMA,
		env,
	});
	const parsed = JSON.parse(response.text);
	return checkClaims(placeClaims(parsed?.claims, passages), {
		userAgent: USER_AGENT,
		fetch: cachedFetch,
		maxClaims: MAX_CLAIMS,
	});
}
