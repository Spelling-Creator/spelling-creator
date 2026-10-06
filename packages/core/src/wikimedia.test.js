import { afterEach, describe, expect, it, vi } from "vitest";

import { wikidataPickPages } from "./wikimedia.js";

const ITEM = "http://www.wikidata.org/entity/";
const FILE = "http://commons.wikimedia.org/wiki/Special:FilePath/";

// Wikidata lists two pictures for the lion. Commons has since renamed the
// first (leaving a redirect) and deleted the second; and Wikidata spells the
// first with a small letter, which Commons normalises before it even looks.
function stubWikimedia({ wikidataDown = false } = {}) {
  const commons = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const u = new URL(url);
      if (u.hostname === "www.wikidata.org") {
        if (wikidataDown) return new Response("", { status: 503 });
        return Response.json({
          search: [
            {
              id: "Q140",
              label: "lion",
              description: "big cat",
              match: { type: "label", text: "lion" },
            },
          ],
        });
      }
      if (u.hostname === "query.wikidata.org") {
        const row = (file) => ({
          item: { value: `${ITEM}Q140` },
          links: { value: "274" },
          pid: { value: "P18" },
          file: { value: FILE + encodeURIComponent(file) },
          rank: { value: "http://wikiba.se/ontology#NormalRank" },
        });
        return Response.json({
          results: { bindings: [row("old_lion.jpg"), row("Gone.jpg")] },
        });
      }
      commons.push(Object.fromEntries(u.searchParams));
      return Response.json({
        query: {
          normalized: [{ from: "File:old lion.jpg", to: "File:Old lion.jpg" }],
          redirects: [
            { from: "File:Old lion.jpg", to: "File:Lion in Namibia.jpg" },
          ],
          pages: {
            1: {
              pageid: 1,
              title: "File:Lion in Namibia.jpg",
              imageinfo: [
                {
                  thumburl: "https://upload.wikimedia.org/thumb/lion.jpg",
                  mime: "image/jpeg",
                  width: 800,
                  height: 600,
                },
              ],
            },
            "-1": { title: "File:Gone.jpg", missing: "" },
          },
        },
      });
    }),
  );
  return commons;
}

afterEach(() => vi.unstubAllGlobals());

describe("the pictures Wikidata lists, as Commons pages", () => {
  it("follows a rename and a redirect, and leaves out a file that is gone", async () => {
    const commons = stubWikimedia();
    const picks = await wikidataPickPages("lion", { userAgent: "test" });

    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({
      page: { title: "File:Lion in Namibia.jpg" },
      info: { mime: "image/jpeg" },
      image: { role: "image", file: "File:old lion.jpg" },
      item: { id: "Q140", label: "lion" },
    });
    // The lookup asked Commons to follow redirects.
    expect(commons[0].redirects).toBe("1");
  });

  it("is empty, not an error, when Wikidata doesn't answer", async () => {
    stubWikimedia({ wikidataDown: true });
    expect(await wikidataPickPages("lion")).toEqual([]);
  });
});
