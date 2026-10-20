// Fedify's KvStore over Postgres, reached through PostgREST.
//
// Fedify keeps its own caches in a key-value store: remote actor documents and
// their public keys, which activities it has already processed, and which
// signature spec each remote server turned out to accept. On the hosted
// instance that is a Workers KV namespace through Fedify's own adapter; a
// self-hosted instance puts them in the same `kv_store` table the rate limiters
// use (see postgrestKv.js), for the same reasons that store goes through
// PostgREST: no new dependency, no connection pool, no second set of
// credentials, and nothing in it is authoritative. Every entry has a TTL, or is
// a cache whose loss costs one extra remote fetch.
//
// Fedify's interface is wider than the seam's KvStore: keys are arrays of
// strings, values are any JSON, and it can `list` a prefix. So this is its own
// adapter over the table rather than a wrapper around the seam's, and the key
// encoding below is what makes the prefix listing safe against a LIKE pattern.

import { isExpired } from './kv.js';

const TABLE = 'kv_store';

// Every stored key starts with this, so Fedify's rows can never collide with a
// rate-limit bucket or an OAuth state entry sharing the table.
const PREFIX = 'fedify/';

/**
 * Encode one key segment so the joined key contains none of the characters a
 * SQL LIKE pattern treats specially (`%`, `_`, `\`), nor the separator. The
 * escape character is `~`, chosen because no Fedify key uses it; `~` itself is
 * escaped too, so the encoding is reversible.
 */
function encodeSegment(segment) {
	return String(segment).replace(/[~%_\\/]/g, (c) => `~${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

function decodeSegment(encoded) {
	return encoded.replace(/~([0-9a-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** The table key for a Fedify key. */
export function encodeKey(key) {
	return PREFIX + key.map(encodeSegment).join('/');
}

/** The Fedify key for a table key, or null when it is not one of ours. */
export function decodeKey(stored) {
	if (!stored.startsWith(PREFIX)) return null;
	return stored.slice(PREFIX.length).split('/').map(decodeSegment);
}

/**
 * A Fedify KvStore backed by a PostgREST table.
 *
 * @param {object} config
 * @param {string} config.url      Base URL of the PostgREST server (or Supabase project).
 * @param {string} config.apiKey   The service-role key.
 * @param {string} [config.table]  Defaults to 'kv_store'.
 * @param {number} [config.pageRows] Rows per request when listing. Defaults to
 *   500, under PostgREST's usual max-rows; smaller only in tests.
 * @param {typeof fetch} [config.fetch] Injectable for tests.
 */
export function postgrestFedifyKv(config) {
	const { url, apiKey, table = TABLE, pageRows = 500, fetch: doFetch = fetch } = config;
	const base = `${url.replace(/\/$/, '')}/rest/v1/${table}`;
	const headers = { apikey: apiKey, Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

	const rowUrl = (stored) => `${base}?key=eq.${encodeURIComponent(stored)}`;

	/** A row's value, or undefined when it is absent or past its expiry. */
	function liveValue(row) {
		if (!row) return undefined;
		const expiresAt = row.expires_at ? Math.floor(Date.parse(row.expires_at) / 1000) : 0;
		if (isExpired(expiresAt)) return undefined;
		try {
			return JSON.parse(row.value);
		} catch {
			return undefined;
		}
	}

	/** The rows a select answers, or none when the store cannot be reached. */
	async function readRows(url) {
		let response;
		try {
			response = await doFetch(url, { headers });
		} catch {
			return [];
		}
		if (!response.ok) return [];
		const rows = await response.json().catch(() => []);
		return Array.isArray(rows) ? rows : [];
	}

	async function remove(stored) {
		const response = await doFetch(rowUrl(stored), { method: 'DELETE', headers });
		if (!response.ok) {
			const detail = await response.text().catch(() => '');
			throw new Error(`fedify kv delete failed: ${response.status} ${detail.slice(0, 200)}`);
		}
	}

	return {
		async get(key) {
			// Unreachable reads as a miss, as the seam's store does: a cache that
			// cannot be read costs a remote fetch, where a throw would turn a database
			// blip into a failed delivery.
			let response;
			try {
				response = await doFetch(`${rowUrl(encodeKey(key))}&select=value,expires_at&limit=1`, { headers });
			} catch {
				return undefined;
			}
			if (!response.ok) return undefined;
			const rows = await response.json().catch(() => []);
			return liveValue(Array.isArray(rows) ? rows[0] : null);
		},

		async set(key, value, options) {
			// Fedify hands the TTL as a Temporal.Duration; `total` turns it into a
			// number without this module needing Temporal itself.
			const ttlMs = options?.ttl ? options.ttl.total('millisecond') : 0;
			const row = {
				key: encodeKey(key),
				value: JSON.stringify(value === undefined ? null : value),
				expires_at: ttlMs > 0 ? new Date(Date.now() + ttlMs).toISOString() : null,
			};
			const response = await doFetch(base, {
				method: 'POST',
				headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
				body: JSON.stringify(row),
			});
			if (!response.ok) {
				const detail = await response.text().catch(() => '');
				throw new Error(`fedify kv set failed: ${response.status} ${detail.slice(0, 200)}`);
			}
		},

		async delete(key) {
			await remove(encodeKey(key));
		},

		async *list(prefix) {
			// Keys under a prefix are the prefix itself and anything below it on a
			// segment boundary, as Fedify compares keys segment by segment:
			// ['_fedify', 'publicKey'] lists ['_fedify', 'publicKey', 'k'] and not
			// ['_fedify', 'publicKeyX']. `encodeSegment` escapes every `/` inside a
			// segment, so a literal `/` is always a boundary, and it leaves no LIKE
			// wildcard in a key, so `*` (PostgREST's spelling of `%`) matches exactly
			// what follows. An empty prefix lists everything of Fedify's and nothing
			// of anyone else's.
			const root = prefix && prefix.length ? encodeKey(prefix) : null;
			const select = 'select=key,value,expires_at';
			const toEntries = (rows) =>
				rows.flatMap((row) => {
					const value = liveValue(row);
					const key = decodeKey(row.key || '');
					return value === undefined || !key ? [] : [{ key, value }];
				});

			if (root) {
				for (const entry of toEntries(await readRows(`${base}?key=eq.${encodeURIComponent(root)}&${select}`))) yield entry;
			}

			// In pages, because PostgREST caps a response at its max-rows setting
			// without saying so, and a listing cut short would leave Fedify thinking
			// it had seen every entry.
			const pattern = encodeURIComponent(`${root ? `${root}/` : PREFIX}*`);
			for (let offset = 0; ; offset += pageRows) {
				const rows = await readRows(`${base}?key=like.${pattern}&${select}&order=key.asc&limit=${pageRows}&offset=${offset}`);
				for (const entry of toEntries(rows)) yield entry;
				if (rows.length < pageRows) return;
			}
		},
	};
}
