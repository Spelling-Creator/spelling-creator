// Copying a forked lesson's pictures from another instance.
//
// The rules worth pinning down are the ones that decide what is kept: only a
// picture this hub's own upload would accept, because one that it would refuse
// makes every later save of the fork fail. Storage is the browser's (IndexedDB
// and crypto.subtle), so it is stubbed; what is tested is the choosing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./imageRef.js", () => ({
  imagePublicUrl: (hash) => `https://here.test/images/${hash}`,
  storeImageBytes: vi.fn(async (blob, mime) => ({
    hash: `local-${blob.size}`,
    mime,
    ext: "png",
  })),
}));
vi.mock("./imageStore.js", () => ({
  getImageBlob: async () => null,
}));

const { copyRemoteImages } = await import("./imagesClient.js");
const { MAX_IMAGE_BYTES } = await import("../image.js");

const ORIGIN = "https://there.test";
const image = (hash) => ({
  id: hash,
  type: "image",
  image: { hash, mime: "image/png", ext: "png" },
});
const docWith = (...blocks) => ({
  title: "T",
  sections: [{ id: "s", name: "S", blocks }],
});

let served;
let inFlight;
let maxInFlight;

beforeEach(() => {
  served = {};
  inFlight = 0;
  maxInFlight = 0;
  vi.stubGlobal("fetch", async (url) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    const hash = String(url).split("/").pop();
    const answer = served[hash];
    return answer ? answer() : new Response("missing", { status: 404 });
  });
});

afterEach(() => vi.unstubAllGlobals());

const picture =
  (type, size = 10) =>
  () =>
    new Response(new Uint8Array(size), { headers: { "content-type": type } });

describe("copyRemoteImages", () => {
  it("keeps a picture and points the block at the copy", async () => {
    served.a = picture("image/webp");
    const { doc, copied, failed } = await copyRemoteImages(
      docWith(image("a")),
      ORIGIN,
    );
    expect({ copied, failed }).toEqual({ copied: 1, failed: 0 });
    expect(doc.sections[0].blocks[0].image).toEqual({
      hash: "local-10",
      mime: "image/webp",
      ext: "png",
    });
  });

  it("refuses what this hub's upload would refuse, and leaves those blocks alone", async () => {
    served.octet = picture("application/octet-stream");
    served.html = picture("text/html; charset=utf-8");
    served.big = picture("image/png", MAX_IMAGE_BYTES + 1);
    served.none = () => new Response(new Uint8Array(10));
    const original = docWith(
      image("octet"),
      image("html"),
      image("big"),
      image("none"),
      image("gone"),
    );
    const { doc, copied, failed } = await copyRemoteImages(original, ORIGIN);
    expect({ copied, failed }).toEqual({ copied: 0, failed: 5 });
    expect(doc).toBe(original);
  });

  it("copies the pictures VAKT activities hold too, as saving uploads them", async () => {
    served.v = picture("image/png", 7);
    const vakt = { id: "v", type: "vakt", image: { hash: "v" } };
    const { doc } = await copyRemoteImages(docWith(vakt), ORIGIN);
    expect(doc.sections[0].blocks[0].image.hash).toBe("local-7");
  });

  it("fetches a few at a time, each picture once", async () => {
    const blocks = [];
    for (let i = 0; i < 12; i++) {
      served[`p${i}`] = picture("image/png");
      blocks.push(image(`p${i}`));
    }
    blocks.push(image("p0"));
    const { copied } = await copyRemoteImages(docWith(...blocks), ORIGIN);
    expect(copied).toBe(12);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });
});
