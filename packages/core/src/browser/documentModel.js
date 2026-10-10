// The on-device model behind Import from text, in two layers (the same shape
// as summarizer.js): this light module answers whether the device can run the
// model and hands a run to the heavy chunk (documentModelEngine.js), which is
// reached ONLY through the dynamic import() below. Nothing may static-import
// the engine: that keeps transformers.js out of every bundle a visitor loads,
// and vite.config.js stubs the engine out of the Worker's SSR build.
//
// The model is LFM2-1.2B-Extract fine-tuned on lesson documents, a 643 MB
// one-time download at q4f16 that needs WebGPU with f16 shaders and an
// adapter whose limits can hold the weights, the same bar the summariser's
// fallback applies. There is no CPU path in the browser: the int8 file that
// runs well on a CPU is 2.5 GB, and the q4 file is not faithful for this
// checkpoint (see the docs page "Document import experiment"). Fails closed:
// a device that cannot run it is never offered the button.

import {
  holdsLargeModel,
  meteredConnection,
  webGpuAdapter,
} from "./deviceCheck.js";

/**
 * Can this device run the model? Cheap and needs no chunk. The adapter is
 * asked for once a page (deviceCheck.js); the connection check stays live
 * because tethering can start mid-visit.
 * @returns {Promise<boolean>}
 */
export async function documentModelPossible() {
  if (meteredConnection()) return false;
  return holdsLargeModel(await webGpuAdapter());
}

// Only a successful load is memoised: a cached rejection would disable the
// model for the rest of the session with no way back but a reload.
let enginePromise = null;

function loadEngine() {
  if (!enginePromise) {
    enginePromise = import("./documentModelEngine.js").catch((err) => {
      enginePromise = null;
      throw err;
    });
  }
  return enginePromise;
}

/**
 * Read sections with the model, one at a time. Each entry of `sections` is
 * what documentImport's splitSections returns ({heading, lines}); each
 * result is the shape parseSection returns, with the model's own question
 * type on each question, or null for a section the model could not read.
 *
 * @param {Array<{heading: string, lines: string[]}>} sections
 * @param {object} [hooks]
 * @param {AbortSignal} [hooks.signal]  Checked before the download starts,
 *   between sections, and between generated tokens.
 * @param {(loaded: number) => void} [hooks.onDownloadProgress]  0-1 fraction,
 *   first run only.
 * @param {(number: number, total: number) => void} [hooks.onSection]  Before
 *   each section, with its number counting from 1: the model is loaded and
 *   this one is being read.
 * @returns {Promise<Array<object|null>>}
 */
export async function readSectionsWithModel(sections, hooks = {}) {
  const engine = await loadEngine();
  return engine.readSections(sections, hooks);
}
