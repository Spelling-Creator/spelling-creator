// The Smithsonian's Global Volcanism Program (GVP), for the fact check: how
// high a volcano's summit is, and when it erupted.
//
// GVP keeps the standard record of the world's volcanoes active in the last
// 12,000 years or so, with every dated eruption: Vesuvius in 79 (from 24
// October), Mount St. Helens from 1 October 2004 to 27 January 2008. Wikidata
// names each volcano's GVP number (P1886), so ./factCheck.js finds the volcano
// the usual way and asks GVP by number, with nothing left to match by name.
//
// GVP answers through a GeoServer web feature service: anonymous, no key, JSON
// on request, with a filter language (CQL) for asking about several volcanoes
// at once. Two layers are read, the volcanoes and their eruptions, one request
// each however many volcanoes a lesson mentions.
//
// Its years are historical: -2420 is 2420 BC, as in a fact check's claims. An
// eruption still going on carries the date GVP last updated it as its end.

import { fetchJson } from "./wikidata.js";

export const GVP_WFS =
  "https://webservices.volcano.si.edu/geoserver/GVP-VOTW/wfs";

/** The page a person can open to see a volcano's record. */
export const volcanoUrl = (number) =>
  `https://volcano.si.edu/volcano.cfm?vn=${number}`;

const VOLCANO_FIELDS = ["Volcano_Number", "Volcano_Name", "Elevation"];
const ERUPTION_FIELDS = [
  "Volcano_Number",
  "Activity_Type",
  "StartDateYear",
  "StartDateYearUncertainty",
  "StartDateMonth",
  "StartDateDay",
  "EndDateYear",
  "EndDateMonth",
  "EndDateDay",
];

// A GVP number is six digits. Anything else is left out rather than put in a
// filter.
const isVolcanoNumber = (n) => /^\d{6}$/.test(String(n));

async function features(layer, fields, numbers, opts) {
  const url = `${GVP_WFS}?${new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: `GVP-VOTW:${layer}`,
    propertyName: fields.join(","),
    CQL_FILTER: `Volcano_Number IN (${numbers.join(",")})`,
    outputFormat: "application/json",
  })}`;
  const data = await fetchJson(url, opts);
  return (data?.features || []).map((f) => f.properties || {});
}

const whole = (n) => (Number.isInteger(n) ? n : 0);

function datePart(year, month, day) {
  if (!Number.isInteger(year)) return null;
  return { year, month: whole(month), day: whole(day) };
}

/**
 * One eruption from GVP's fields: its start, its end where known, how many
 * years either way its start may be out (a radiocarbon date), and whether GVP
 * counts it as confirmed or only possible.
 * @returns {{ confirmed: boolean, start: object, end: object | null, uncertainty: number } | null}
 */
export function eruptionFromFields(p) {
  const start = datePart(p.StartDateYear, p.StartDateMonth, p.StartDateDay);
  if (!start) return null;
  return {
    confirmed: p.Activity_Type === "Confirmed Eruption",
    start,
    end: datePart(p.EndDateYear, p.EndDateMonth, p.EndDateDay),
    uncertainty: whole(p.StartDateYearUncertainty),
  };
}

/**
 * What GVP has on each of some volcanoes.
 *
 * Only volcanoes of the last 12,000 years are in the layers read; an older
 * one (GVP's Pleistocene list) isn't, and has no record here.
 *
 * @param {(string|number)[]} numbers  GVP numbers, as Wikidata's P1886 gives them.
 * @param {import("./wikidata.js").WikidataOptions} [opts]
 * @returns {Promise<Map<string, { number: string, name: string, elevation: number | null, eruptions: object[] }>>}
 *   Keyed by number. Eruptions are oldest first.
 */
export async function volcanoRecords(numbers, opts = {}) {
  const wanted = [...new Set(numbers.map(String))].filter(isVolcanoNumber);
  const out = new Map();
  if (!wanted.length) return out;
  const [volcanoes, eruptions] = await Promise.all([
    features(
      "Smithsonian_VOTW_Holocene_Volcanoes",
      VOLCANO_FIELDS,
      wanted,
      opts,
    ),
    features(
      "Smithsonian_VOTW_Holocene_Eruptions",
      ERUPTION_FIELDS,
      wanted,
      opts,
    ),
  ]);
  for (const v of volcanoes) {
    const number = String(v.Volcano_Number);
    out.set(number, {
      number,
      name: v.Volcano_Name || "",
      elevation: Number.isFinite(v.Elevation) ? v.Elevation : null,
      eruptions: [],
    });
  }
  for (const fields of eruptions) {
    const record = out.get(String(fields.Volcano_Number));
    const eruption = eruptionFromFields(fields);
    if (record && eruption) record.eruptions.push(eruption);
  }
  for (const record of out.values()) {
    record.eruptions.sort(
      (a, b) => dateSpan(a.start)[0] - dateSpan(b.start)[0],
    );
  }
  return out;
}

// --- Comparing dates -------------------------------------------------------
//
// A date known to the year covers the whole year, and one known to the month
// the whole month, so dates are compared as spans of days. The day numbers
// only need to sort right, so every month has 31 days.

const dayNumber = (year, month, day) =>
  year * 372 + (month - 1) * 31 + (day - 1);

/**
 * The first and last day a date could mean.
 * @param {{ year: number, month?: number, day?: number }} date
 * @returns {[number, number]}
 */
export function dateSpan({ year, month, day }) {
  if (!month) return [dayNumber(year, 1, 1), dayNumber(year, 12, 31)];
  if (!day) return [dayNumber(year, month, 1), dayNumber(year, month, 31)];
  const d = dayNumber(year, month, day);
  return [d, d];
}

/**
 * Whether an eruption was going on at some point in a span, allowing its
 * start's own uncertainty and `years` more either way.
 */
export function eruptionOverlaps(eruption, span, years = 0) {
  const [from] = dateSpan(eruption.start);
  const [, to] = dateSpan(eruption.end || eruption.start);
  const pad = (eruption.uncertainty + years) * 372;
  return span[0] <= Math.max(to, from) + pad && span[1] >= from - pad;
}

/**
 * The most recent confirmed eruption: the one that went on latest, which is
 * not always the one that started latest. One from 1983 to 2018 is more
 * recent than one from 2008 to 2009. Null for a volcano with none.
 */
export function latestEruption(record) {
  const lastDay = (e) =>
    Math.max(dateSpan(e.start)[1], dateSpan(e.end || e.start)[1]);
  let latest = null;
  for (const e of record?.eruptions || []) {
    if (!e.confirmed) continue;
    // Eruptions are oldest first, so a tie goes to the one that started later.
    if (!latest || lastDay(e) >= lastDay(latest)) latest = e;
  }
  return latest;
}

/** The eruption nearest a span, to show beside a date that matches none. */
export function nearestEruption(record, span) {
  let best = null;
  let bestGap = Infinity;
  for (const e of record?.eruptions || []) {
    if (!e.confirmed) continue;
    const [from] = dateSpan(e.start);
    const [, to] = dateSpan(e.end || e.start);
    const gap = Math.max(from - span[1], span[0] - to, 0);
    if (gap < bestGap) {
      best = e;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * The year from which a volcano's record can be taken as complete: its first
 * eruption dated to the month, which means someone saw it. Before that, GVP's
 * eruptions are dated from the rocks, and an eruption missing from the list
 * may only be one nobody has dated yet. Null for a volcano with no eruption
 * dated that closely.
 */
export function recordedSince(record) {
  const first = (record?.eruptions || []).find((e) => e.start.month);
  return first ? first.start.year : null;
}
