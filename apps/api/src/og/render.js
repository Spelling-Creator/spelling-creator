// Draw a card: Satori lays the element tree out and writes it as SVG, with
// every glyph already turned into a path; ./raster.js draws that SVG; the
// PNG encoder the upload path already ships writes the bytes.
//
// Satori's standalone build is used on both hosts. Its default entry carries
// the layout engine as a base64 string and compiles it at runtime, which the
// Workers sandbox forbids; the standalone one takes a compiled module from us.
// Where that module and the fonts come from is the one part that differs per
// host, and it lives behind `#og-runtime` (see package.json and
// ./runtime.*.js), the same arrangement as `#image-codec-wasm`.
//
// Satori is held at 0.32, the last release whose standalone build runs on
// Workers. From 0.33 it bundles a HarfBuzz shaper that it compiles from bytes
// at import time, which workerd refuses (vercel/satori#878); the open PR #931
// adds `init({ layout, harfbuzz })` and a `satori/harfbuzz.wasm` export. Once
// that ships, the upgrade is: lift the pin, import that module in
// runtime.workerd.js (and read it off disk in runtime.node.js), and pass both
// to `init` here. 0.32 lays out with Yoga, so its module is `satori/yoga.wasm`.

import satori, { init } from 'satori/standalone';

import { fontFiles, layoutWasm } from '#og-runtime';

import { once } from '../lib/once.js';
import { CARD_HEIGHT, CARD_WIDTH } from './card.js';
import { jpegDecoder, pngDecoder, pngEncoder } from './codecs.js';
import { PICTURE_KEY } from './card.js';
import { placeholderKey } from './placeholder.js';
import { rasterize } from './raster.js';

const ensureReady = once(async () => init(await layoutWasm()));

/**
 * Lay a card tree out as SVG. Exported for the tests, which check what the
 * rasterizer is asked to draw.
 * @param {object} tree
 * @returns {Promise<string>}
 */
export async function renderSvg(tree) {
	const [, fonts] = await Promise.all([ensureReady(), fontFiles()]);
	return await satori(tree, { width: CARD_WIDTH, height: CARD_HEIGHT, fonts });
}

/**
 * Render a card tree (see ./card.js) to PNG bytes.
 *
 * @param {object} tree
 * @param {object} [opts]
 * @param {import('./picture.js').Picture | null} [opts.picture] The decoded
 *   lesson picture the tree's placeholder stands for (see ./placeholder.js).
 * @returns {Promise<Uint8Array>}
 */
export async function renderCard(tree, { picture = null } = {}) {
	const svg = await renderSvg(tree);
	// The images in the SVG are the logo, a PNG, and the picture's placeholder,
	// which stands for pixels already in hand. JPEG is accepted in case a
	// caller hands one straight through.
	const decodeImage = async (bytes, type) => {
		if (placeholderKey(bytes) === PICTURE_KEY) {
			if (!picture) throw new Error('The card has a picture placeholder but no picture was given.');
			return picture;
		}
		if (type === 'image/png') return (await pngDecoder())(bytes);
		if (type === 'image/jpeg' || type === 'image/jpg') return (await jpegDecoder())(bytes);
		throw new Error(`A card cannot draw a ${type} image; give it a PNG.`);
	};
	const image = await rasterize(svg, { decodeImage });
	return new Uint8Array(await (await pngEncoder())(image));
}
