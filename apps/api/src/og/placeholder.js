// A stand-in for a picture that is already decoded.
//
// Satori takes an <img> source as bytes, reads the PNG header for the size,
// and writes the bytes into its SVG as a base64 data URI. A lesson picture is
// decoded and shrunk before the card is built (see ./picture.js), and encoding
// it to PNG only for Satori to base64 it and the rasterizer to decode it again
// would be three passes over a megabyte for nothing. So the card hands Satori
// a tiny PNG of the right size that carries a key in a tEXt chunk, and the
// rasterizer, when it meets that key, draws the decoded pixels it was given
// instead (see ./render.js).
//
// The placeholder is a valid PNG as far as a header reader is concerned: the
// signature, an IHDR with the real width and height, the key, an IDAT holding
// an empty deflate stream, and IEND. Nothing ever decodes its pixels.

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const KEYWORD = 'spelling-creator-picture';

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n += 1) {
		let c = n;
		for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(bytes) {
	let c = 0xffffffff;
	for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

/**
 * A placeholder PNG of the given size, tagged with `key`.
 * @param {number} width
 * @param {number} height
 * @param {string} key ASCII, no NUL.
 * @returns {ArrayBuffer}
 */
export function placeholderPng(width, height, key) {
	const ihdr = new Uint8Array(13);
	const view = new DataView(ihdr.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // color type: RGBA
	const text = new TextEncoder().encode(`${KEYWORD}\0${key}`);
	// An empty zlib stream: header, a final empty stored block, and the Adler-32 of nothing.
	const idat = new Uint8Array([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01]);
	const parts = [
		new Uint8Array(SIGNATURE),
		chunk('IHDR', ihdr),
		chunk('tEXt', text),
		chunk('IDAT', idat),
		chunk('IEND', new Uint8Array(0)),
	];
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out.buffer;
}

/**
 * The key a placeholder carries, or null for any other bytes.
 * @param {Uint8Array} bytes
 * @returns {string | null}
 */
export function placeholderKey(bytes) {
	if (bytes.length < 8 || !SIGNATURE.every((b, i) => bytes[i] === b)) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let at = 8;
	while (at + 12 <= bytes.length) {
		const length = view.getUint32(at);
		const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
		if (type === 'tEXt') {
			const text = new TextDecoder().decode(bytes.subarray(at + 8, at + 8 + length));
			const nul = text.indexOf('\0');
			if (text.slice(0, nul) === KEYWORD) return text.slice(nul + 1);
		}
		if (type === 'IDAT' || type === 'IEND') return null;
		at += 12 + length;
	}
	return null;
}
