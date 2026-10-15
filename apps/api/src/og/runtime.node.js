// The Node half of `#og-runtime` (see package.json's "imports" and ./render.js):
// what a link-preview card needs from the host that the two hosts get
// differently. Satori's layout engine, the fonts it draws with, and the logo.
//
// Everything is read off disk and resolved through Node's own module
// resolution, like ../codecs/wasm.node.js, so the paths hold wherever pnpm put
// the packages. Loading is deferred and memoised: a self-hosted instance that
// no scraper ever asks for a preview should not pay for any of it at startup.

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { FONT_FILES } from './fonts.js';

const require = createRequire(import.meta.url);

/** @type {Map<string, Promise<unknown>>} */
const loaded = new Map();

function once(key, start) {
	let pending = loaded.get(key);
	if (!pending) {
		pending = start().catch((e) => {
			loaded.delete(key);
			throw e;
		});
		loaded.set(key, pending);
	}
	return pending;
}

async function bytesOf(path) {
	const bytes = await readFile(path);
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** The compiled layout engine Satori's standalone build is initialised with. */
export function layoutWasm() {
	return once('layout', async () => await WebAssembly.compile(await readFile(require.resolve('satori/yoga.wasm'))));
}

/** The fonts the cards are set in, as Satori wants them. */
export function fontFiles() {
	return once('fonts', () =>
		Promise.all(
			FONT_FILES.map(async (font) => ({
				name: font.name,
				weight: font.weight,
				style: 'normal',
				data: await bytesOf(require.resolve(font.file)),
			})),
		),
	);
}

/** The app icon, as PNG bytes, for the brand row. */
export function logoPng() {
	return once('logo', () => bytesOf(new URL('./logo.png', import.meta.url)));
}
