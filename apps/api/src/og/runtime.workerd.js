// The Workers half of `#og-runtime` (see package.json's "imports" and
// ./render.js): what a link-preview card needs from the host that the two hosts
// get differently. Satori's layout engine and the fonts it draws with.
//
// wrangler's bundler hands a `.wasm` import over as an already-compiled
// `WebAssembly.Module`, which is the only way to run WebAssembly in the Workers
// sandbox: compiling bytes at runtime is not allowed, and Satori's default
// entry does exactly that (it carries its engine as a base64 string). Hence
// `satori/standalone`, which takes the module from us instead. The `.woff`
// imports arrive as ArrayBuffers through the Data rule in wrangler.jsonc.

import LAYOUT_WASM from 'satori/yoga.wasm';

import FRAUNCES_600 from '@fontsource/fraunces/files/fraunces-latin-600-normal.woff';
import FRAUNCES_600_EXT from '@fontsource/fraunces/files/fraunces-latin-ext-600-normal.woff';
import PUBLIC_SANS_400 from '@fontsource/public-sans/files/public-sans-latin-400-normal.woff';
import PUBLIC_SANS_400_EXT from '@fontsource/public-sans/files/public-sans-latin-ext-400-normal.woff';
import PUBLIC_SANS_600 from '@fontsource/public-sans/files/public-sans-latin-600-normal.woff';
import PUBLIC_SANS_600_EXT from '@fontsource/public-sans/files/public-sans-latin-ext-600-normal.woff';

import { FONT_FILES } from './fonts.js';

// The same list as FONT_FILES, in the same order, with each file's bytes. The
// imports have to be static for the bundler to see them, so the pairing is by
// position; fonts.js is the one place that says which files these are.
const FONT_DATA = [FRAUNCES_600, FRAUNCES_600_EXT, PUBLIC_SANS_400, PUBLIC_SANS_400_EXT, PUBLIC_SANS_600, PUBLIC_SANS_600_EXT];

/** The compiled layout engine Satori's standalone build is initialized with. */
export const layoutWasm = async () => LAYOUT_WASM;

/** The fonts the cards are set in, as Satori wants them. */
export const fontFiles = async () =>
	FONT_FILES.map((font, i) => ({ name: font.name, weight: font.weight, style: 'normal', data: FONT_DATA[i] }));
