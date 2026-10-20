// Content-addressed image storage helpers. Lesson images live in the object
// store keyed by the SHA-256 of their (pre-conversion) bytes; the browser
// computes the same hash (web/src/lib/imageStore.js), so an object key is
// verifiable from its bytes.

import { convertImageToWebp } from '../imageConvert.js';
import { imageStore } from '../platform/index.js';

// A valid image object key is a 64-char lowercase hex SHA-256.
export const IMAGE_HASH_RE = /^[0-9a-f]{64}$/;
// Cap a single image so one PUT can't fill the bucket. The one copy of the
// number lives in core, so the editor refuses what this would refuse.
export { MAX_IMAGE_BYTES } from '@spelling-creator/core/image';

// Lowercase hex SHA-256 of the given bytes, which matches the hash the browser
// computes (web/src/lib/imageStore.js) so a content-addressed object key is
// verifiable from its bytes. Re-exported for the routes that hash images.
export { sha256Hex } from './crypto.js';

// Store image bytes under their content-hash key, first compressing them to WEBP
// (convertImageToWebp falls back to the original bytes for formats it can't
// transcode or when WEBP wouldn't be smaller). The key stays the ORIGINAL hash —
// lesson docs reference images by the hash of their pre-conversion bytes, so only
// the stored bytes and Content-Type change, transparently to readers.
// Idempotent: an object already at this key holds a prior (converted) upload, so
// skip both the conversion work and the write.
export async function putImageObject(env, hash, bytes, mime) {
	const images = imageStore(env);
	if (await images.head(hash)) return;
	const converted = await convertImageToWebp(bytes, mime);
	await images.put(hash, converted.bytes, { contentType: converted.contentType });
}

// The docx ext rules, shared with the web editor and the MCP server so every
// writer stores the same ext for the same mime.
export { extFromMime } from '@spelling-creator/core/image';

// Split a base64/percent-encoded data URL into raw bytes + mime (server side).
export function decodeDataUrl(dataUrl) {
	const comma = dataUrl.indexOf(',');
	if (comma === -1) return null;
	const header = dataUrl.slice(5, comma);
	const mime = header.split(';')[0] || 'image/png';
	const payload = dataUrl.slice(comma + 1);
	let bytes;
	if (/;base64/i.test(header)) {
		const binary = atob(payload);
		bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	} else {
		bytes = new TextEncoder().encode(decodeURIComponent(payload));
	}
	return { bytes, mime };
}
