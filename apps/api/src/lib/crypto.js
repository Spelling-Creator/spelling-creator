// The few WebCrypto helpers this API uses in several places, kept in one copy.
//
// WebCrypto rather than node:crypto, because the same code runs in workerd and in
// Node: both have `crypto.subtle`, and only one of them has node:crypto.

const encoder = new TextEncoder();

const bytesOf = (data) => (typeof data === 'string' ? encoder.encode(data) : data);

/** Lowercase hex of a byte array or ArrayBuffer. */
export function hex(bytes) {
	return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Lowercase hex SHA-256 of bytes or a string. */
export async function sha256Hex(data) {
	return hex(await crypto.subtle.digest('SHA-256', bytesOf(data)));
}

/**
 * HMAC-SHA-256 of `message` under `key`, as raw bytes, so a derivation chain
 * (SigV4's signing key) can feed one result in as the next key.
 *
 * @param {string | Uint8Array} key
 * @param {string | Uint8Array} message
 * @returns {Promise<Uint8Array>}
 */
export async function hmac(key, message) {
	const cryptoKey = await crypto.subtle.importKey('raw', bytesOf(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, bytesOf(message)));
}

/** HMAC-SHA-256 as lowercase hex. */
export async function hmacHex(key, message) {
	return hex(await hmac(key, message));
}
