// A lesson's picture, in the form the card draws: decoded RGBA, no larger
// than twice the slot it fills.
//
// Lesson images are stored as WEBP (see ../imageConvert.js), with PNG and JPEG
// passing through from before that conversion existed. Whatever the format,
// the picture is decoded here with the same @jsquash codec family the upload
// path uses and shrunk to twice the size it is drawn at. The decoded pixels go
// straight to the rasterizer; Satori gets a placeholder of the same size (see
// ./placeholder.js) rather than a re-encoded PNG. A GIF or an SVG is left out:
// there is no decoder for the one and no reason to risk the other.
//
// The limits are about memory, not taste. A Worker has 128 MB, a decoded image
// is four bytes per pixel, and an 8 MB upload can hold a great many pixels.
// The dimensions are read from the header before anything is decoded, so an
// image that would not fit is skipped instead of attempted.
//
// Nothing here throws to its caller: a picture that cannot be loaded means a
// card without a picture, never a link without a preview.

import { jpegDecoder, pngDecoder, webpDecoder } from './codecs.js';

/**
 * @typedef {object} Picture
 * @property {number} width
 * @property {number} height
 * @property {Uint8ClampedArray} data Straight-alpha RGBA.
 */

/** Longest side of the picture handed to the card, in pixels. Twice the slot it is drawn in. */
export const PICTURE_SIDE = 880;

// Past this the response is not read at all.
const MAX_BYTES = 6 * 1024 * 1024;
// Past either of these an image is not decoded: 8 million pixels is 32 MB of RGBA.
const MAX_SIDE = 4096;
const MAX_PIXELS = 8_000_000;

/**
 * The hash of the first image block in a lesson document, or null.
 * @param {object | null | undefined} doc
 * @returns {string | null}
 */
export function firstPictureHash(doc) {
	for (const section of doc?.sections || []) {
		for (const block of section?.blocks || []) {
			if (block?.type === 'image' && typeof block.image?.hash === 'string' && block.image.hash) {
				return block.image.hash;
			}
		}
	}
	return null;
}

const ascii = (bytes, at, len) => String.fromCharCode(...bytes.subarray(at, at + len));

/**
 * The pixel size recorded in a WEBP's header, without decoding it. Handles the
 * three container layouts: lossy (VP8), lossless (VP8L) and extended (VP8X,
 * which carries alpha or metadata and is what the upload path writes for a
 * picture with transparency).
 *
 * @param {Uint8Array} bytes
 * @returns {{width: number, height: number} | null} Null if this is not a WEBP it can read.
 */
export function webpDimensions(bytes) {
	if (bytes.length < 30) return null;
	if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const chunk = ascii(bytes, 12, 4);
	if (chunk === 'VP8X') {
		// 24-bit little-endian canvas width minus one at bytes 24 to 26, then
		// height minus one at bytes 27 to 29.
		const width = (view.getUint16(24, true) | (bytes[26] << 16)) + 1;
		const height = (view.getUint16(27, true) | (bytes[29] << 16)) + 1;
		return { width, height };
	}
	if (chunk === 'VP8L') {
		// 14 bits of width minus one, then 14 bits of height minus one, after the
		// signature byte at 20.
		const bits = view.getUint32(21, true);
		return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
	}
	if (chunk === 'VP8 ') {
		// The key frame header: 14 bits of width at 26, 14 bits of height at 28.
		return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
	}
	return null;
}

/**
 * The pixel size in a PNG's IHDR chunk, or null if this is not a PNG.
 * @param {Uint8Array} bytes
 */
export function pngDimensions(bytes) {
	if (bytes.length < 24) return null;
	const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	if (!magic.every((b, i) => bytes[i] === b)) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * The pixel size from a JPEG's first frame header (SOF0 through SOF15, less
 * the markers that are not frames), or null if this is not a JPEG or the
 * header is not found.
 * @param {Uint8Array} bytes
 */
export function jpegDimensions(bytes) {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let at = 2;
	// A frame header is nine bytes from its marker: marker, length, precision,
	// height, width. The loop runs while all nine are there.
	while (at + 9 <= bytes.length) {
		if (bytes[at] !== 0xff) return null;
		const marker = bytes[at + 1];
		if (marker === 0xff) {
			at += 1;
			continue;
		}
		const length = view.getUint16(at + 2);
		const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
		if (isFrame) return { height: view.getUint16(at + 5), width: view.getUint16(at + 7) };
		at += 2 + length;
	}
	return null;
}

/**
 * Shrink RGBA pixels so the longest side is at most `maxSide`, averaging each
 * block of source pixels into one. The average is alpha-weighted: a
 * transparent pixel contributes its transparency but not its color, so the
 * (usually black) color stored under a transparent edge does not darken the
 * opaque pixels next to it. Returns the input untouched when it is already
 * small enough.
 *
 * @param {Picture} image
 * @param {number} maxSide
 * @returns {Picture}
 */
export function downscale(image, maxSide) {
	const { width, height, data } = image;
	const scale = Math.min(1, maxSide / Math.max(width, height));
	if (scale === 1) return image;
	const w = Math.max(1, Math.round(width * scale));
	const h = Math.max(1, Math.round(height * scale));
	const out = new Uint8ClampedArray(w * h * 4);
	for (let y = 0; y < h; y += 1) {
		const y0 = Math.floor((y * height) / h);
		const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / h));
		for (let x = 0; x < w; x += 1) {
			const x0 = Math.floor((x * width) / w);
			const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / w));
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			let n = 0;
			for (let yy = y0; yy < y1; yy += 1) {
				let i = (yy * width + x0) * 4;
				for (let xx = x0; xx < x1; xx += 1) {
					const alpha = data[i + 3];
					r += data[i] * alpha;
					g += data[i + 1] * alpha;
					b += data[i + 2] * alpha;
					a += alpha;
					i += 4;
					n += 1;
				}
			}
			const o = (y * w + x) * 4;
			if (a > 0) {
				out[o] = r / a;
				out[o + 1] = g / a;
				out[o + 2] = b / a;
			}
			out[o + 3] = a / n;
		}
	}
	return { width: w, height: h, data: out };
}

/** Which decoder reads these bytes, judged by their header rather than the server's say-so. */
function sniff(bytes) {
	let size = webpDimensions(bytes);
	if (size) return { size, decoder: webpDecoder };
	size = pngDimensions(bytes);
	if (size) return { size, decoder: pngDecoder };
	size = jpegDimensions(bytes);
	if (size) return { size, decoder: jpegDecoder };
	return null;
}

/**
 * Decode image bytes (WEBP, PNG or JPEG) and shrink them to at most
 * PICTURE_SIDE on the longest side.
 * @param {Uint8Array} bytes
 * @returns {Promise<Picture | null>} Null for a format with no decoder, or an image too large to decode safely.
 */
export async function toCardPicture(bytes) {
	const found = sniff(bytes);
	if (!found) return null;
	const { size, decoder } = found;
	if (size.width > MAX_SIDE || size.height > MAX_SIDE || size.width * size.height > MAX_PIXELS) return null;
	const decoded = await (await decoder())(bytes);
	return downscale(decoded, PICTURE_SIDE);
}

/**
 * Fetch a lesson image by hash and return it decoded and shrunk, or null.
 *
 * @param {string} origin The site's origin; images are served at /images/:hash.
 * @param {string} hash
 * @param {{fetch?: typeof fetch}} [opts] The fetch to use (tests substitute one).
 * @returns {Promise<Picture | null>}
 */
export async function loadPicture(origin, hash, { fetch: fetchFn = fetch } = {}) {
	try {
		const res = await fetchFn(`${origin}/images/${encodeURIComponent(hash)}`);
		if (!res.ok) return null;
		const declared = Number(res.headers.get('content-length') || 0);
		if (declared > MAX_BYTES) return null;
		const bytes = new Uint8Array(await res.arrayBuffer());
		if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;
		return await toCardPicture(bytes);
	} catch (err) {
		console.warn('Could not load a lesson picture for its preview card:', hash, err?.message || err);
		return null;
	}
}
