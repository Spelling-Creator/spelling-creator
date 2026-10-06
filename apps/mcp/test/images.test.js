// search_images opens with the pictures Wikidata lists for the topic.
//
// Wikidata and Commons are both stubbed at the global fetch. The lookup itself
// is tested in core (packages/core/src/wikidataMedia.test.js); this covers what
// the tool does with it: picks first, labelled, not repeated, and a Wikidata
// that doesn't answer costing nothing but the picks.

import assert from "node:assert/strict";
import test from "node:test";

import { searchWikimediaImages } from "../src/wikimedia.js";

const info = (title) => ({
  title,
  imageinfo: [
    {
      thumburl: `https://upload.wikimedia.org/thumb/${title}`,
      url: `https://upload.wikimedia.org/${title}`,
      width: 800,
      height: 600,
      mime: "image/jpeg",
      descriptionurl: `https://commons.wikimedia.org/wiki/${title}`,
      extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" } },
    },
  ],
});

function stubWikimedia(t, { wikidataDown = false } = {}) {
  const seen = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const u = new URL(url);
    seen.push({ host: u.hostname, userAgent: init?.headers?.["User-Agent"] });
    if (u.hostname === "www.wikidata.org") {
      if (wikidataDown) return new Response("", { status: 503 });
      return Response.json({
        search: [
          {
            id: "Q140",
            label: "lion",
            description: "species of big cat",
            match: { type: "label", text: "lion" },
          },
        ],
      });
    }
    if (u.hostname === "query.wikidata.org") {
      const row = (pid, file) => ({
        item: { value: "http://www.wikidata.org/entity/Q140" },
        links: { value: "274" },
        pid: { value: pid },
        file: {
          value: `http://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}`,
        },
        rank: { value: "http://wikiba.se/ontology#NormalRank" },
      });
      return Response.json({
        results: {
          bindings: [row("P18", "Lion.jpg"), row("P181", "Lion range.png")],
        },
      });
    }
    // Commons: a lookup by title (the Wikidata picks) or a full-text search.
    if (u.searchParams.get("titles")) {
      return Response.json({
        query: {
          pages: {
            1: info("File:Lion.jpg"),
            2: info("File:Lion range.png"),
          },
        },
      });
    }
    return Response.json({
      query: {
        pages: {
          3: { ...info("File:Lion.jpg"), index: 1 },
          4: { ...info("File:Lions at dusk.jpg"), index: 2 },
        },
      },
    });
  });
  return seen;
}

test("search_images puts Wikidata's pictures first, labelled, without repeats", async (t) => {
  const seen = stubWikimedia(t);
  const hits = await searchWikimediaImages("lion");

  assert.deepEqual(
    hits.map((h) => h.ref),
    ["File:Lion.jpg", "File:Lion range.png", "File:Lions at dusk.jpg"],
  );
  assert.equal(hits[0].description, "Picture (lion, from Wikidata)");
  assert.equal(
    hits[1].description,
    "Map of where it lives (lion, from Wikidata)",
  );
  assert.deepEqual(hits[0].wikidata, {
    role: "image",
    item: { id: "Q140", label: "lion", description: "species of big cat" },
  });
  // The search's own result is an ordinary hit.
  assert.equal(hits[2].wikidata, undefined);
  assert.match(hits[0].caption, /CC BY-SA 4\.0/);

  // Wikimedia's policy: every request names itself.
  for (const call of seen) assert.match(call.userAgent, /SpellingCreatorMCP/);
});

test("search_images still answers when Wikidata doesn't", async (t) => {
  stubWikimedia(t, { wikidataDown: true });
  const hits = await searchWikimediaImages("lion");
  assert.deepEqual(
    hits.map((h) => h.ref),
    ["File:Lion.jpg", "File:Lions at dusk.jpg"],
  );
  assert.ok(hits.every((h) => !h.wikidata));
});
