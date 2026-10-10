// The light half of Kokoro read-aloud: the device check, and the one door to
// readAloudEngine.js, which holds transformers.js and the model and so is only
// ever fetched by a dynamic import(), the same split as documentModel.js and
// summarizer.js.

import { meteredConnection, webGpuAdapter } from "./deviceCheck.js";
import { MODEL_CACHE_NAME } from "./modelCache.js";
import { MODEL_ID, MODEL_REVISION } from "./readAloudVoices.js";

export { VOICES, DEFAULT_VOICE } from "./readAloudVoices.js";

// The download, at the fp32 weights the engine loads on WebGPU, rounded the
// way the UI says it.
export const DOWNLOAD_MB = 330;

// Where transformers.js keeps those weights once they're downloaded: in the
// shared model cache (modelCache.js), under the URL it fetched them from.
const WEIGHTS_URL = `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/onnx/model.onnx`;

// Phones and tablets are turned away by name, because WebGPU alone doesn't
// tell them apart: an iPad has it, and Kokoro froze and then crashed Safari on
// one. iPadOS asks for desktop sites by default, so it calls itself a Mac and
// gives itself away only by having a touch screen, which no Mac has.
function phoneOrTablet() {
  const nav = globalThis.navigator;
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
 * for once a page (deviceCheck.js); the rest is read live, so asking again
 * before a download catches a connection that has since turned metered.
 * Fails closed.
 * @returns {Promise<boolean>}
 */
export async function readAloudPossible() {
  if (phoneOrTablet() || meteredConnection()) return false;
  return Boolean(await webGpuAdapter());
}

/**
 * Whether the model is already downloaded, so loading it costs a couple of
 * seconds rather than a 330 MB download. The weights are nearly all of it, and
 * transformers.js stores each file whole, so finding them is the answer; the
 * small files beside them are quick to fetch again if they've gone. False
 * wherever Cache Storage can't be read.
 * @returns {Promise<boolean>}
 */
export async function readAloudCached() {
  try {
    if (typeof caches === "undefined") return false;
    // has() first: open() would create an empty bucket just to look in it.
    if (!(await caches.has(MODEL_CACHE_NAME))) return false;
    const cache = await caches.open(MODEL_CACHE_NAME);
    return Boolean(await cache.match(WEIGHTS_URL));
  } catch {
    return false;
  }
}

/**
 * Load Kokoro and return a reader. See readAloudEngine.js loadReadAloud for
 * the options and what the reader can do.
 * @param {Parameters<typeof import("./readAloudEngine.js").loadReadAloud>[0]} [options]
 */
export async function loadReadAloud(options) {
  const engine = await import("./readAloudEngine.js");
  return engine.loadReadAloud(options);
}
