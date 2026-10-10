import { describe, expect, it, vi } from "vitest";

import { articleItems, articleText, wikipediaArticleUrl } from "./wikipedia.js";

describe("an article's text", () => {
  it('asks for plain text, following redirects, and gives "" for no article', async () => {
    const fetch = vi.fn(async (url) => {
      const u = new URL(url);
      expect(u.searchParams.get("prop")).toBe("extracts");
      expect(u.searchParams.get("explaintext")).toBe("1");
      expect(u.searchParams.get("redirects")).toBe("1");
      const title = u.searchParams.get("titles");
      return Response.json({
        query: {
          pages: [
            title === "Cat"
              ? { title, extract: "The cat is a small mammal." }
              : { title, missing: true },
          ],
        },
      });
    });
    expect(await articleText("Cat", { fetch })).toBe(
      "The cat is a small mammal.",
    );
    expect(await articleText("Zorblax", { fetch })).toBe("");
  });

  it("links to the article", () => {
    expect(wikipediaArticleUrl("Mercury (planet)")).toBe(
      "https://en.wikipedia.org/wiki/Mercury_(planet)",
    );
  });
});

describe("the items of a Wikipedia search", () => {
  it("keeps the search's order, drops articles without an item, and reads the title", async () => {
    const fetch = vi.fn(async (url) => {
      const u = new URL(url);
      expect(u.hostname).toBe("en.wikipedia.org");
      expect(u.searchParams.get("gsrsearch")).toBe("Mercury planet");
      return Response.json({
        query: {
          pages: [
            {
              pageid: 2,
              index: 2,
              title: "Outline of Mercury (planet)",
              pageprops: { wikibase_item: "Q30597834" },
            },
            { pageid: 3, index: 3, title: "List of missions to Mercury" },
            {
              pageid: 1,
              index: 1,
              title: "Mercury (planet)",
              pageprops: { wikibase_item: "Q308" },
            },
          ],
        },
      });
    });
    expect(await articleItems("Mercury planet", { fetch })).toEqual([
      {
        id: "Q308",
        title: "Mercury (planet)",
        label: "Mercury",
        description: "planet",
      },
      {
        id: "Q30597834",
        title: "Outline of Mercury (planet)",
        label: "Outline of Mercury",
        description: "planet",
      },
    ]);
  });

  it("asks nothing for an empty name, and the right Wikipedia for a language", async () => {
    const fetch = vi.fn(async (url) => {
      expect(new URL(url).hostname).toBe("de.wikipedia.org");
      return Response.json({ query: { pages: [] } });
    });
    expect(await articleItems("  ", { fetch })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(await articleItems("Berlin", { fetch, language: "de" })).toEqual([]);
  });
});
