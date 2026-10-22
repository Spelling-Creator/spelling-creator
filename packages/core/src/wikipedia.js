// Wikipedia, for the fact check: which Wikidata item a name means, and the
// words of an article.
//
// Wikidata's own search (wbsearchentities) matches labels by prefix and ranks
// the matches in an order that has little to do with which one a lesson
// means: for "Hamlet" it puts a kind of village, a film and two given names
// ahead of the play, and for "Amazon" the river is nowhere in the first
// eight. Wikipedia's article search ranks by how much an article matters and
// reads a phrase, so "Hamlet play" and "Georgia country" each find the right
// article first; and every article names its Wikidata item
// (pageprops.wikibase_item). So names become items here, and everything after
// that is read from Wikidata.
//
// When the structured sources can't settle a fact (no value, or one that can
// only confirm it), the article itself may state it, so articleText reads an
// article as plain prose for ./factText.ts to search.
//
// Same terms as the Wikidata requests: anonymous and cross-origin, with a
// descriptive User-Agent from a server (see ./wikidata.js).

import { fetchJson } from "./wikidata.js";

/** The action API of one language's Wikipedia. */
export const wikipediaApi = (language = "en") =>
  `https://${language}.wikipedia.org/w/api.php`;

/** The page a person can open to read an article. */
export const wikipediaArticleUrl = (title, language = "en") =>
  `https://${language}.wikipedia.org/wiki/${encodeURIComponent(
    String(title).replace(/ /g, "_"),
  )}`;

/**
 * An article's words as plain text: its prose, with headings on lines of their
 * own ("== Lifespan =="), and no infobox, tables or references. A long
 * article is 50 to 100 KB of this, where its HTML runs to a megabyte.
 *
 * @param {string} title  The article's title, as articleItems gives it.
 * @param {import("./wikidata.js").WikidataOptions} [opts]
 * @returns {Promise<string>}  "" for an article that doesn't exist.
 */
export async function articleText(title, opts = {}) {
  const url = `${wikipediaApi(opts.language)}?${new URLSearchParams({
    action: "query",
    prop: "extracts",
    explaintext: "1",
    titles: title,
    redirects: "1",
    format: "json",
    formatversion: "2",
    origin: "*",
  })}`;
  const data = await fetchJson(url, opts);
  return data?.query?.pages?.[0]?.extract || "";
}

/**
 * The items of the articles a search finds, best first. An article without
 * an item (a list, a disambiguation page without one) is left out.
 *
 * @param {string} query  A name, with what kind of thing it is where known:
 *   "Mercury planet".
 * @param {import("./wikidata.js").WikidataOptions & { limit?: number }} [opts]
 * @returns {Promise<{ id: string, title: string, label: string, description: string }[]>}
 *   `title` is the article's; `label` is it without its disambiguator and
 *   `description` the disambiguator ("Mercury" and "planet" for "Mercury
 *   (planet)"), standing in until the statements query brings Wikidata's own.
 */
export async function articleItems(query, opts = {}) {
  const q = String(query || "").trim();
  if (!q) return [];
  const url = `${wikipediaApi(opts.language)}?${new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: q,
    gsrnamespace: "0",
    gsrlimit: String(opts.limit || 3),
    prop: "pageprops",
    ppprop: "wikibase_item",
    format: "json",
    formatversion: "2",
    origin: "*",
  })}`;
  const data = await fetchJson(url, opts);
  return (data?.query?.pages || [])
    .filter((page) => page.pageprops?.wikibase_item)
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .map((page) => {
      const parts = /^(.*?)\s*\(([^()]*)\)$/.exec(page.title) || [];
      return {
        id: page.pageprops.wikibase_item,
        title: page.title,
        label: parts[1] || page.title,
        description: parts[2] || "",
      };
    });
}
