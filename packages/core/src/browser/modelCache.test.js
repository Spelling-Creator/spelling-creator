import { afterEach, describe, expect, it } from "vitest";
import { env } from "@huggingface/transformers";
import {
  MODEL_CACHE_NAME,
  clearModelCache,
  modelCacheBytes,
} from "./modelCache.js";

// A CacheStorage that holds named buckets of Responses, enough of the real API
// for what modelCache.js calls.
function fakeCaches(buckets = {}) {
  const store = new Map(
    Object.entries(buckets).map(([name, entries]) => [name, new Map(entries)]),
  );
  return {
    async has(name) {
      return store.has(name);
    },
    async open(name) {
      if (!store.has(name)) store.set(name, new Map());
      const entries = store.get(name);
      return {
        async matchAll() {
          return [...entries.values()];
        },
      };
    },
    async delete(name) {
      return store.delete(name);
    },
    names() {
      return [...store.keys()];
    },
  };
}

function sized(bytes) {
  return new Response("x", { headers: { "content-length": String(bytes) } });
}

afterEach(() => {
  delete globalThis.caches;
});

describe("MODEL_CACHE_NAME", () => {
  it("is the bucket transformers.js saves models in", () => {
    expect(MODEL_CACHE_NAME).toBe(env.cacheKey);
  });
});

describe("modelCacheBytes", () => {
  it("adds up the Content-Length of every entry", async () => {
    globalThis.caches = fakeCaches({
      [MODEL_CACHE_NAME]: [
        ["https://huggingface.co/a/model.onnx", sized(760_000_000)],
        ["https://huggingface.co/a/tokenizer.json", sized(4_000_000)],
      ],
    });
    expect(await modelCacheBytes()).toBe(764_000_000);
  });

  it("reads the body of an entry with no Content-Length", async () => {
    globalThis.caches = fakeCaches({
      [MODEL_CACHE_NAME]: [
        ["https://cdn.example/ort.wasm", new Response("12345")],
      ],
    });
    expect(await modelCacheBytes()).toBe(5);
  });

  // The ONNX runtime's .wasm, as jsDelivr sends it: brotli, with the
  // compressed size in Content-Length, while the cache holds it decoded.
  it("reads the body of an entry that arrived compressed", async () => {
    globalThis.caches = fakeCaches({
      [MODEL_CACHE_NAME]: [
        [
          "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.wasm",
          new Response("1234567890", {
            headers: { "content-encoding": "br", "content-length": "4" },
          }),
        ],
        ["https://huggingface.co/a/model.onnx_data", sized(760_000_000)],
      ],
    });
    expect(await modelCacheBytes()).toBe(760_000_010);
  });

  it("is 0 without creating the bucket when nothing was downloaded", async () => {
    const caches = fakeCaches({ "lesson-images": [] });
    globalThis.caches = caches;
    expect(await modelCacheBytes()).toBe(0);
    expect(caches.names()).toEqual(["lesson-images"]);
  });

  it("is null when the browser has no Cache Storage", async () => {
    expect(await modelCacheBytes()).toBeNull();
  });

  it("is null when the browser refuses Cache Storage", async () => {
    globalThis.caches = {
      has: () => Promise.reject(new DOMException("blocked", "SecurityError")),
    };
    expect(await modelCacheBytes()).toBeNull();
  });
});

describe("clearModelCache", () => {
  it("deletes the models and nothing else", async () => {
    const caches = fakeCaches({
      [MODEL_CACHE_NAME]: [["https://huggingface.co/a", sized(1)]],
      "lesson-images": [],
      "static-images": [],
    });
    globalThis.caches = caches;
    await clearModelCache();
    expect(caches.names()).toEqual(["lesson-images", "static-images"]);
    expect(await modelCacheBytes()).toBe(0);
  });

  it("does nothing when the browser has no Cache Storage", async () => {
    await expect(clearModelCache()).resolves.toBeUndefined();
  });
});
