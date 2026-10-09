// The Worker's half of fact checking: turning a lesson's passages into claims.
//
// Checking a claim against Wikidata is deterministic and lives in
// @spelling-creator/core/factCheck, shared with the MCP server. Finding the
// claims in prose is not, so this asks the configured AI provider to list them,
// constrained by a schema to the properties and units the checker understands.
// The prompt and schema are core's (factClaims.js), shared with the on-device
// model's training scripts.
//
// The model only ever extracts. It never says whether a fact is right, and a
// claim whose quote isn't actually in the passage is dropped before anything is
// looked up, so an invented fact can't reach the author as a finding.

import { checkClaims } from '@spelling-creator/core/factCheck';
import { FACT_CLAIMS_SCHEMA, factCheckPrompt, placeClaims } from '@spelling-creator/core/factClaims';
import { generateWithFallback } from './ai/index.js';

export { FACT_CLAIMS_SCHEMA, factCheckPrompt, placeClaims };

// Wikimedia's User-Agent policy wants a name and a way to reach the operator;
// requests without one are throttled or refused.
const USER_AGENT = 'SpellingCreator/1.0 (https://spellingcreator.org; lesson fact checking)';

// Bounds on one request, so a huge lesson can't turn into a huge prompt or a
// flood of Wikidata lookups.
export const MAX_PASSAGES = 60;
const MAX_PASSAGE_CHARS = 4000;
const MAX_TOTAL_CHARS = 40000;
const MAX_CLAIMS = 40;

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
