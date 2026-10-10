import { afterEach, describe, expect, it } from "vitest";
import { env } from "@huggingface/transformers";
import { MODEL_CACHE_NAME } from "./modelCache.js";
import { readAloudCached, weightsUrl } from "./readAloud.js";
import { MODEL_ID, MODEL_REVISION } from "./readAloudVoices.js";

// A CacheStorage holding named buckets of URLs, enough of the real API for
// what readAloudCached calls.
function fakeCaches(buckets = {}) {
  const store = new Map(
    Object.entries(buckets).map(([name, urls]) => [name, new Set(urls)]),
  );
  return {
    async has(name) {
      return store.has(name);
    },
    async open(name) {
      if (!store.has(name)) store.set(name, new Set());
      const urls = store.get(name);
      return {
        async match(url) {
          return urls.has(url) ? new Response("weights") : undefined;
        },
      };
    },
    names() {
      return [...store.keys()];
    },
  };
}

afterEach(() => {
  delete globalThis.caches;
});

describe("weightsUrl", () => {
  // If either drifts from what transformers.js does, readAloudCached would
  // quietly answer false for a model that is downloaded.
  it("is where transformers.js fetches the weights from", () => {
    const base =
      env.remoteHost +
      env.remotePathTemplate
        .replaceAll("{model}", MODEL_ID)
        .replaceAll("{revision}", MODEL_REVISION);
    expect(weightsUrl()).toBe(`${base}onnx/model.onnx`);
    expect(weightsUrl("q8")).toBe(`${base}onnx/model_quantized.onnx`);
  });
});

describe("readAloudCached", () => {
  it("finds the weights in the model cache", async () => {
    globalThis.caches = fakeCaches({ [MODEL_CACHE_NAME]: [weightsUrl()] });
    expect(await readAloudCached()).toBe(true);
  });

  it("is false when only the small files are there", async () => {
    globalThis.caches = fakeCaches({
      [MODEL_CACHE_NAME]: [
        weightsUrl().replace("onnx/model.onnx", "config.json"),
      ],
    });
    expect(await readAloudCached()).toBe(false);
  });

  it("is false without creating the bucket when nothing was downloaded", async () => {
    const caches = fakeCaches({ "lesson-images": [] });
    globalThis.caches = caches;
    expect(await readAloudCached()).toBe(false);
    expect(caches.names()).toEqual(["lesson-images"]);
  });

  it("is false when the browser has no Cache Storage", async () => {
    expect(await readAloudCached()).toBe(false);
  });
});
