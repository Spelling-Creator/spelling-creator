// The device checks the in-page models share: the summariser's LFM fallback
// (summarizer.js), the import model (documentModel.js) and the natural
// read-aloud voice (readAloud.js). Each decides for itself what it needs from
// the adapter; what lives here is asking for it, once a page, and the
// connection rule they all apply.

// Chromium's Network Information API, absent elsewhere; where it's missing we
// assume the connection is fine rather than hiding a feature from every
// non-Chromium browser. The browser's built-in AI APIs refuse their (much
// smaller) downloads on a metered connection, so a download of hundreds of MB
// should show at least the same manners rather than burning through someone's
// cellular data. Read live on every check, because tethering can start
// mid-visit.
export function meteredConnection() {
  const connection = globalThis.navigator?.connection;
  if (!connection) return false;
  return Boolean(connection.saveData) || connection.type === "cellular";
}

let adapterPromise = null;

/**
 * This device's WebGPU adapter, or null without one. requestAdapter() is async
 * and its answer never changes within a page, so it is asked once and shared.
 * Only the adapter's features and limits are read here; the ONNX runtime asks
 * for its own when a model loads.
 * @returns {Promise<GPUAdapter|null>}
 */
export function webGpuAdapter() {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu) return Promise.resolve(null);
  adapterPromise ??= gpu
    .requestAdapter()
    .then((adapter) => adapter ?? null)
    .catch(() => null);
  return adapterPromise;
}

// The bar for the large models (the LFM summariser and the import model, both
// q4f16 at 640 MB or more), there to turn away phone-class adapters that would
// download the whole model only to fail, or crash the tab, loading the weights.
// Checked on the adapter's limits, which report what the hardware CAN raise
// them to, not the small WebGPU defaults.
//
// 1 GiB, and not more: desktop browsers cap both limits a few bytes short of
// 2 GiB however capable the hardware (Firefox and Safari both report
// 2147483644 on machines that run the models fine), so any higher bar would
// shut out the browsers these models exist for. A naive 2 GiB reading of the
// model size did exactly that, by 4 bytes. Phone-class adapters sit far below
// this line (storage bindings of 128 or 256 MiB are typical), which is the
// distinction the bar is drawing.
const LARGE_MODEL_MIN_BUFFER_BYTES = 1024 ** 3;
const LARGE_MODEL_MIN_STORAGE_BINDING_BYTES = 1024 ** 3;

/**
 * Whether an adapter can hold one of the large q4f16 models: f16 shaders, and
 * limits past the bar above.
 * @param {GPUAdapter|null} adapter
 * @returns {boolean}
 */
export function holdsLargeModel(adapter) {
  return (
    Boolean(adapter?.features?.has("shader-f16")) &&
    adapter.limits.maxBufferSize >= LARGE_MODEL_MIN_BUFFER_BYTES &&
    adapter.limits.maxStorageBufferBindingSize >=
      LARGE_MODEL_MIN_STORAGE_BINDING_BYTES
  );
}
