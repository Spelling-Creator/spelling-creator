// The light half of Kokoro read-aloud: the device check, and the one door to
// readAloudEngine.js, which holds transformers.js and the model and so is only
// ever fetched by a dynamic import(), the same split as documentModel.js and
// summarizer.js.

import { meteredConnection, webGpuAdapter } from "./deviceCheck.js";

export { VOICES, DEFAULT_VOICE } from "./readAloudVoices.js";

// The download, at the fp32 weights the engine loads on WebGPU, rounded the
// way the UI says it.
export const DOWNLOAD_MB = 330;

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
 * Load Kokoro and return a reader. See readAloudEngine.js loadReadAloud for
 * the options and what the reader can do.
 * @param {Parameters<typeof import("./readAloudEngine.js").loadReadAloud>[0]} [options]
 */
export async function loadReadAloud(options) {
  const engine = await import("./readAloudEngine.js");
  return engine.loadReadAloud(options);
}
