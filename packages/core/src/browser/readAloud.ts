// The light half of Kokoro read-aloud: the device check, whether the model is
// already downloaded, and the one door to
// readAloudEngine.ts, which holds transformers.js and the model and so is only
// ever fetched by a dynamic import(), the same split as documentModel.ts and
// summarizer.ts.

import { meteredConnection, webGpuAdapter } from "./deviceCheck.ts";
import { MODEL_CACHE_NAME } from "./modelCache.ts";
import type {
  LoadReadAloudOptions,
  ReadAloudReader,
} from "./readAloudEngine.ts";
import {
  MODEL_ID,
  MODEL_REVISION,
  WEBGPU_DTYPE,
  type ReadAloudDtype,
} from "./readAloudVoices.ts";

export { VOICES, DEFAULT_VOICE } from "./readAloudVoices.ts";
export type { ReadAloudDtype, VoiceId } from "./readAloudVoices.ts";
export type {
  LoadReadAloudOptions,
  ReadAloudReader,
} from "./readAloudEngine.ts";

// The download, at the fp32 weights the engine loads on WebGPU, rounded the
// way the UI says it.
export const DOWNLOAD_MB = 330;

// How transformers.js names a model's weights for each dtype (its
// DEFAULT_DTYPE_SUFFIX_MAPPING, which it doesn't export), for the ones
// kokoro.js offers.
const DTYPE_SUFFIX = {
  fp32: "",
  fp16: "_fp16",
  q8: "_quantized",
  q4f16: "_q4f16",
} satisfies Record<ReadAloudDtype, string>;

/**
 * Where transformers.js fetches the weights for `dtype` from, which is also
 * the key it keeps them under in the shared model cache (modelCache.ts).
 */
export function weightsUrl(dtype: ReadAloudDtype = WEBGPU_DTYPE): string {
  return `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/onnx/model${DTYPE_SUFFIX[dtype]}.onnx`;
}

// User-Agent Client Hints, Chromium only, and not in the DOM lib.
interface UserAgentNavigator {
  readonly userAgentData?: { readonly mobile?: boolean };
}

// Phones and tablets are turned away by name, because WebGPU alone doesn't
// tell them apart: an iPad has it, and Kokoro froze and then crashed Safari on
// one. iPadOS asks for desktop sites by default, so it calls itself a Mac and
// gives itself away only by having a touch screen, which no Mac has.
function phoneOrTablet() {
  const nav = globalThis.navigator as
    | (Navigator & UserAgentNavigator)
    | undefined;
  if (!nav) return false;
  if (nav.userAgentData?.mobile) return true;
  const ua = nav.userAgent || "";
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return true;
  return /Macintosh/.test(ua) && nav.maxTouchPoints > 1;
}

/**
 * Whether this device should be offered Kokoro at all. Cheap, and answerable
 * without loading the engine. Kokoro needs WebGPU: on the single-threaded
 * WASM backend it is slower than speech even on a Mac. The adapter is asked
 * for once a page (deviceCheck.ts); the rest is read live, so asking again
 * before a download catches a connection that has since turned metered.
 * Fails closed.
 * @param options.download  False when the model is already in the cache
 *   (readAloudCached), since a metered connection only rules out downloading
 *   it, not loading it.
 */
export async function readAloudPossible({
  download = true,
}: { download?: boolean } = {}): Promise<boolean> {
  if (phoneOrTablet() || (download && meteredConnection())) return false;
  return Boolean(await webGpuAdapter());
}

/**
 * Whether the model is already downloaded, so loading it costs a couple of
 * seconds rather than a 330 MB download. The weights are nearly all of it, and
 * transformers.js stores each file whole, so finding them is the answer; the
 * small files beside them are quick to fetch again if they've gone. False
 * wherever Cache Storage can't be read.
 */
export async function readAloudCached(): Promise<boolean> {
  try {
    if (typeof caches === "undefined") return false;
    // has() first: open() would create an empty bucket just to look in it.
    if (!(await caches.has(MODEL_CACHE_NAME))) return false;
    const cache = await caches.open(MODEL_CACHE_NAME);
    return Boolean(await cache.match(weightsUrl()));
  } catch {
    return false;
  }
}

/**
 * Load Kokoro and return a reader. See readAloudEngine.ts loadReadAloud for
 * the options and what the reader can do.
 */
export async function loadReadAloud(
  options?: LoadReadAloudOptions,
): Promise<ReadAloudReader> {
  const engine = await import("./readAloudEngine.ts");
  return engine.loadReadAloud(options);
}
