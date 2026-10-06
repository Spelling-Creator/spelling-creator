// Talking to Wikidata: the plumbing shared by everything that reads it.
//
// Three things use it, each with its own idea of what to ask:
//
//   ./factCheck.js       a lesson's numbers and dates, compared with Wikidata's.
//   ./wikidataMedia.js   the pictures and sounds an item has, which are files on
//                        Wikimedia Commons.
//
// What they share is here: finding items by name (wbsearchentities, small and
// fast) and asking the query service (SPARQL) for exactly the statements
// wanted. Reading whole items would be simpler, but a popular item's JSON runs
// to megabytes (the United States is about 1.6 MB), which is a lot to fetch for
// one picture.
//
// No DOM, and `fetch` is injectable: this runs in the browser, the Worker, Node
// and the MCP server. Both endpoints answer anonymous cross-origin requests,
// so the browser calls them directly. Outside a browser, Wikimedia's
// User-Agent policy throttles or refuses requests without a descriptive
// User-Agent, so server callers pass one (a browser sets its own and won't let
// a page change it).

export const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
export const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";

/** The page a person can open to see an item. */
export function wikidataItemUrl(id) {
  return `https://www.wikidata.org/wiki/${id}`;
}

/** The last part of an IRI: an item id, a property id, a rank's name. */
export const lastSegment = (iri) => String(iri || "").replace(/^.*[/#]/, "");

/**
 * @typedef {object} WikidataOptions
 * @property {typeof fetch} [fetch]  Defaults to the global one.
 * @property {string} [userAgent]    Required outside a browser.
 * @property {string} [language]     For item names and descriptions; "en".
 */

async function getJson(url, opts = {}, init = {}) {
  const fetchImpl = opts.fetch || globalThis.fetch;
  const headers = { Accept: "application/json", ...(init.headers || {}) };
  if (opts.userAgent) headers["User-Agent"] = opts.userAgent;
  const res = await fetchImpl(url, {
    ...init,
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Wikidata request failed (${res.status}).`);
  return res.json();
}

/**
 * Items whose name matches, best match first. `match` is the label or alias
 * the search matched on, which says how good the match is: a search matches
 * prefixes, so "lion" also finds "Lionel Messi".
 * @param {string} name
 * @param {WikidataOptions & { limit?: number }} [opts]
 * @returns {Promise<{ id: string, label: string, description: string, match: string }[]>}
 */
export async function searchItems(name, opts = {}) {
  const language = opts.language || "en";
  const url = `${WIKIDATA_API}?${new URLSearchParams({
    action: "wbsearchentities",
    search: name,
    language,
    uselang: language,
    type: "item",
    limit: String(opts.limit || 3),
    format: "json",
    formatversion: "2",
    origin: "*",
  })}`;
  const data = await getJson(url, opts);
  return (data.search || []).map((hit) => ({
    id: hit.id,
    label: hit.display?.label?.value || hit.label || hit.id,
    description: hit.display?.description?.value || hit.description || "",
    match: hit.match?.text || "",
  }));
}

const squash = (s) =>
  String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

/**
 * The items whose label or alias IS the name, not just starts with it, in the
 * search's order. For looking up a topic someone typed, where a wrong item is
 * worse than none: "volcano erupting" is no item at all.
 *
 * The search's order is not a good guide to which one is meant. For "lion" it
 * puts a family name first and the animal second; for "Mercury", a car brand
 * ahead of the planet. Callers rank these by sitelinks (see sitelinksQuery).
 * @returns {Promise<{ id: string, label: string, description: string }[]>}
 */
export async function exactMatches(name, opts = {}) {
  const wanted = squash(name);
  if (!wanted) return [];
  const hits = await searchItems(name, { ...opts, limit: opts.limit || 10 });
  return hits
    .filter((hit) => squash(hit.match) === wanted)
    .map(({ id, label, description }) => ({ id, label, description }));
}

/**
 * How many Wikipedias (and sister projects) have a page on each item: the
 * best measure there is of which "Mercury" someone means. The lion has 274
 * and the family name Lion has 2; the planet has 274, the element 185, the car
 * brand 27.
 *
 * Returned as a query fragment binding `?links` for `?item`, so a caller can
 * fold it into the query it was going to make anyway.
 */
export function sitelinksPattern() {
  return "?item wikibase:sitelinks ?links .";
}

/**
 * The item a name most likely means: of its exact matches, the one with the
 * most sitelinks.
 * @returns {Promise<{ id: string, label: string, description: string } | null>}
 */
export async function findItem(name, opts = {}) {
  const matches = await exactMatches(name, opts);
  if (matches.length < 2) return matches[0] || null;
  const rows = await sparql(
    `SELECT ?item ?links WHERE { VALUES ?item { ${matches.map((m) => `wd:${m.id}`).join(" ")} } ${sitelinksPattern()} }`,
    opts,
  );
  const links = new Map(
    rows.map((r) => [lastSegment(r.item?.value), Number(r.links?.value) || 0]),
  );
  return [...matches].sort(
    (a, b) => (links.get(b.id) || 0) - (links.get(a.id) || 0),
  )[0];
}

/**
 * Run a SPARQL query and return its result rows.
 *
 * A GET where the URL fits, so a cache in front (the Worker's) can hold the
 * answer; the query service turns very long URLs away, so a POST past that.
 * @param {string} query
 * @param {WikidataOptions} [opts]
 * @returns {Promise<object[]>}  `results.bindings`
 */
export async function sparql(query, opts = {}) {
  const params = new URLSearchParams({ query, format: "json" });
  const accept = { headers: { Accept: "application/sparql-results+json" } };
  const get = `${WIKIDATA_SPARQL}?${params}`;
  const data =
    get.length < 7000
      ? await getJson(get, opts, accept)
      : await getJson(WIKIDATA_SPARQL, opts, {
          ...accept,
          method: "POST",
          body: params,
        });
  return data?.results?.bindings || [];
}

const RANKS = {
  PreferredRank: "preferred",
  NormalRank: "normal",
  DeprecatedRank: "deprecated",
};

/** A statement's rank from its SPARQL IRI: "preferred", "normal" or "deprecated". */
export function rankOf(iri) {
  return RANKS[lastSegment(iri)] || "normal";
}

/**
 * A Commons file named by a SPARQL value, as the "File:" title the Commons API
 * takes. The query service gives files as Special:FilePath URLs, percent
 * encoded: .../Special:FilePath/Lion%20in%20masai%20mara.jpg.
 * @returns {string}  "File:Lion in masai mara.jpg", or "" for anything else.
 */
export function commonsFileTitle(value) {
  const match = /Special:FilePath\/(.+)$/.exec(String(value || ""));
  if (!match) return "";
  try {
    return `File:${decodeURIComponent(match[1]).replace(/_/g, " ")}`;
  } catch {
    return "";
  }
}

// Run `work` over `items`, a few at a time: polite to Wikimedia, and quick
// enough for a lesson's worth of names.
export async function eachLimited(items, limit, work) {
  const queue = [...items];
  const run = async () => {
    while (queue.length) await work(queue.shift());
  };
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, run));
}
