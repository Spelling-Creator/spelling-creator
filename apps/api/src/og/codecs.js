// The @jsquash codecs a card needs, each initialised once per isolate from the
// module `#image-codec-wasm` hands out (see ../codecs/ and ../imageConvert.js,
// which does the same for the upload path).
//
// A card decodes a lesson's picture (WEBP, JPEG or PNG) to shrink it, encodes
// it as PNG for Satori, decodes that PNG again when it draws the SVG (see
// ./raster.js), and encodes the finished card as PNG. The PNG decoder and
// encoder share one squoosh module; wasm-bindgen's init returns the existing
// instance when asked twice, so the two inits below are one instantiation.
//
// Each init is memoised and a failed one clears its slot so the next request
// retries rather than failing forever on a transient error.

import decodeJpeg, { init as initJpegDecode } from '@jsquash/jpeg/decode.js';
import decodePng, { init as initPngDecode } from '@jsquash/png/decode.js';
import encodePng, { init as initPngEncode } from '@jsquash/png/encode.js';
import decodeWebp, { init as initWebpDecode } from '@jsquash/webp/decode.js';

import { jpegDecoderWasm, pngCodecWasm, webpDecoderWasm } from '#image-codec-wasm';

/** @type {Map<string, Promise<unknown>>} */
const ready = new Map();

function once(key, start) {
	let pending = ready.get(key);
	if (!pending) {
		pending = start().catch((e) => {
			ready.delete(key);
			throw e;
		});
		ready.set(key, pending);
	}
	return pending;
}

/** @returns {Promise<(bytes: ArrayBuffer | Uint8Array) => Promise<{width: number, height: number, data: Uint8ClampedArray}>>} */
export function pngDecoder() {
	return once('png-decode', async () => {
		await initPngDecode(await pngCodecWasm());
		return decodePng;
	});
}

/** @returns {Promise<(image: {width: number, height: number, data: Uint8ClampedArray}) => Promise<ArrayBuffer>>} */
export function pngEncoder() {
	return once('png-encode', async () => {
		await initPngEncode(await pngCodecWasm());
		return encodePng;
	});
}

/** @returns {Promise<(bytes: ArrayBuffer | Uint8Array) => Promise<{width: number, height: number, data: Uint8ClampedArray}>>} */
export function webpDecoder() {
	return once('webp-decode', async () => {
		await initWebpDecode(await webpDecoderWasm());
		return decodeWebp;
	});
}

/** @returns {Promise<(bytes: ArrayBuffer | Uint8Array) => Promise<{width: number, height: number, data: Uint8ClampedArray}>>} */
export function jpegDecoder() {
	return once('jpeg-decode', async () => {
		await initJpegDecode(await jpegDecoderWasm());
		return decodeJpeg;
	});
}
