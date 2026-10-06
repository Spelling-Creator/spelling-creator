import { describe, expect, it, vi } from "vitest";

import { commonsFileTitle, exactMatches, findItem } from "./wikidata.js";
import {
  IMAGE_ROLES,
  mediaFromBindings,
  topicImages,
} from "./wikidataMedia.js";

const FILE = "http://commons.wikimedia.org/wiki/Special:FilePath/";
const RANK = "http://wikiba.se/ontology#";
const ITEM = "http://www.wikidata.org/entity/";

// One query-service row: an item's file under a property.
const row = (item, pid, file, extra = {}) => ({
  item: { value: ITEM + item },
  links: { value: String(extra.links ?? 10) },
  ...(pid
    ? {
        pid: { value: pid },
        file: { value: FILE + encodeURIComponent(file) },
        rank: { value: RANK + (extra.rank || "NormalRank") },
      }
    : {}),
  ...(extra.language ? { language: { value: ITEM + extra.language } } : {}),
});

// A stand-in for the two Wikidata endpoints.
function fakeWikidata({ search = [], bindings = [] }) {
  return vi.fn(async (url) => {
    const { hostname } = new URL(url);
    if (hostname === "www.wikidata.org") return Response.json({ search });
    return Response.json({ results: { bindings } });
  });
}

const hit = (id, text, description = "") => ({
  id,
  label: text,
  description,
  match: { type: "label", text },
});

describe("Commons file names", () => {
  it("turns the query service's file URLs into File: titles", () => {
    expect(commonsFileTitle(`${FILE}Lion%20in%20masai%20mara.jpg`)).toBe(
      "File:Lion in masai mara.jpg",
    );
    expect(commonsFileTitle(`${FILE}Flag_of_Japan.svg`)).toBe(
      "File:Flag of Japan.svg",
    );
    expect(commonsFileTitle("https://example.com/x.jpg")).toBe("");
  });
});

describe("finding the item a name means", () => {
  it("keeps only exact names, not ones that start the same", async () => {
    const fetch = fakeWikidata({
      search: [
        hit("Q140", "lion"),
        hit("Q1", "Lion-devant-Dun"),
        {
          ...hit("Q334", "Singapore"),
          match: { type: "alias", text: "Lion City" },
        },
      ],
    });
    expect((await exactMatches("Lion", { fetch })).map((m) => m.id)).toEqual([
      "Q140",
    ]);
    expect(await exactMatches("  ", { fetch })).toEqual([]);
  });

  it("prefers the best known of several, not the search's first", async () => {
    const fetch = fakeWikidata({
      search: [
        hit("Q613883", "Mercury", "car brand"),
        hit("Q308", "Mercury", "planet"),
      ],
      bindings: [
        { item: { value: `${ITEM}Q613883` }, links: { value: "27" } },
        { item: { value: `${ITEM}Q308` }, links: { value: "274" } },
      ],
    });
    expect((await findItem("Mercury", { fetch })).id).toBe("Q308");
  });
});

describe("reading an item's files", () => {
  const pids = IMAGE_ROLES.map((r) => r.pid);

  it("orders by property, preferred first, and drops deprecated ones", () => {
    const out = mediaFromBindings(
      [
        row("Q17", "P41", "Flag of Japan.svg"),
        row("Q17", "P18", "Old.jpg", { rank: "DeprecatedRank" }),
        row("Q17", "P18", "Second.jpg"),
        row("Q17", "P18", "Best.jpg", { rank: "PreferredRank" }),
      ],
      pids,
    ).get("Q17");
    expect(out.files.map((f) => f.file)).toEqual([
      "File:Best.jpg",
      "File:Second.jpg",
      "File:Flag of Japan.svg",
    ]);
  });

  it("keeps a file once, with every language it is in", () => {
    const out = mediaFromBindings(
      [
        row("Q1", "P443", "Say.ogg", { language: "Q1860" }),
        row("Q1", "P443", "Say.ogg", { language: "Q150" }),
      ],
      ["P443"],
    ).get("Q1");
    expect(out.files).toHaveLength(1);
    expect(out.files[0].languages).toEqual(["Q1860", "Q150"]);
  });

  it("still reports an item with no files, so its sitelinks count", () => {
    const out = mediaFromBindings([row("Q9", null, null, { links: 3 })], pids);
    expect(out.get("Q9")).toEqual({ links: 3, files: [] });
  });
});

describe("a topic's pictures", () => {
  it("takes the best known match that has pictures, labelled, two of a kind at most", async () => {
    const fetch = fakeWikidata({
      search: [
        hit("Q6555385", "Lion", "family name"),
        hit("Q140", "lion", "big cat"),
      ],
      bindings: [
        row("Q6555385", null, null, { links: 2 }),
        row("Q140", "P18", "A.jpg", { links: 274 }),
        row("Q140", "P181", "Range 1.svg", { links: 274 }),
        row("Q140", "P181", "Range 2.png", { links: 274 }),
        row("Q140", "P181", "Range 3.png", { links: 274 }),
      ],
    });
    const found = await topicImages("lion", { fetch });
    expect(found.item).toEqual({
      id: "Q140",
      label: "lion",
      description: "big cat",
    });
    expect(found.images).toEqual([
      { file: "File:A.jpg", role: "image", label: "picture" },
      {
        file: "File:Range 1.svg",
        role: "range_map",
        label: "map of where it lives",
      },
      {
        file: "File:Range 2.png",
        role: "range_map",
        label: "map of where it lives",
      },
    ]);
  });

  it("finds nothing for a phrase that names no one thing", async () => {
    const fetch = fakeWikidata({ search: [hit("Q8072", "volcano")] });
    expect(await topicImages("volcano erupting", { fetch })).toBeNull();
    // No item, so no query for its pictures.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("finds nothing when no match has pictures", async () => {
    const fetch = fakeWikidata({
      search: [hit("Q6555385", "Lion", "family name")],
      bindings: [row("Q6555385", null, null, { links: 2 })],
    });
    expect(await topicImages("lion", { fetch })).toBeNull();
  });
});
