import { afterEach, describe, expect, it } from "vitest";
import { env } from "@huggingface/transformers";
import { MODEL_CACHE_NAME } from "./modelCache.ts";
import { readAloudCached, weightsUrl } from "./readAloud.ts";
import { MODEL_ID, MODEL_REVISION } from "./readAloudVoices.ts";

// A CacheStorage holding named buckets of URLs, enough of the real API for
// what readAloudCached calls.
function fakeCaches(buckets: Record<string, string[]> = {}) {
  const store = new Map(
    Object.entries(buckets).map(([name, urls]) => [name, new Set(urls)]),
  );
  return {
    async has(name: string) {
      return store.has(name);
    },
    async open(name: string) {
      if (!store.has(name)) store.set(name, new Set());
      const urls = store.get(name)!;
      return {
        async match(url: string) {
          return urls.has(url) ? new Response("weights") : undefined;
        },
      };
    },
    names() {
      return [...store.keys()];
    },
  };
}

// The fake stands in for the browser's CacheStorage, which Node lacks.
const runtime = globalThis as { caches?: unknown };

afterEach(() => {
  delete runtime.caches;
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
    runtime.caches = fakeCaches({ [MODEL_CACHE_NAME]: [weightsUrl()] });
    expect(await readAloudCached()).toBe(true);
  });

  it("is false when only the small files are there", async () => {
    runtime.caches = fakeCaches({
      [MODEL_CACHE_NAME]: [
        weightsUrl().replace("onnx/model.onnx", "config.json"),
      ],
    });
    expect(await readAloudCached()).toBe(false);
  });

  it("is false without creating the bucket when nothing was downloaded", async () => {
    const caches = fakeCaches({ "lesson-images": [] });
    runtime.caches = caches;
    expect(await readAloudCached()).toBe(false);
    expect(caches.names()).toEqual(["lesson-images"]);
  });

  it("is false when the browser has no Cache Storage", async () => {
    expect(await readAloudCached()).toBe(false);
  });
});
