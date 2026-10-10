// The on-device models this browser has downloaded, as the settings page sees
// them: how much room they take, and a way to delete them.
//
// Every transformers.js engine (natural voices in readAloudEngine.js, the
// summary, translation and document-import fallbacks) saves what it downloads
// in one Cache Storage bucket, along with the ONNX runtime's own .wasm files.
// Nothing else in the app writes there, so the whole bucket can go at once.
// Before this, the only way to get the space back was to clear the site's
// data, which takes the lessons on this device with it.
//
// This module deliberately doesn't import transformers.js: that would put the
// library in the settings page's bundle just to read a name. The test checks
// the name against the library's own default instead.
//
// Deleting is safe at any moment. transformers.js stores each file whole
// (cache.put of a complete response), so there is never half a file to find
// later, and it opens the bucket again by name for every file it loads, so the
// next download simply starts a fresh one. A model already loaded in a page
// keeps working from memory; only the next page load downloads it again.
// Chrome's built-in models (Translator, Summarizer) belong to the browser and
// aren't reachable from here.

export const MODEL_CACHE_NAME = "transformers-cache";

// How much one cached response takes. Its Content-Length is only the size on
// disk when the body arrived uncompressed. The ONNX runtime's .wasm and .mjs
// are saved with the CDN's own headers (transformers.js's cacheWasm.js), and
// when the CDN sent them gzip or brotli, Content-Length is the compressed size
// while the cache holds the decoded bytes. Those are read for their real size
// instead. They're tens of MB at most; the model weights, the big entries,
// come from Hugging Face uncompressed, so their header can be trusted.
async function storedBytes(response) {
  const encoding = response.headers.get("content-encoding");
  const length = Number(response.headers.get("content-length"));
  if ((!encoding || encoding === "identity") && length > 0) return length;
  return (await response.blob()).size;
}

/**
 * How many bytes the downloaded models take up. 0 when nothing has been
 * downloaded, and null when this browser won't let the page use Cache Storage
 * at all (an insecure origin, or some private windows), in which case nothing
 * can have been saved either.
 * @returns {Promise<number | null>}
 */
export async function modelCacheBytes() {
  try {
    if (typeof caches === "undefined") return null;
    // has() first: open() would create an empty bucket just to measure it.
    if (!(await caches.has(MODEL_CACHE_NAME))) return 0;
    const cache = await caches.open(MODEL_CACHE_NAME);
    let total = 0;
    for (const response of await cache.matchAll()) {
      total += await storedBytes(response);
    }
    return total;
  } catch {
    return null;
  }
}

/**
 * Delete every downloaded model. Each engine downloads its model again the
 * next time it's used.
 * @returns {Promise<void>}
 */
export async function clearModelCache() {
  if (typeof caches === "undefined") return;
  await caches.delete(MODEL_CACHE_NAME);
}
