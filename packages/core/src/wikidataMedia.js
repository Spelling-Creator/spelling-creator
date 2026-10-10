// The pictures Wikidata lists for a topic.
//
// A Wikidata item points at files on Wikimedia Commons: its main picture
// (P18), and for many items a map, a flag, a view at night, a range map for an
// animal. Those were chosen by people describing that thing, which makes them
// a better first offer than whatever a full-text search of Commons ranks
// highest. So the image searches (the editor's and the MCP server's) put them
// first, ahead of the search results, each labelled with what it is.
//
// This only finds the files. Turning a "File:" title into a thumbnail, a
// download and a credit line is the Commons code each app already
// has (./browser/commonsImages.js, apps/mcp/src/wikimedia.js), because every
// one of these is an ordinary Commons file with its own license.

import {
  commonsFileTitle,
  exactMatches,
  lastSegment,
  rankOf,
  sparql,
} from "./wikidata.js";

/**
 * The picture properties worth offering in a lesson, in the order they are
 * shown. `role` is what the picture is; the apps word it (the editor through
 * `imageSearch.wikidataRoles`, the MCP server with `label`).
 *
 * Some picture properties are left out on purpose: an image of a grave, a
 * seal, an icon. They are real pictures of the thing, and not ones to put in
 * front of a speller unasked.
 */
export const IMAGE_ROLES = [
  { role: "image", pid: "P18", label: "picture" },
  { role: "aerial", pid: "P8592", label: "view from above" },
  { role: "night", pid: "P3451", label: "view at night" },
  { role: "panorama", pid: "P4291", label: "panorama" },
  { role: "interior", pid: "P5775", label: "view inside" },
  { role: "montage", pid: "P2716", label: "montage" },
  { role: "range_map", pid: "P181", label: "map of where it lives" },
  { role: "locator_map", pid: "P242", label: "map of where it is" },
  { role: "location_map", pid: "P1943", label: "map of the area" },
  { role: "flag", pid: "P41", label: "flag" },
  { role: "coat_of_arms", pid: "P94", label: "coat of arms" },
  { role: "logo", pid: "P154", label: "logo" },
  { role: "structure", pid: "P117", label: "structure diagram" },
];

/**
 * The query for several items' Commons files under the given properties, with
 * each statement's rank and each item's sitelinks (so the caller can tell
 * which "Mercury" is meant without asking again). An item with no such files
 * still comes back, once, with its count.
 * Files that are no longer current (an end date on the statement) are left
 * out.
 */
export function mediaQuery(itemIds, pids) {
  const items = itemIds.map((id) => `wd:${id}`).join(" ");
  const props = pids.map((p) => `("${p}" p:${p} ps:${p})`).join(" ");
  return `SELECT ?item ?links ?pid ?file ?rank WHERE {
  VALUES ?item { ${items} }
  # How many Wikipedias have a page on it: the lion has 274 and the family
  # name Lion has 2, so of several exact matches the best known is the one
  # meant.
  ?item wikibase:sitelinks ?links .
  OPTIONAL {
    VALUES (?pid ?p ?ps) { ${props} }
    ?item ?p ?st .
    ?st ?ps ?file ; wikibase:rank ?rank .
    # A file with an end date is history: Japan's flag from 1870 to 1999.
    FILTER NOT EXISTS { ?st pq:P582 ?ended . }
  }
}`;
}

/**
 * The query's rows by item: its sitelinks, and its files in the order of
 * `pids`, preferred statements first within each. Deprecated statements are
 * dropped, and a file listed under two properties comes back once, under the
 * first.
 * @returns {Map<string, { links: number, files: { pid: string, file: string,
 *   preferred: boolean }[] }>}
 */
export function mediaFromBindings(bindings, pids) {
  const items = new Map();
  for (const row of bindings || []) {
    const id = lastSegment(row.item?.value);
    if (!items.has(id)) {
      items.set(id, {
        links: Number(row.links?.value) || 0,
        byFile: new Map(),
      });
    }
    const file = commonsFileTitle(row.file?.value);
    const rank = rankOf(row.rank?.value);
    if (!file || rank === "deprecated") continue;
    const { byFile } = items.get(id);
    const seen = byFile.get(file);
    if (seen) {
      seen.preferred ||= rank === "preferred";
      continue;
    }
    byFile.set(file, {
      pid: row.pid?.value,
      file,
      preferred: rank === "preferred",
    });
  }
  const order = new Map(pids.map((p, i) => [p, i]));
  const out = new Map();
  for (const [id, { links, byFile }] of items) {
    const files = [...byFile.values()].sort(
      (a, b) =>
        (order.get(a.pid) ?? Infinity) - (order.get(b.pid) ?? Infinity) ||
        Number(b.preferred) - Number(a.preferred),
    );
    out.set(id, { links, files });
  }
  return out;
}

/**
 * The Commons files Wikidata lists for a topic someone typed ("lion",
 * "Paris"), under the given properties.
 *
 * Only an item whose name or alias is exactly the topic counts (see
 * exactMatches), so a search that names no particular thing gets nothing
 * rather than the wrong thing's files. Of those, the best known one with any
 * such files wins: the lion, not the family name; the planet Mercury, not the
 * car brand.
 *
 * @param {string} topic
 * @param {string[]} pids
 * @param {import("./wikidata.js").WikidataOptions} [opts]
 * @returns {Promise<{ item: { id: string, label: string, description: string },
 *   files: { pid: string, file: string, preferred: boolean }[] } | null>}
 */
export async function topicMedia(topic, pids, opts = {}) {
  const candidates = await exactMatches(topic, opts);
  if (!candidates.length) return null;
  const media = mediaFromBindings(
    await sparql(
      mediaQuery(
        candidates.map((c) => c.id),
        pids,
      ),
      opts,
    ),
    pids,
  );
  const best = candidates
    .map((item) => ({ item, ...(media.get(item.id) || {}) }))
    .filter(({ files }) => files?.length)
    .sort((a, b) => b.links - a.links)[0];
  return best ? { item: best.item, files: best.files } : null;
}

/**
 * The pictures Wikidata lists for a topic, labelled with what each one is: at
 * most two of any kind (Japan has five locator maps) and `max` in all.
 *
 * @param {string} topic
 * @param {import("./wikidata.js").WikidataOptions & { max?: number }} [opts]
 * @returns {Promise<{ item: { id: string, label: string, description: string },
 *   images: { file: string, role: string, label: string }[] } | null>}
 *   null when no item matches or it has no pictures.
 */
export async function topicImages(topic, opts = {}) {
  const found = await topicMedia(
    topic,
    IMAGE_ROLES.map((r) => r.pid),
    opts,
  );
  if (!found) return null;
  const roles = new Map(IMAGE_ROLES.map((r) => [r.pid, r]));
  const perRole = new Map();
  const images = [];
  for (const { pid, file } of found.files) {
    const count = perRole.get(pid) || 0;
    if (count >= 2) continue;
    perRole.set(pid, count + 1);
    images.push({
      file,
      role: roles.get(pid).role,
      label: roles.get(pid).label,
    });
    if (images.length >= (opts.max || 8)) break;
  }
  return { item: found.item, images };
}
