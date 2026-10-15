// The Node half of `#image-codec-wasm` (see package.json's "imports",
// ../imageConvert.js and ../og/picture.js).
//
// Node has no wasm-module loader for imports, so each codec's binary is read off
// disk and compiled here. The result is the same `WebAssembly.Module` the
// Workers half gets from wrangler's bundler, so @jsquash's `init()` is handed
// the same thing on both hosts and never falls back to fetching the binary
// itself.
//
// Compiling is deferred and memoized rather than done at import time: the
// binaries are about 850 KB together, and an instance that never receives an
// image upload or a link-preview request should not pay for them at startup. A
// failed compile clears its slot so the next call retries (`once`), matching
// how imageConvert.js treats a failed init.

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { once } from '../lib/once.js';

// Resolution goes through `createRequire` rather than `import.meta.resolve`,
// which looks like the more modern choice and is the wrong one here: bundlers and
// test transforms rewrite `import.meta` into a plain object, and the `resolve`
// method does not survive the trip. `createRequire` is an ordinary import that
// nothing rewrites, and it answers the same question.
const resolve = createRequire(import.meta.url).resolve;

/**
 * A loader that compiles one codec binary the first time it is called, resolved
 * through Node's own module resolution so the path holds wherever the package
 * manager put it: pnpm's layout is not `node_modules/<name>` and hardcoding
 * that would work only by accident.
 *
 * @param {string} specifier A bare specifier for the .wasm file.
 * @returns {() => Promise<WebAssembly.Module>}
 */
function compiler(specifier) {
	return once(async () => await WebAssembly.compile(await readFile(resolve(specifier))));
}

export const webpEncoderWasm = compiler('@jsquash/webp/codec/enc/webp_enc_simd.wasm');
export const webpDecoderWasm = compiler('@jsquash/webp/codec/dec/webp_dec.wasm');
// One squoosh module decodes and encodes PNG; @jsquash/png's decode.js and
// encode.js each instantiate it for themselves.
export const pngCodecWasm = compiler('@jsquash/png/codec/pkg/squoosh_png_bg.wasm');
export const jpegDecoderWasm = compiler('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm');
