// The @jsquash codecs a card needs, each initialized once per isolate from the
// module `#image-codec-wasm` hands out (see ../codecs/ and ../imageConvert.js,
// which does the same for the upload path).
//
// A card decodes a lesson's picture (WEBP, JPEG or PNG) to shrink it, decodes
// the logo when it draws the SVG (see ./raster.js), and encodes the finished
// card as PNG. The PNG decoder and encoder share one squoosh module;
// wasm-bindgen's init returns the existing instance when asked twice, so the
// two inits below are one instantiation.

import decodeJpeg, { init as initJpegDecode } from '@jsquash/jpeg/decode.js';
import decodePng, { init as initPngDecode } from '@jsquash/png/decode.js';
import encodePng, { init as initPngEncode } from '@jsquash/png/encode.js';
import decodeWebp, { init as initWebpDecode } from '@jsquash/webp/decode.js';

import { jpegDecoderWasm, pngCodecWasm, webpDecoderWasm } from '#image-codec-wasm';

import { once } from '../lib/once.js';

/**
 * @typedef {(bytes: ArrayBuffer | Uint8Array) => Promise<{width: number, height: number, data: Uint8ClampedArray}>} Decoder
 */

/** @type {() => Promise<Decoder>} */
export const pngDecoder = once(async () => {
	await initPngDecode(await pngCodecWasm());
	return decodePng;
});

/** @type {() => Promise<(image: {width: number, height: number, data: Uint8ClampedArray}) => Promise<ArrayBuffer>>} */
export const pngEncoder = once(async () => {
	await initPngEncode(await pngCodecWasm());
	return encodePng;
});

/** @type {() => Promise<Decoder>} */
export const webpDecoder = once(async () => {
	await initWebpDecode(await webpDecoderWasm());
	return decodeWebp;
});

/** @type {() => Promise<Decoder>} */
export const jpegDecoder = once(async () => {
	await initJpegDecode(await jpegDecoderWasm());
	return decodeJpeg;
});
