import { sha256Hex } from './crypto.js';

/**
 * Build a stable, case-insensitive cache key from the inputs that actually
 * determine the AI answer. Each part is trimmed and lower-cased before hashing,
 * so the same information in different casing or with surrounding whitespace
 * maps to the same entry. The challenge token and client IP are deliberately
 * excluded — they gate access but do not change the generated content. The
 * inputs are hashed (rather than concatenated) so the key stays within KV's
 * key-length limit even when `sectionText` is long.
 */
export async function cacheKey(parts) {
	const norm = parts
		.map((p) =>
			String(p ?? '')
				.trim()
				.toLowerCase(),
		)
		.join(' ');
	return `cache:${await sha256Hex(norm)}`;
}

// Part of a text suggestion's cache key. Bump it when the text prompt changes
// what it writes, so answers to the old prompt aren't served for 30 days.
// v2: the text no longer names the lesson by its title.
const TEXT_CACHE_VERSION = 'v2';

/**
 * The cache key of a text suggestion. One function, because the AI route
 * writes it and the thumbs-down route (routes/feedback.js) has to find it.
 */
export function textCacheKey(subject, documentName) {
	return cacheKey(['text', TEXT_CACHE_VERSION, subject, documentName]);
}
