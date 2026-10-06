// Checking a lesson's facts against Wikidata.
//
// A lesson states facts the speller is then asked about: how tall Everest is,
// when the Eiffel Tower went up, how many people live in Paris. The lesson
// standard asks for every fact a math question uses to be in the passage, and
// for anything time-sensitive to be checked before it is written down. This is
// the checking.
//
// It works on claims, not prose. A claim is one stated fact about one named
// thing, already pulled out of a passage:
//
//   { subject: "Mount Everest", kind: "mountain", property: "elevation",
//     value: 8849, unit: "m", qualifier: "exact", quote: "8,849 METRES" }
//
// Pulling claims out of prose is a language problem, so callers do that part
// with a model: the Worker asks its AI provider (apps/api/src/lib/factCheck.js),
// and over MCP the client is a model already, so check_facts takes claims
// directly. Everything after that lives here and is deterministic: find the
// thing on Wikidata, read the property, convert units, and compare with the
// slack the passage's own rounding allows.
//
// Every claim gets one of three verdicts:
//
//   agrees     a current Wikidata value is close enough.
//   disagrees  Wikidata has the property, and no current value is close.
//   unknown    the thing or the property isn't on Wikidata, its unit is one this
//              can't convert, or Wikidata couldn't be reached. This says nothing
//              about whether the passage is right, and callers report it as that.
//
// Wikidata is a source, not an oracle. It can be out of date, and a search for
// "Georgia" can land on the wrong one. So every verdict carries the item it was
// checked against, with its description and a link, and a person decides.
//
// How the lookups are shaped, and why:
//
//   - Names become items through wbsearchentities, which is fast and small.
//   - Values come from ONE SPARQL query for every candidate item and property at
//     once. Reading whole items instead would be simpler, but a popular item's
//     JSON runs to megabytes (the United States is about 1.6 MB), and a check
//     looks at several candidates for each name.
//
// The requests themselves go through ./wikidata.js, shared with the picture
// and sound lookups. It runs in the Worker, in Node and in the MCP server, and
// server callers must pass a User-Agent (see there).

import { textBlockPlain } from "./lessonText.js";
import {
  eachLimited,
  exactMatches,
  lastSegment,
  rankOf,
  searchItems,
  sparql,
  squashText,
  wikidataItemUrl,
} from "./wikidata.js";
import { articleItems } from "./wikipedia.js";

// The Worker places a quote in its passage with squashText, and the editor
// asks whether it is still there with it. Both take it from here, so the two
// can't drift apart.
export { squashText };

/**
 * A lesson's passages in reading order: every text block with words in it, as
 * plain text, with where it is.
 * @param {{ sections?: any[] }} doc
 * @returns {{ sectionId: string, blockId: string, text: string }[]}
 */
export function lessonPassages(doc) {
  const out = [];
  for (const section of doc?.sections || []) {
    for (const block of section?.blocks || []) {
      if (block?.type !== "text") continue;
      const text = textBlockPlain(block).trim();
      if (text) out.push({ sectionId: section.id, blockId: block.id, text });
    }
  }
  return out;
}

/**
 * Whether a fact's quote is still in its passage. A check is a snapshot, and an
 * author fixing a number is the point of it, so a finding whose words have
 * since changed is finished with rather than wrong.
 */
export function quoteStillThere(fact, text) {
  return (
    Boolean(fact.quote) && squashText(text).includes(squashText(fact.quote))
  );
}

// Calendar models a Wikidata date can be in. Month and day are only compared
// for Gregorian dates: an old date recorded in the Julian calendar is days
// away from the same date in the Gregorian one, and a passage rarely says
// which it means.
const JULIAN = "Q1985786";

/**
 * What a claim can be about. The keys are what a claim's `property` holds, and
 * what the AI prompt and the MCP tool offer as choices.
 *
 * `pids` are tried in order and the first one the item actually has wins, so
 * "height" reads a building's height (P2048) but falls back to a summit's
 * elevation (P2044), which is what people mean by a mountain's height. They are
 * never pooled: an item's elevation above sea level must not be able to agree
 * with a sentence about how tall it is.
 *
 * `hint` is the plain description a model is given when choosing.
 */
export const FACT_PROPERTIES = {
  height: {
    kind: "quantity",
    dimension: "length",
    pids: ["P2048", "P2044"],
    hint: "how tall something is: a building, statue, tree, animal or mountain",
  },
  elevation: {
    kind: "quantity",
    dimension: "length",
    pids: ["P2044"],
    hint: "how high a place or summit is above sea level",
  },
  length: {
    kind: "quantity",
    dimension: "length",
    pids: ["P2043"],
    hint: "how long something is: a river, bridge, wall, road or animal",
  },
  width: {
    kind: "quantity",
    dimension: "length",
    pids: ["P2049"],
    hint: "how wide something is",
  },
  depth: {
    kind: "quantity",
    dimension: "length",
    pids: ["P4511"],
    hint: "how deep something is: a lake, sea, cave or trench",
  },
  diameter: {
    kind: "quantity",
    dimension: "length",
    pids: ["P2386"],
    hint: "how far it is across something round, such as a planet or crater",
  },
  radius: {
    kind: "quantity",
    dimension: "length",
    pids: ["P2120"],
    hint: "the radius of something round, such as a planet",
  },
  area: {
    kind: "quantity",
    dimension: "area",
    pids: ["P2046"],
    hint: "how much ground or surface something covers: a country, lake or forest",
  },
  volume: {
    kind: "quantity",
    dimension: "volume",
    pids: ["P2234"],
    hint: "how much space something takes up or holds",
  },
  population: {
    kind: "quantity",
    dimension: "count",
    pids: ["P1082"],
    hint: "how many people live in a place",
  },
  mass: {
    kind: "quantity",
    dimension: "mass",
    pids: ["P2067"],
    hint: "how much something weighs",
  },
  speed: {
    kind: "quantity",
    dimension: "speed",
    pids: ["P2052"],
    hint: "how fast something goes",
  },
  temperature: {
    kind: "quantity",
    dimension: "temperature",
    pids: ["P2076"],
    hint: "how hot or cold something is, such as the surface of a star",
  },
  distance_from_earth: {
    kind: "quantity",
    dimension: "length",
    pids: ["P2583"],
    hint: "how far something in space is from Earth",
  },
  orbit_distance: {
    kind: "quantity",
    dimension: "length",
    pids: ["P2233"],
    hint: "the average distance of a planet or moon from what it goes around (a planet from the Sun)",
  },
  orbital_period: {
    kind: "quantity",
    dimension: "time",
    pids: ["P2146"],
    hint: "how long something takes to go once around what it orbits (for a planet, its year)",
  },
  duration: {
    kind: "quantity",
    dimension: "time",
    pids: ["P2047"],
    hint: "how long an event, journey or work lasts",
  },
  born: {
    kind: "time",
    pids: ["P569"],
    hint: "when a person or animal was born",
  },
  died: {
    kind: "time",
    pids: ["P570"],
    hint: "when a person or animal died",
  },
  began: {
    kind: "time",
    pids: ["P571", "P580", "P1619", "P585"],
    hint: "when something was built, founded, formed, created or started",
  },
  ended: {
    kind: "time",
    pids: ["P582", "P576"],
    hint: "when something ended, closed, or was destroyed or knocked down",
  },
  happened: {
    kind: "time",
    pids: ["P585", "P580", "P619"],
    hint: "when an event took place, or a spacecraft was launched",
  },
  discovered: {
    kind: "time",
    pids: ["P575"],
    hint: "when something was discovered or invented",
  },
  published: {
    kind: "time",
    pids: ["P577"],
    hint: "when a book, film, song or game came out",
  },

  // Facts that name a thing rather than give a number: the capital of a
  // country, who discovered something. The claim's `stated` holds that name,
  // and the claim agrees when one of the subject's current values on Wikidata
  // is the thing named. `pooled` reads all the listed properties together, for
  // a word like "leader" that honestly means either of two.
  capital: {
    kind: "item",
    pids: ["P36"],
    hint: "the capital city of a country, state or province (for 'Canberra is the capital of Australia', the subject is Australia)",
  },
  country: {
    kind: "item",
    pids: ["P17"],
    hint: "the country something is in",
  },
  continent: {
    kind: "item",
    pids: ["P30"],
    hint: "the continent something is in",
  },
  region: {
    kind: "item",
    pids: ["P131", "P276"],
    pooled: true,
    hint: "the state, province, county or city something is in",
  },
  language: {
    kind: "item",
    pids: ["P37"],
    hint: "the official language of a country or region",
  },
  currency: {
    kind: "item",
    pids: ["P38"],
    hint: "the money used in a country",
  },
  leader: {
    kind: "item",
    pids: ["P6", "P35"],
    pooled: true,
    hint: "the current head of government or head of state of a country (prime minister, president, monarch)",
  },
  discoverer: {
    kind: "item",
    pids: ["P61"],
    hint: "who discovered or invented something",
  },
  creator: {
    kind: "item",
    pids: ["P50", "P170", "P84", "P86", "P57"],
    pooled: true,
    hint: "who wrote, made, designed, composed or directed something",
  },
  named_after: {
    kind: "item",
    pids: ["P138"],
    hint: "what or who something is named after",
  },
  flows_into: {
    kind: "item",
    pids: ["P403"],
    hint: "the river, lake or sea a river flows into",
  },
};

export const FACT_PROPERTY_KEYS = Object.keys(FACT_PROPERTIES);

// Each dimension's base unit is the one with factor 1. Temperatures aren't a
// scale factor apart, so they carry their own conversion to and from kelvin.
const UNIT_DEFS = {
  "": { qid: "Q199", dimension: "count", factor: 1 },

  m: { qid: "Q11573", dimension: "length", factor: 1 },
  km: { qid: "Q828224", dimension: "length", factor: 1000 },
  cm: { qid: "Q174728", dimension: "length", factor: 0.01 },
  mm: { qid: "Q174789", dimension: "length", factor: 0.001 },
  ft: { qid: "Q3710", dimension: "length", factor: 0.3048 },
  in: { qid: "Q218593", dimension: "length", factor: 0.0254 },
  yd: { qid: "Q482798", dimension: "length", factor: 0.9144 },
  mi: { qid: "Q253276", dimension: "length", factor: 1609.344 },
  nmi: { qid: "Q93318", dimension: "length", factor: 1852 },
  au: { qid: "Q1811", dimension: "length", factor: 149597870700 },
  ly: { qid: "Q531", dimension: "length", factor: 9460730472580800 },

  m2: { qid: "Q25343", dimension: "area", factor: 1 },
  km2: { qid: "Q712226", dimension: "area", factor: 1e6 },
  ha: { qid: "Q35852", dimension: "area", factor: 1e4 },
  acre: { qid: "Q81292", dimension: "area", factor: 4046.8564224 },
  ft2: { qid: "Q857027", dimension: "area", factor: 0.09290304 },
  mi2: { qid: "Q232291", dimension: "area", factor: 2589988.110336 },

  m3: { qid: "Q25517", dimension: "volume", factor: 1 },
  km3: { qid: "Q4243638", dimension: "volume", factor: 1e9 },
  l: { qid: "Q11582", dimension: "volume", factor: 0.001 },

  kg: { qid: "Q11570", dimension: "mass", factor: 1 },
  g: { qid: "Q41803", dimension: "mass", factor: 0.001 },
  t: { qid: "Q191118", dimension: "mass", factor: 1000 },
  lb: { qid: "Q100995", dimension: "mass", factor: 0.45359237 },
  oz: { qid: "Q48013", dimension: "mass", factor: 0.028349523125 },
  earth_mass: { qid: "Q681996", dimension: "mass", factor: 5.9722e24 },
  // Planet masses are often stored in yottagrams. Nobody writes them, but the
  // unit has to be readable for a passage's "6 million billion billion kg" to
  // be compared with Earth's.
  yottagram: { qid: "Q613726", dimension: "mass", factor: 1e21 },

  "m/s": { qid: "Q182429", dimension: "speed", factor: 1 },
  "km/h": { qid: "Q180154", dimension: "speed", factor: 1 / 3.6 },
  mph: { qid: "Q211256", dimension: "speed", factor: 0.44704 },
  knot: { qid: "Q128822", dimension: "speed", factor: 1852 / 3600 },

  kelvin: {
    qid: "Q11579",
    dimension: "temperature",
    toBase: (k) => k,
    fromBase: (k) => k,
  },
  celsius: {
    qid: "Q25267",
    dimension: "temperature",
    toBase: (c) => c + 273.15,
    fromBase: (k) => k - 273.15,
  },
  fahrenheit: {
    qid: "Q42289",
    dimension: "temperature",
    toBase: (f) => ((f - 32) * 5) / 9 + 273.15,
    fromBase: (k) => ((k - 273.15) * 9) / 5 + 32,
  },

  s: { qid: "Q11574", dimension: "time", factor: 1 },
  min: { qid: "Q7727", dimension: "time", factor: 60 },
  h: { qid: "Q25235", dimension: "time", factor: 3600 },
  day: { qid: "Q573", dimension: "time", factor: 86400 },
  week: { qid: "Q23387", dimension: "time", factor: 604800 },
  // A mean month and a Julian year: close enough for what a lesson says.
  month: { qid: "Q5151", dimension: "time", factor: 2629800 },
  year: {
    qid: "Q577",
    // "annum", which Wikidata uses for durations as often as "year".
    aliases: ["Q1092296"],
    dimension: "time",
    factor: 31557600,
  },
  kiloyear: { qid: "Q3013059", dimension: "time", factor: 31557600000 },
};

export const FACT_UNITS = UNIT_DEFS;
export const FACT_UNIT_KEYS = Object.keys(UNIT_DEFS);

const UNIT_BY_QID = new Map(
  Object.entries(UNIT_DEFS).flatMap(([key, def]) =>
    [def.qid, ...(def.aliases || [])].map((qid) => [qid, key]),
  ),
);

/**
 * Convert between two of the units above.
 * @returns {number | null}  null when either unit is unknown or they measure
 *   different things.
 */
export function convertUnit(value, from, to) {
  const a = UNIT_DEFS[from];
  const b = UNIT_DEFS[to];
  if (!a || !b || a.dimension !== b.dimension) return null;
  const base = a.toBase ? a.toBase(value) : value * a.factor;
  return b.fromBase ? b.fromBase(base) : base / b.factor;
}

export const FACT_QUALIFIERS = ["exact", "about", "more_than", "less_than"];

// How far a value may stray from Wikidata's, as a share of it, before the
// passage's own rounding is taken into account. Hedged figures get more room.
const RELATIVE_SLACK = {
  exact: 0.02,
  about: 0.1,
  more_than: 0.02,
  less_than: 0.02,
};

/**
 * Half a unit in the last place the number was written to: 8,849 allows 0.5,
 * 9,000 allows 500, 4.5 billion allows 50 million. A passage that says "9,000
 * metres" has told you how precise it means to be.
 * @param {number} n
 * @returns {number}
 */
export function roundingSlack(n) {
  const a = Math.abs(n);
  if (!Number.isFinite(a) || a === 0) return 0;
  const [mantissa, exponent] = a.toExponential().split("e");
  const decimals = (mantissa.split(".")[1] || "").length;
  return 0.5 * 10 ** (Number(exponent) - decimals);
}

function cleanString(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function wholeNumber(value, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : 0;
}

/**
 * Why a claim can't be checked as given, or null when it can. Claims arrive
 * from a model on both paths, so nothing about them is trusted.
 *
 *   property      not one of FACT_PROPERTIES
 *   subject       empty
 *   stated        a named fact (a capital, a discoverer) with no name stated
 *   value         not a number
 *   unit-missing  a quantity with no unit (a population is the one that goes
 *                 without)
 *   unit-wrong    a unit this doesn't know, or one that measures the wrong
 *                 thing for the property (a height in kilograms)
 *
 * @returns {string | null}
 */
export function claimProblem(raw) {
  if (!raw || typeof raw !== "object") return "value";
  const spec = FACT_PROPERTIES[raw.property];
  if (!spec) return "property";
  if (!cleanString(raw.subject, 200)) return "subject";
  if (spec.kind === "item") {
    return cleanString(raw.stated, 200) ? null : "stated";
  }
  if (!Number.isFinite(Number(raw.value))) return "value";
  if (spec.kind === "quantity" && spec.dimension !== "count") {
    const unit = cleanString(raw.unit, 20);
    if (!unit) return "unit-missing";
    if (UNIT_DEFS[unit]?.dimension !== spec.dimension) return "unit-wrong";
  }
  return null;
}

/**
 * A claim with its shape checked and its defaults filled in, or null for one
 * claimProblem rejects.
 *
 * Anything a caller attaches beyond the fields below (the Worker's `passage`
 * index, say) is carried through to the result untouched.
 *
 * @returns {object | null}
 */
export function normalizeClaim(raw) {
  if (claimProblem(raw)) return null;
  const spec = FACT_PROPERTIES[raw.property];
  const named = spec.kind === "item";
  const measured = spec.kind === "quantity" && spec.dimension !== "count";
  return {
    ...raw,
    subject: cleanString(raw.subject, 200),
    kind: cleanString(raw.kind, 60),
    property: raw.property,
    stated: named ? cleanString(raw.stated, 200) : "",
    value: named ? 0 : Number(raw.value),
    unit: measured ? cleanString(raw.unit, 20) : "",
    month: spec.kind === "time" ? wholeNumber(raw.month, 1, 12) : 0,
    day: spec.kind === "time" ? wholeNumber(raw.day, 1, 31) : 0,
    qualifier: FACT_QUALIFIERS.includes(raw.qualifier)
      ? raw.qualifier
      : "exact",
    quote: cleanString(raw.quote, 300),
  };
}

/**
 * The claims that can be checked, normalized and capped, and why each of the
 * others can't be. Callers that report on dropped claims (the MCP tool) run
 * this themselves and hand the claims to checkPreparedClaims; the rest call
 * checkClaims, which does both.
 *
 * @param {object[]} rawClaims
 * @param {{ maxClaims?: number }} [opts]  Claims past this are dropped as
 *   "over-limit".
 * @returns {{ claims: object[], dropped: { index: number, reason: string }[] }}
 */
export function prepareClaims(rawClaims, { maxClaims = 40 } = {}) {
  const claims = [];
  const dropped = [];
  (rawClaims || []).forEach((raw, index) => {
    const reason = claimProblem(raw);
    if (reason) dropped.push({ index, reason });
    else if (claims.length >= maxClaims) {
      dropped.push({ index, reason: "over-limit" });
    } else claims.push(normalizeClaim(raw));
  });
  return { claims, dropped };
}

// --- Reading what Wikidata says -------------------------------------------

/**
 * A SPARQL dateTime as a historical date.
 *
 * The query service writes dates in XSD 1.1, where year 0 is 1 BC, so 2560 BC
 * comes back as -2559. It only does that for dates known to the year or
 * better; coarser ones (a century, a million years) come back as the item has
 * them. Checked against the Great Pyramid (-2559, precision 9) and Paris
 * (-0300, precision 7), both of which the item JSON gives as -2560 and -0300.
 */
export function parseSparqlTime(value, precision) {
  const match = /^([+-]?)(\d+)-(\d\d)-(\d\d)T/.exec(value || "");
  if (!match) return null;
  let year = Number(match[2]) * (match[1] === "-" ? -1 : 1);
  if (precision >= 9 && year <= 0) year -= 1;
  return { year, month: Number(match[3]), day: Number(match[4]) };
}

/**
 * The query for every statement of every listed property on every listed item,
 * with what a comparison needs: rank, the value node's parts (a quantity or a
 * date), the item a named fact points at with its label, the "point in time"
 * qualifier that dates a population figure, and the "end time" qualifier that
 * retires a former capital or prime minister.
 * @param {string} [language]  For the labels; English stands in for a
 *   language an item has no label in.
 */
export function statementsQuery(itemIds, pids, language = "en") {
  const items = itemIds.map((id) => `wd:${id}`).join(" ");
  const props = pids.map((p) => `("${p}" p:${p} psv:${p} ps:${p})`).join(" ");
  // "mul" is Wikidata's label for every language at once, where a name that
  // is the same everywhere (Marie Curie) now lives instead of under "en".
  const languages = [...new Set([language, "en", "mul"])].join(",");
  return `SELECT ?item ?itemLabel ?itemDescription ?pid ?st ?rank ?amount ?unit ?lower ?upper ?time ?precision ?calendar ?pit ?value ?valueLabel ?ended WHERE {
  VALUES ?item { ${items} }
  # The statements are optional so that every candidate comes back at least
  # once, with its label and description, whether or not it has anything to
  # check: choosing between candidates needs to know what each one is.
  OPTIONAL {
    VALUES (?pid ?p ?psv ?ps) { ${props} }
    ?item ?p ?st .
    ?st wikibase:rank ?rank .
    OPTIONAL {
      ?st ?psv ?node .
      OPTIONAL { ?node wikibase:quantityAmount ?amount ; wikibase:quantityUnit ?unit . }
      OPTIONAL { ?node wikibase:quantityLowerBound ?lower . }
      OPTIONAL { ?node wikibase:quantityUpperBound ?upper . }
      OPTIONAL { ?node wikibase:timeValue ?time ; wikibase:timePrecision ?precision ; wikibase:timeCalendarModel ?calendar . }
    }
    OPTIONAL { ?st ?ps ?value . FILTER(isIRI(?value)) }
    OPTIONAL { ?st pq:P585 ?pit . }
    OPTIONAL { ?st pq:P582 ?ended . }
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${languages}". }
}`;
}

const number = (binding) => (binding ? Number(binding.value) : undefined);

/**
 * SPARQL result rows as statements, grouped by item and then property:
 * `Map<itemId, Map<pid, statement[]>>`. A statement with several "point in
 * time" qualifiers comes back once per qualifier; it is kept once, dated by
 * the latest. Statements with no value ("unknown value", "no value") are left
 * out, since there is nothing to compare with. A statement that points at an
 * item carries it as `value` (its id) and `valueLabel`; one with an end date
 * is marked `ended`.
 */
export function statementsFromBindings(bindings) {
  const byStatement = new Map();
  for (const row of bindings || []) {
    const id = row.st?.value;
    if (!id) continue;
    const pointInTime = row.pit
      ? parseSparqlTime(row.pit.value, 11)
      : undefined;
    const seen = byStatement.get(id);
    if (seen) {
      if (pointInTime && timeKey(pointInTime) > timeKey(seen.pointInTime)) {
        seen.pointInTime = pointInTime;
      }
      seen.ended ||= Boolean(row.ended);
      continue;
    }
    const precision = number(row.precision);
    const statement = {
      item: lastSegment(row.item?.value),
      pid: row.pid?.value,
      rank: rankOf(row.rank?.value),
      pointInTime,
      ended: Boolean(row.ended),
    };
    if (row.amount) {
      statement.amount = number(row.amount);
      statement.unit = lastSegment(row.unit?.value) || "Q199";
      statement.lower = number(row.lower);
      statement.upper = number(row.upper);
    } else if (row.time) {
      const time = parseSparqlTime(row.time.value, precision);
      if (!time) continue;
      Object.assign(statement, time, {
        precision,
        calendar: lastSegment(row.calendar?.value),
      });
    } else if (/\/entity\/Q\d+$/.test(row.value?.value || "")) {
      // An item. "Unknown value" comes back as a blank node instead, and is
      // left out like "no value": a planet whose discoverer is unknown does
      // not have a discoverer to compare with.
      statement.value = lastSegment(row.value.value);
      statement.valueLabel = row.valueLabel?.value || statement.value;
    } else {
      continue;
    }
    byStatement.set(id, statement);
  }

  const out = new Map();
  for (const s of byStatement.values()) {
    if (!out.has(s.item)) out.set(s.item, new Map());
    const byPid = out.get(s.item);
    if (!byPid.has(s.pid)) byPid.set(s.pid, []);
    byPid.get(s.pid).push(s);
  }
  return out;
}

/**
 * Each item's own label and description, from the same rows: what a finding
 * shows as the thing it was checked against. An item with none of the
 * asked-for statements sends no rows and so isn't here; the caller falls back
 * to what the search said about it.
 * @returns {Map<string, { label: string, description: string }>}
 */
export function itemsFromBindings(bindings) {
  const out = new Map();
  for (const row of bindings || []) {
    const id = lastSegment(row.item?.value);
    if (!id || out.has(id)) continue;
    // The label service answers with the bare id for an item that has no
    // label in the languages asked for. That is no label; the caller has a
    // better one from the search (an article's title).
    const label = row.itemLabel?.value;
    out.set(id, {
      label: label && label !== id ? label : "",
      description: row.itemDescription?.value || "",
    });
  }
  return out;
}

function timeKey(t) {
  return t ? t.year * 10000 + (t.month || 0) * 100 + (t.day || 0) : -Infinity;
}

/**
 * The statements a passage should be held to. Deprecated ones never count,
 * and nor does one with an end date: Melbourne was Australia's capital until
 * 1927, and a passage saying it still is, is wrong. When figures are dated (a
 * population taken in 2020, another in 2017), only the latest counts: a
 * passage agreeing with a census from 1910 is out of date, not right.
 * Otherwise every remaining value counts, because Wikidata often holds several
 * honest answers at once (Everest's 8,848 and 8,848.86; the Eiffel Tower
 * started in 1887 and opened in 1889; the Nile runs through seven countries),
 * and a passage using any of them is not wrong.
 */
export function currentStatements(statements) {
  const live = (statements || []).filter(
    (s) => s.rank !== "deprecated" && !s.ended,
  );
  const dated = live.filter((s) => s.pointInTime);
  if (!dated.length) return live;
  const latest = Math.max(...dated.map((s) => timeKey(s.pointInTime)));
  return dated.filter((s) => timeKey(s.pointInTime) === latest);
}

// The one value to show a reader when there are several.
function headline(statements) {
  return statements.find((s) => s.rank === "preferred") || statements[0];
}

// --- Comparing -------------------------------------------------------------

/**
 * A Wikidata quantity in the claim's own unit, so the two read side by side.
 * @returns {{ value: number, lower?: number, upper?: number } | null}
 */
function inClaimUnit(statement, unit) {
  const from = UNIT_BY_QID.get(statement.unit);
  if (from == null) return null;
  const value = convertUnit(statement.amount, from, unit);
  if (value == null) return null;
  const bound = (b) => (b == null ? undefined : convertUnit(b, from, unit));
  return {
    value,
    lower: bound(statement.lower),
    upper: bound(statement.upper),
  };
}

export function quantityAgrees(claim, wd) {
  const relative = RELATIVE_SLACK[claim.qualifier] * Math.abs(wd.value);
  // "More than 10,000" is a bound, not a figure rounded to the nearest 10,000,
  // so it gets no rounding room: Everest's 8,849 metres is not more than it.
  const bound =
    claim.qualifier === "more_than" || claim.qualifier === "less_than";
  const slack = bound
    ? relative
    : Math.max(roundingSlack(claim.value), relative);
  const lo = Math.min(wd.lower ?? wd.value, wd.value) - slack;
  const hi = Math.max(wd.upper ?? wd.value, wd.value) + slack;
  if (claim.qualifier === "more_than") return hi >= claim.value;
  if (claim.qualifier === "less_than") return lo <= claim.value;
  return claim.value >= lo && claim.value <= hi;
}

export function timeAgrees(claim, s) {
  // A date known only to the century can't disagree with a year inside it.
  let slack = s.precision >= 9 ? 0 : 10 ** (9 - s.precision);
  // "4.5 billion years ago" is rounded the way any big number is. A year like
  // 1960 is not: it means 1960, not "the 1960s".
  if (Math.abs(claim.value) >= 10000) {
    slack = Math.max(slack, roundingSlack(claim.value));
  }
  // "About 2500 BC" for 2560 BC is how people talk. A passage never says "more
  // than" a year in a way worth holding it to, so those get the same room.
  if (claim.qualifier !== "exact") {
    slack = Math.max(slack, 2 * roundingSlack(claim.value), 1);
  }
  if (Math.abs(claim.value - s.year) > slack) return false;
  if (slack > 0 || s.calendar === JULIAN) return true;
  if (claim.month && s.precision >= 10 && claim.month !== s.month) return false;
  if (claim.day && s.precision >= 11 && claim.day !== s.day) return false;
  return true;
}

/**
 * Whether a named fact's stated thing is one of the statements' values: by
 * item id, where the name could be looked up, and otherwise by the label, so
 * a name Wikidata's search didn't know is still compared as words.
 */
export function itemAgrees(claim, statements, statedIds = []) {
  const ids = new Set(statedIds);
  const wanted = squashText(claim.stated);
  // The label, or its end: a passage says "Fleming" for Alexander Fleming.
  const named = (label) => {
    const have = squashText(label);
    return have === wanted || have.endsWith(` ${wanted}`);
  };
  return statements.some((s) => ids.has(s.value) || named(s.valueLabel));
}

/**
 * Judge one claim against one item's statements.
 * @param {object} claim  A normalized claim.
 * @param {Map<string, object[]>} byPid  That item's statements, by property.
 * @param {string[]} [statedIds]  For a named fact, the items its `stated`
 *   name may mean (see itemAgrees).
 */
export function judgeClaim(claim, byPid, statedIds = []) {
  const spec = FACT_PROPERTIES[claim.property];
  let pid;
  let statements = [];
  for (const candidate of spec.pids) {
    const current = currentStatements(byPid?.get(candidate));
    if (!current.length) continue;
    pid ??= candidate;
    statements = statements.concat(current);
    if (!spec.pooled) break;
  }
  if (!pid) return { status: "unknown", reason: "no-value" };

  const shown = headline(statements);

  if (spec.kind === "item") {
    // The current values, each once: a pooled property can name one person
    // twice (the author of a film who also directed it).
    const items = [
      ...new Map(
        statements.map((s) => [s.value, { id: s.value, label: s.valueLabel }]),
      ).values(),
    ];
    return {
      status: itemAgrees(claim, statements, statedIds) ? "agrees" : "disagrees",
      wikidata: { pid, items },
    };
  }

  if (spec.kind === "time") {
    const agrees = statements.some((s) => timeAgrees(claim, s));
    return {
      status: agrees ? "agrees" : "disagrees",
      wikidata: {
        pid,
        year: shown.year,
        month: shown.precision >= 10 ? shown.month : 0,
        day: shown.precision >= 11 ? shown.day : 0,
        precision: shown.precision,
      },
    };
  }

  const comparable = statements
    .map((s) => ({ s, wd: inClaimUnit(s, claim.unit) }))
    .filter(({ wd }) => wd);
  if (!comparable.length) return { status: "unknown", reason: "unit" };
  const agrees = comparable.some(({ wd }) => quantityAgrees(claim, wd));
  const display = comparable.find(({ s }) => s === shown) || comparable[0];
  // The year a dated figure was taken, so "2,145,906 as of 2020" reads as a
  // census and not as a fact about today.
  const asOf = display.s.pointInTime?.year;
  return {
    status: agrees ? "agrees" : "disagrees",
    wikidata: {
      pid,
      value: display.wd.value,
      unit: claim.unit,
      ...(asOf > 0 ? { asOf } : {}),
    },
  };
}

// --- Looking claims up -----------------------------------------------------

async function fetchStatements(itemIds, pids, opts) {
  const rows = await sparql(
    statementsQuery(itemIds, pids, opts.language),
    opts,
  );
  return {
    statements: statementsFromBindings(rows),
    items: itemsFromBindings(rows),
  };
}

const words = (text) =>
  String(text || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2);

const hasWord = (text, wanted) => {
  const present = new Set(words(text));
  return wanted.some((w) => present.has(w));
};

/**
 * Which of a name's candidate items a claim is about.
 *
 * Wikipedia's candidates (see findCandidates) come with the article the name
 * alone means first, so that is the answer unless the author's `kind` names
 * another: the first candidate whose article title has the kind in it
 * ("Mercury (planet)", "Amazon River", "Georgia (U.S. state)"). The title,
 * not Wikidata's description: a description is prose that says "tragedy"
 * for a play and "liner" for a ship, and matching a word in it picked
 * Ur-Hamlet over Hamlet. Having the property never moves a candidate up past
 * the first when a kind was given: "Titanic" the ship has no creator on
 * Wikidata, and the answer to that is "no value", not the 1997 film's
 * director. Without a kind, a first that has nothing to check gives way to
 * one that has: "Mercury" and an orbital period is the planet.
 *
 * Wikidata's search, the fallback, ranks by nothing useful, so there the
 * candidate that has the property and whose description says it is the kind
 * wins, then one that is the kind, then one that has the property.
 */
function chooseItem(claim, candidates, statements) {
  const pids = FACT_PROPERTIES[claim.property].pids;
  const has = (c) =>
    pids.some((p) => currentStatements(statements.get(c.id)?.get(p)).length);
  const kind = words(claim.kind);
  const [first] = candidates;

  if (first?.title) {
    // The name with the kind added, and nothing else: "Mercury (planet)",
    // "Amazon River", "Georgia (U.S. state)". A title that merely has the
    // kind in it is something else: "Australian country music" is not
    // Australia, and "Sleep Country Canada" is not Canada.
    const subject = new Set(words(claim.subject));
    const nameAndKind = (c) => {
      const title = words(c.title);
      return (
        title.some((w) => kind.includes(w)) &&
        title.every((w) => subject.has(w) || kind.includes(w))
      );
    };
    const named = kind.length && candidates.find(nameAndKind);
    if (named) return named;
    if (kind.length || has(first)) return first;
    return candidates.find(has) || first;
  }

  const fits = (c) => hasWord(c.description, kind);
  return (
    candidates.find((c) => has(c) && fits(c)) ||
    candidates.find(fits) ||
    candidates.find(has) ||
    first
  );
}

/**
 * The items a name could mean, best first.
 *
 * From Wikipedia's article search, which ranks by how much an article
 * matters: the name alone finds the thing most people mean by it ("Hamlet"
 * the play, "Titanic" the ship, "penicillin" itself), and the name with its
 * kind finds another sense where that is the one meant ("Amazon river",
 * "Mercury planet", "Georgia state"). Both are asked, together, and the
 * bare name's answers come first; chooseItem reads the kind off the titles.
 * Asking only with the kind was tried and ranks worse for a kind the top
 * article doesn't say: "penicillin medicine" puts the discovery of
 * penicillin above penicillin.
 *
 * Wikidata's own label search is the fallback for a name with no article,
 * or when Wikipedia doesn't answer: a prefix match in an order that means
 * little ("Hamlet" puts a kind of village and a film ahead of the play),
 * which is why it isn't the first choice.
 * @param {string} name
 * @param {string} [kind]
 */
async function findCandidates(name, kind, settings) {
  const search = (query) => articleItems(query, settings).catch(() => []);
  const [plain, kinded] = await Promise.all([
    search(name),
    kind ? search(`${name} ${kind}`) : [],
  ]);
  const seen = new Set();
  const articles = [...plain, ...kinded].filter(
    (a) => !seen.has(a.id) && seen.add(a.id),
  );
  if (articles.length) return articles;
  return searchItems(name, { ...settings, limit: 8 });
}

/**
 * Check claims against Wikidata.
 *
 * @param {object[]} rawClaims  Claims as described at the top of this file.
 *   Ones prepareClaims drops are left out, not reported; a caller that wants
 *   to say why runs prepareClaims itself and calls checkPreparedClaims.
 * @param {object} [opts]
 * @param {string} [opts.userAgent]  Required outside a browser (see the top).
 * @param {typeof fetch} [opts.fetch]  Defaults to the global one.
 * @param {string} [opts.language]  For item names and descriptions.
 * @param {number} [opts.maxClaims]  Claims beyond this are dropped.
 * @returns {Promise<object[]>}  One result per kept claim, in order: the claim
 *   plus `status`, and `entity`, `wikidata` and `reason` where they apply.
 */
export async function checkClaims(rawClaims, opts = {}) {
  return checkPreparedClaims(prepareClaims(rawClaims, opts).claims, opts);
}

/**
 * Check claims prepareClaims has already passed. Same options and result as
 * checkClaims.
 */
export async function checkPreparedClaims(claims, opts = {}) {
  const settings = {
    fetch: opts.fetch || globalThis.fetch,
    userAgent: opts.userAgent,
    language: opts.language || "en",
  };
  if (!claims?.length) return [];

  // One search per distinct name and kind: "Georgia" the country and
  // "Georgia" the state are two searches, and must not share an answer.
  const searchKey = (c) =>
    [c.subject, c.kind].filter(Boolean).join(" ").toLowerCase();
  const names = [...new Set(claims.map(searchKey))];
  const candidatesByName = new Map();
  const failedNames = new Set();
  const findSubjects = eachLimited(names, 4, async (name) => {
    const { subject, kind } = claims.find((c) => searchKey(c) === name);
    try {
      candidatesByName.set(name, await findCandidates(subject, kind, settings));
    } catch {
      failedNames.add(name);
    }
  });

  // And one per distinct name a named fact states, to learn which item it
  // means: its top Wikipedia article ("USA" is the United States, "Fleming"
  // is Alexander Fleming), or failing that Wikidata's exact label matches.
  // One article, not three: the next hits for a short name are other things,
  // and a claim must not agree because one of them happened to be a value.
  // A search that fails leaves the name to be compared as words instead.
  const statedNames = [
    ...new Set(
      claims.filter((c) => c.stated).map((c) => c.stated.toLowerCase()),
    ),
  ];
  const statedIdsByName = new Map();
  const findStated = eachLimited(statedNames, 4, async (name) => {
    const stated = claims.find((c) => c.stated.toLowerCase() === name).stated;
    try {
      const [article] = await articleItems(stated, {
        ...settings,
        limit: 1,
      }).catch(() => []);
      const found = article ? [article] : await exactMatches(stated, settings);
      statedIdsByName.set(
        name,
        found.map((m) => m.id),
      );
    } catch {
      // Compared by label in itemAgrees.
    }
  });

  // The two lookups don't depend on each other, so they share the wait.
  await Promise.all([findSubjects, findStated]);

  // One query for every candidate's values.
  const itemIds = [
    ...new Set([...candidatesByName.values()].flat().map((c) => c.id)),
  ];
  const pids = [
    ...new Set(claims.flatMap((c) => FACT_PROPERTIES[c.property].pids)),
  ];
  let statements = new Map();
  let items = new Map();
  let valuesFailed = false;
  if (itemIds.length) {
    try {
      ({ statements, items } = await fetchStatements(itemIds, pids, settings));
    } catch {
      valuesFailed = true;
    }
  }

  return claims.map((claim) => {
    const name = searchKey(claim);
    if (failedNames.has(name)) {
      return { ...claim, status: "unknown", reason: "lookup-failed" };
    }
    const candidates = candidatesByName.get(name) || [];
    if (!candidates.length) {
      return { ...claim, status: "unknown", reason: "no-item" };
    }
    const item = chooseItem(claim, candidates, statements);
    // Wikidata's own label and description where the query brought them,
    // and the search's (an article title, or a label) otherwise.
    const known = items.get(item.id) || {};
    const entity = {
      id: item.id,
      label: known.label || item.label,
      description: known.description || item.description || "",
      url: wikidataItemUrl(item.id),
    };
    if (valuesFailed) {
      return { ...claim, entity, status: "unknown", reason: "lookup-failed" };
    }
    return {
      ...claim,
      entity,
      ...judgeClaim(
        claim,
        statements.get(item.id),
        statedIdsByName.get(claim.stated?.toLowerCase()),
      ),
    };
  });
}
