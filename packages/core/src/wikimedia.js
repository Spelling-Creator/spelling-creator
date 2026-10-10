// Shared Wikimedia Commons plumbing.
//
// The web app and the MCP server both search Commons and download an image from
// it, but they are not interchangeable: the browser client returns the hit shape
// the image dialog renders and supports paging through results, while the MCP
// server returns the shape its tool contract documents and resolves an image
// from a bare "File:…" ref. Their user-facing error strings differ too.
//
// So the adapters stay per-app and only the parts that are genuinely the same
// live here: the endpoint, the query/unwrap round-trip, and the attribution
// metadata handling that Commons' licensing requires.
//
// Nothing in this module may touch the DOM — the MCP server imports it, and that
// runs in Node and inside the Worker. The browser-only refinement (DOMParser for
// HTML stripping) is injected by the web app via `strip`.

import { topicImages } from "./wikidataMedia.js";

export const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

/**
 * What an image search asks imageinfo for: a 320px thumbnail for the grid,
 * and the author and licence the credit line needs.
 */
export const IMAGEINFO_PARAMS = {
  prop: "imageinfo",
  iiprop: "url|size|mime|extmetadata",
  iiurlwidth: "320",
  iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl",
  iiextmetadatalanguage: "en",
};

/**
 * Flatten Commons' HTML metadata (e.g. an `<a>`-wrapped Artist) to collapsed
 * plain text. Regex-only, so it is safe in every runtime; these fields are small
 * and link-only, never scripts. The web app passes a DOMParser-based version.
 * @param {unknown} html
 * @returns {string}
 */
export function stripCommonsHtml(html) {
  if (!html) return "";
  return String(html)
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build the credit line Commons' licensing norms expect: author (when known) +
 * licence short name + the source. Authors and licences vary widely, so this
 * degrades gracefully when either is missing. It goes in an image block's
 * `credit`, never its caption (see ./imageCredit.js).
 * @param {string} author
 * @param {string} license
 * @returns {string}
 */
export function buildCredit(author, license) {
  const parts = [];
  if (author) parts.push(`by ${author}`);
  if (license) parts.push(license);
  const tail = parts.length ? ` (${parts.join(", ")})` : "";
  return `Image${tail} via Wikimedia Commons`;
}

/**
 * Pull author/licence out of an imageinfo `extmetadata` blob and build the
 * credit line from them.
 * @param {object} [meta]  imageinfo.extmetadata
 * @param {(html: unknown) => string} [strip]  HTML-to-text (override in browsers)
 * @returns {{author: string, license: string, credit: string}}
 */
export function extmetaCredit(meta = {}, strip = stripCommonsHtml) {
  const author = strip(meta.Artist && meta.Artist.value);
  const license = strip(meta.LicenseShortName && meta.LicenseShortName.value);
  return { author, license, credit: buildCredit(author, license) };
}

/**
 * "File:Red_panda_(cropped).jpg" -> "Red_panda_(cropped)". Used as the human
 * label for a hit.
 * @param {string} [title]
 * @returns {string}
 */
export function cleanFileTitle(title) {
  return (title || "").replace(/^File:/i, "").replace(/\.[a-z0-9]+$/i, "");
}

/**
 * Whether an imageinfo entry is something we can actually embed. The File
 * namespace also holds audio, video and PDFs, and a page with no thumbnail can't
 * be previewed.
 * @param {object} [info]  imageinfo[0]
 * @returns {boolean}
 */
export function isUsableImage(info) {
  if (!info || !info.thumburl) return false;
  return (info.mime || "").startsWith("image/");
}

/**
 * Restore search ranking. `generator=search` results come back keyed by pageid
 * and therefore unordered; `index` carries the rank.
 * @param {object[]} pages
 * @returns {object[]}  a sorted copy
 */
export function rankPages(pages) {
  return [...pages].sort((a, b) => (a.index || 0) - (b.index || 0));
}

/**
 * Call the Commons action API and return its `query` object: the pages, and
 * beside them whatever else the request asked about, such as the titles it
 * normalised or followed a redirect for.
 *
 * `origin=*` makes the API answer anonymously, which is what lets the browser
 * call it cross-origin without a proxy and lets the server call it without a
 * key.
 *
 * @param {Record<string, string>} params  action-API parameters
 * @param {object} [opts]
 * @param {string} [opts.userAgent]  sent by non-browser callers — Wikimedia's
 *   User-Agent policy throttles or 403s a generic/missing UA, which Node's fetch
 *   default ("node") trips, especially from datacenter egress. Browsers set
 *   their own and forbid overriding it.
 * @param {AbortSignal} [opts.signal]  cancels the request.
 * @param {(status: number) => string} [opts.httpErrorMessage]  wording for a
 *   non-2xx response, so each caller keeps its own phrasing.
 * @returns {Promise<object>}
 */
export async function commonsQueryResult(params, opts = {}) {
  const {
    userAgent,
    signal,
    httpErrorMessage = (status) =>
      `Wikimedia Commons request failed (${status}).`,
  } = opts;

  const url = `${COMMONS_API}?${new URLSearchParams({
    format: "json",
    origin: "*",
    ...params,
  }).toString()}`;

  const headers = { Accept: "application/json" };
  if (userAgent) headers["User-Agent"] = userAgent;

  let res;
  try {
    res = await fetch(url, { headers, signal });
  } catch (e) {
    throw new Error("Could not reach Wikimedia Commons.", { cause: e });
  }
  if (!res.ok) throw new Error(httpErrorMessage(res.status));

  const data = await res.json().catch(() => ({}));
  return (data && data.query) || {};
}

/**
 * Call the Commons action API and unwrap `query.pages` to an array. Same
 * options as commonsQueryResult.
 * @returns {Promise<object[]>}
 */
export async function commonsQuery(params, opts = {}) {
  const { pages } = await commonsQueryResult(params, opts);
  return pages ? Object.values(pages) : [];
}

/**
 * How long the Wikidata picks may take in all, across their three requests (a
 * name search, one query, one Commons lookup). Each request alone allows 15 s,
 * which suits a fact check someone asked for and not this: the picks are an
 * extra on top of a search that answers in well under a second, and a query
 * service under load must not hold the whole search for them.
 */
export const PICKS_BUDGET_MS = 4000;

/**
 * The pictures Wikidata lists for a topic, as Commons pages ready to become
 * hits: `{ page, info, image, item }`, where `page` and `info` are what
 * imageinfo returned (asked for with IMAGEINFO_PARAMS) and `image` and `item`
 * are topicImages' (./wikidataMedia.js). Empty when the topic names no
 * particular thing, and when Wikidata or Commons doesn't answer inside the
 * budget: the picks are an extra, and the search they sit on top of must not
 * fail for them.
 *
 * A file Wikidata names may have been renamed on Commons since, with a
 * redirect left behind, or be spelt with different capitals or underscores.
 * Commons reports both as `normalized` and `redirects` pairs and returns the
 * page under its current name, so titles are mapped through those before they
 * are matched up.
 *
 * @param {string} topic
 * @param {object} [opts]
 * @param {string} [opts.userAgent]  see commonsQueryResult.
 * @param {number} [opts.budgetMs]  defaults to PICKS_BUDGET_MS.
 * @returns {Promise<{ page: object, info: object, image: object, item: object }[]>}
 */
export async function wikidataPickPages(topic, opts = {}) {
  const signal = AbortSignal.timeout(opts.budgetMs ?? PICKS_BUDGET_MS);
  const shared = { userAgent: opts.userAgent, signal };

  let found;
  try {
    found = await topicImages(topic, shared);
  } catch {
    return [];
  }
  if (!found) return [];

  let result;
  try {
    result = await commonsQueryResult(
      {
        action: "query",
        titles: found.images.map((image) => image.file).join("|"),
        redirects: "1",
        ...IMAGEINFO_PARAMS,
      },
      shared,
    );
  } catch {
    return [];
  }

  const renamed = new Map(
    [...(result.normalized || []), ...(result.redirects || [])].map(
      ({ from, to }) => [from, to],
    ),
  );
  // Normalised first, then redirected: a title can go through both.
  const current = (title) => {
    let out = title;
    for (let step = 0; step < 2 && renamed.has(out); step += 1) {
      out = renamed.get(out);
    }
    return out;
  };
  const byTitle = new Map(
    Object.values(result.pages || {}).map((page) => [page.title, page]),
  );

  const picks = [];
  for (const image of found.images) {
    const page = byTitle.get(current(image.file));
    const info = page && page.imageinfo && page.imageinfo[0];
    if (!isUsableImage(info)) continue;
    picks.push({ page, info, image, item: found.item });
  }
  return picks;
}
