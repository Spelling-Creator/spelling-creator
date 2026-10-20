// Small response builders shared across every route. Both carry the request's
// CORS headers so a cross-origin caller from our own domain can read the result.

/**
 * Build a plain-text error Response carrying the request's CORS headers. The
 * client surfaces `res.text()` directly, so the message is user-facing.
 */
export function textResponse(msg, status, cors) {
	const headers = new Headers(cors);
	headers.set('Content-Type', 'text/plain');
	return new Response(msg, { status, headers });
}

/**
 * Build a JSON Response carrying the request's CORS headers. Used by the lesson
 * hub endpoints, which return JSON on success and plain text (via textResponse)
 * on error — matching the AI/Pixabay convention the frontend already surfaces.
 */
export function jsonResponse(obj, status, cors) {
	const headers = new Headers(cors);
	headers.set('Content-Type', 'application/json');
	return new Response(JSON.stringify(obj), { status, headers });
}

/**
 * Read a response body that somebody else's server is sending, up to a cap.
 *
 * `arrayBuffer()` or `text()` would buffer whatever arrives before anything
 * could compare it with a limit, and a server that sends no Content-Length
 * and never stops would have this process hold it all. This reads chunk by
 * chunk and gives up, cancelling the stream, as soon as the running total
 * passes `maxBytes`.
 *
 * @param {Response} response
 * @param {number} maxBytes
 * @returns {Promise<Uint8Array | null>} the bytes, or null when the body is
 *   larger than `maxBytes`
 */
export async function readCapped(response, maxBytes) {
	if (Number(response.headers.get('content-length') || 0) > maxBytes) {
		await response.body?.cancel().catch(() => {});
		return null;
	}
	if (!response.body) return new Uint8Array(0);
	const reader = response.body.getReader();
	const chunks = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel().catch(() => {});
			return null;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}
