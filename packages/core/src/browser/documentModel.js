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

const MIN_BUFFER_BYTES = 1024 ** 3;
const MIN_STORAGE_BINDING_BYTES = 1024 ** 3;

function meteredConnection() {
  const connection = globalThis.navigator?.connection;
  if (!connection) return false;
  return Boolean(connection.saveData) || connection.type === "cellular";
}

let webGpuProbe = null;

/**
 * Can this device run the model? Cheap, needs no chunk, memoised on the
 * adapter part (that answer never changes within a page); the connection
 * check stays live because tethering can start mid-visit.
 * @returns {Promise<boolean>}
 */
export function documentModelPossible() {
  if (!globalThis.navigator?.gpu) return Promise.resolve(false);
  if (meteredConnection()) return Promise.resolve(false);
  if (!webGpuProbe) {
    webGpuProbe = navigator.gpu
      .requestAdapter()
      .then(
        (adapter) =>
          Boolean(adapter?.features?.has("shader-f16")) &&
          adapter.limits.maxBufferSize >= MIN_BUFFER_BYTES &&
          adapter.limits.maxStorageBufferBindingSize >=
            MIN_STORAGE_BINDING_BYTES,
      )
      .catch(() => false);
  }
  return webGpuProbe;
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
