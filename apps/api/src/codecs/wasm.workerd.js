// The Workers half of `#image-codec-wasm` (see package.json's "imports",
// ../imageConvert.js and ../og/picture.js).
//
// wrangler resolves a `.wasm` import to an already-compiled `WebAssembly.Module`
// at bundle time, which is exactly what @jsquash's `init()` wants — and it is the
// only way to do this in the Workers sandbox, where the Emscripten glue's own
// fallback of fetching the binary at runtime is not allowed.
//
// The functions are async only so that both halves of this module have the same
// signature; there is nothing to wait for here.

import WEBP_ENC_WASM from '@jsquash/webp/codec/enc/webp_enc_simd.wasm';
import WEBP_DEC_WASM from '@jsquash/webp/codec/dec/webp_dec.wasm';
import PNG_WASM from '@jsquash/png/codec/pkg/squoosh_png_bg.wasm';
import JPEG_DEC_WASM from '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm';

export const webpEncoderWasm = async () => WEBP_ENC_WASM;
export const webpDecoderWasm = async () => WEBP_DEC_WASM;
// One squoosh module decodes and encodes PNG; @jsquash/png's decode.js and
// encode.js each instantiate it for themselves.
export const pngCodecWasm = async () => PNG_WASM;
export const jpegDecoderWasm = async () => JPEG_DEC_WASM;
