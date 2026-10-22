// Reading figures and dates out of an encyclopedia's sentences, for the fact
// check.
//
// When the structured sources can't settle a fact (none has a value, or one
// has a value that can only confirm it), ./factCheck.ts reads the subject's
// Wikipedia article (./wikipedia.ts articleText) and looks for a sentence that
// says the same thing. This file is the reading: splitting the text into
// paragraphs, sentences and clauses, and finding in each the quantities ("4-5
// kg", "8,848.86 m", "about 13 years"), the dates ("24 October 79", "2560 BC")
// and the names it mentions. Deciding whether one of them agrees with a claim
// is left to ./factCheck.ts, with the same rules as for a Wikidata value.
//
// English only: the unit words and month names are English, as are the words
// ./factCheck.ts looks for (its TEXT_WORDS).
//
// Units come back as the keys of factCheck's FACT_UNITS ("km2", "celsius"),
// and a plain number with no unit as "".

/** A figure a sentence states. A range is its middle, with its two ends. */
export interface TextQuantity {
  value: number;
  lower?: number;
  upper?: number;
  /** A key of factCheck's FACT_UNITS, or "" for a plain number. */
  unit: string;
}

/** A date a sentence states. A month or day it leaves out is 0. */
export interface TextDate {
  /** Historical, negative for BC. */
  year: number;
  month: number;
  day: number;
}

/** A paragraph of an article, as its sentences. */
export interface ArticleParagraph {
  /** Before the first heading: the article's summary of its subject. */
  lead: boolean;
  sentences: string[];
}

// Each unit's spellings in running text. Case matters, so that "K" (kelvin)
// and "L" (liters) aren't read into every "k" and "l". Short spellings that
// are also common words ("in", "t", "h", "s") are left out; Wikipedia gives a
// metric figure beside them anyway.
const UNIT_WORDS = {
  km: ["km", "kilometres", "kilometers", "kilometre", "kilometer"],
  m: ["m", "metres", "meters", "metre", "meter"],
  cm: ["cm", "centimetres", "centimeters", "centimetre", "centimeter"],
  mm: ["mm", "millimetres", "millimeters", "millimetre", "millimeter"],
  ft: ["ft", "feet", "foot"],
  in: ["inches", "inch"],
  yd: ["yd", "yards", "yard"],
  mi: ["mi", "miles", "mile"],
  nmi: ["nmi", "nautical miles", "nautical mile"],
  au: ["AU", "astronomical units", "astronomical unit"],
  ly: ["ly", "light-years", "light-year", "light years", "light year"],
  m2: ["m2", "m²", "sq m", "square metres", "square meters"],
  km2: [
    "km2",
    "km²",
    "sq km",
    "square kilometres",
    "square kilometers",
    "square kilometre",
    "square kilometer",
  ],
  ha: ["ha", "hectares", "hectare"],
  acre: ["acres", "acre"],
  ft2: ["sq ft", "ft2", "ft²", "square feet"],
  mi2: ["sq mi", "mi2", "mi²", "square miles", "square mile"],
  m3: ["m3", "m³", "cubic metres", "cubic meters"],
  km3: ["km3", "km³", "cubic kilometres", "cubic kilometers"],
  l: ["L", "litres", "liters", "litre", "liter"],
  kg: ["kg", "kilograms", "kilogram", "kilos"],
  g: ["g", "grams", "gram"],
  t: ["tonnes", "tonne", "metric tons"],
  lb: ["lb", "lbs", "pounds", "pound"],
  oz: ["oz", "ounces", "ounce"],
  earth_mass: ["Earth masses", "Earth mass"],
  "m/s": ["m/s", "metres per second", "meters per second"],
  "km/h": ["km/h", "kph", "kilometres per hour", "kilometers per hour"],
  mph: ["mph", "miles per hour"],
  knot: ["knots", "knot", "kn"],
  celsius: ["°C", "degrees Celsius", "degrees C"],
  fahrenheit: ["°F", "degrees Fahrenheit", "degrees F"],
  kelvin: ["K", "kelvin"],
  s: ["seconds", "second", "sec"],
  min: ["minutes", "minute", "min"],
  h: ["hours", "hour", "hrs", "hr"],
  day: ["days", "day"],
  week: ["weeks", "week"],
  month: ["months", "month"],
  year: ["years", "year", "yrs", "yr"],
} satisfies Record<string, string[]>;

const UNIT_BY_WORD = new Map(
  Object.entries(UNIT_WORDS).flatMap(([unit, spellings]) =>
    spellings.map((word): [string, string] => [word, unit]),
  ),
);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

// Longest first, so "km/h" wins over "km" and "nautical miles" over "miles".
const UNIT_PATTERN = [...UNIT_BY_WORD.keys()]
  .sort((a, b) => b.length - a.length)
  .map(escape)
  .join("|");

const SCALES: Record<string, number> = {
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
  trillion: 1e12,
};

// Spaces as articles write them between a number and its unit, non-breaking
// ones included.
const SP = "[\\s\\u00a0\\u202f]";
// A number as written: "8,848.86", "4.5", "−89.2" (with a minus sign).
const NUM = "[-\\u2212]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?";
const SCALE = `(?:${SP}+(${Object.keys(SCALES).join("|")}))?`;
const UNIT = `(?:${SP}*(${UNIT_PATTERN})(?![\\p{L}\\p{N}]))?`;
// "4-5 kg" (with a hyphen, or the en dash Wikipedia uses), "64 to 67 days",
// "between 64 and 67 days": two numbers sharing what follows.
const RANGE = `(?:${SP}*(?:[-\\u2013\\u2014]|to|and)${SP}*(${NUM}))?`;

const QUANTITY = new RegExp(
  `(?<![\\p{L}\\p{N}.,])(${NUM})${RANGE}${SCALE}${UNIT}`,
  "gu",
);

const toNumber = (text: string) =>
  Number(String(text).replace(/,/g, "").replace("−", "-"));

/**
 * The quantities a sentence states, each in the unit it was written in. A
 * range comes back as its middle with `lower` and `upper`.
 *
 * A plain number that is part of a date ("in 2011", "18 May 1980") isn't a
 * count, so "In the 2011 census it had 812 people" gives only 812.
 */
export function quantitiesIn(sentence: string): TextQuantity[] {
  const text = String(sentence || "");
  const out: TextQuantity[] = [];
  let dates: DateMatch[] | undefined;
  for (const match of text.matchAll(QUANTITY)) {
    const [, first, second, scaleWord, unitWord] = match;
    const scale = SCALES[scaleWord] || 1;
    // UNIT_PATTERN is made of UNIT_BY_WORD's keys, so a matched word is one.
    const unit = unitWord ? UNIT_BY_WORD.get(unitWord)! : "";
    if (!unit) {
      dates ??= dateMatches(text);
      if (dates.some(({ from, to }) => match.index >= from && match.index < to))
        continue;
    }
    const a = toNumber(first) * scale;
    if (!Number.isFinite(a)) continue;
    if (second != null) {
      const b = toNumber(second) * scale;
      if (Number.isFinite(b) && b >= a) {
        out.push({ value: (a + b) / 2, lower: a, upper: b, unit });
        continue;
      }
    }
    out.push({ value: a, unit });
  }
  return out;
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const MONTH_PATTERN =
  "(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\\.?";

const monthNumber = (word: string) =>
  MONTHS.findIndex((m) => m.startsWith(word.toLowerCase().slice(0, 3))) + 1;

const ERA = `(?:${SP}*(BCE|BC|CE|AD))?`;
const YEAR = "(\\d{1,4})";

// "24 October 79", "October 24, 1980", "October 1980".
const DAY_MONTH_YEAR = new RegExp(
  `\\b(\\d{1,2})${SP}+${MONTH_PATTERN},?${SP}+(?:AD${SP}+)?${YEAR}${ERA}(?!\\d)`,
  "g",
);
const MONTH_DAY_YEAR = new RegExp(
  `\\b${MONTH_PATTERN}${SP}+(\\d{1,2}),?${SP}+(?:AD${SP}+)?${YEAR}${ERA}(?!\\d)`,
  "g",
);
// After the two above, so "October 24, 1980" is already taken whole.
const MONTH_YEAR = new RegExp(
  `\\b${MONTH_PATTERN}${SP}+(?:AD${SP}+)?${YEAR}${ERA}(?!\\d)`,
  "g",
);
// A year with its era ("2560 BC", "AD 79").
const ERA_YEAR = new RegExp(
  `(?<![\\d.,])(?:${YEAR}${SP}*(BCE|BC|CE|AD)\\b|AD${SP}+${YEAR}\\b)`,
  "g",
);
// Or a bare one from 1000 to 2099 that isn't part of a bigger number and has
// no unit after it: "1500 m" is a height.
const BARE_YEAR = new RegExp(
  `(?<![\\d.,\\u2212-])\\b(1\\d{3}|20\\d{2})\\b(?![.,]?\\d)(?!${SP}*(?:${UNIT_PATTERN})(?![\\p{L}\\p{N}]))`,
  "gu",
);
// A bare number is only a year after a word that introduces one ("in 1887",
// "the 1980 eruption", "from 1887 to 1889", "(1920-2001)"). Without one, "1200
// workers" would be a year.
const BEFORE_YEAR =
  /(?:\b(?:in|on|since|from|until|till|by|of|after|before|around|circa|c\.|ca\.|between|and|to|through|during|the|early|late|mid|year|born|died|spring|summer|autumn|fall|winter)|[(–—])\s*$/i;
// "4.5 billion years ago", "10,000 years ago".
const YEARS_AGO = new RegExp(
  `(?<![\\p{L}\\p{N}.,])(${NUM})${SCALE}${SP}+years${SP}+ago`,
  "gu",
);

const signed = (year: string, era: string | undefined) =>
  era === "BC" || era === "BCE" ? -Number(year) : Number(year);

/**
 * The dates a sentence states, as precisely as it states them. Years are
 * historical, negative for BC, as in a claim.
 */
export function datesIn(sentence: string): TextDate[] {
  return dateMatches(String(sentence || "")).map(({ date }) => date);
}

interface DateMatch {
  date: TextDate;
  from: number;
  to: number;
}

// The dates in a text, each with where it is.
function dateMatches(text: string): DateMatch[] {
  const out: DateMatch[] = [];
  const free = (match: RegExpExecArray) =>
    !out.some(
      ({ from, to }) =>
        match.index < to && match.index + match[0].length > from,
    );
  const take = (match: RegExpExecArray, date: TextDate) => {
    out.push({ date, from: match.index, to: match.index + match[0].length });
  };
  for (const m of text.matchAll(DAY_MONTH_YEAR)) {
    take(m, { year: signed(m[3], m[4]), month: monthNumber(m[2]), day: +m[1] });
  }
  for (const m of text.matchAll(MONTH_DAY_YEAR)) {
    if (!free(m)) continue;
    take(m, { year: signed(m[3], m[4]), month: monthNumber(m[1]), day: +m[2] });
  }
  for (const m of text.matchAll(MONTH_YEAR)) {
    if (!free(m)) continue;
    take(m, { year: signed(m[2], m[3]), month: monthNumber(m[1]), day: 0 });
  }
  for (const m of text.matchAll(YEARS_AGO)) {
    if (!free(m)) continue;
    const years = toNumber(m[1]) * (SCALES[m[2]] || 1);
    if (Number.isFinite(years)) take(m, { year: -years, month: 0, day: 0 });
  }
  for (const m of text.matchAll(ERA_YEAR)) {
    if (!free(m)) continue;
    const year = m[1] != null ? signed(m[1], m[2]) : Number(m[3]);
    take(m, { year, month: 0, day: 0 });
  }
  for (const m of text.matchAll(BARE_YEAR)) {
    if (!free(m) || !BEFORE_YEAR.test(text.slice(0, m.index))) continue;
    take(m, { year: Number(m[1]), month: 0, day: 0 });
  }
  return out;
}

// Where a sentence ends: a full stop, question mark or exclamation mark, then
// a space and a capital letter or a quotation mark. Not after the
// abbreviations an encyclopedia uses mid-sentence, so "Mount St. Helens" and
// "c. 1500" stay whole, and not inside a number ("4.5 kg").
const SENTENCE_END =
  /(?<!\b(?:St|Mt|Ft|Dr|Mr|Mrs|Ms|Jr|Sr|c|ca|approx|vs|e\.g|i\.e|U\.S)\.)(?<=[.!?])\s+(?=["'\p{Lu}])/u;

const HEADING = /^\s*=+.*=+\s*$/;

/**
 * An article's text as paragraphs of sentences, headings left out. `lead` is
 * true for the paragraphs before the first heading, the article's summary of
 * what its subject is.
 */
export function paragraphsOf(text: string): ArticleParagraph[] {
  const out: ArticleParagraph[] = [];
  let lead = true;
  for (const line of String(text || "").split(/\n+/)) {
    if (HEADING.test(line)) {
      lead = false;
      continue;
    }
    const sentences = line
      .split(SENTENCE_END)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sentences.length) out.push({ lead, sentences });
  }
  return out;
}

// Where one clause of a sentence ends and the next begins: a semicolon, or
// "and", "but", "while" or "whereas" joining two statements. Not the "and" of
// a range ("between 64 and 67 days"), which has a number on each side.
const CLAUSE_BREAK =
  /\s*;\s*|(?<![\d−])(?:,\s*|\s+)(?:and|but|while|whilst|whereas|although)\s+(?![-−]?\d)/u;

/**
 * A sentence's clauses, so that a figure is read with the words of its own
 * clause: in "it is 100 m high and its crater is 200 m wide", 200 m is a
 * width.
 */
export function clausesOf(sentence: string): string[] {
  return String(sentence || "")
    .split(CLAUSE_BREAK)
    .filter(Boolean);
}

/**
 * A text with its figures taken out, so that the unit in "15 years" isn't
 * read as the word "year".
 */
export function withoutFigures(text: string): string {
  return String(text || "").replace(QUANTITY, " ");
}

const lower = (s: string) => String(s || "").toLowerCase();

/**
 * A test for a word starting with one of `stems` ("weigh" for "weighs" and
 * "weight"). A stem may be several words ("above sea level"). Built once and
 * run on every sentence of an article.
 */
export function stemTest(
  stems: readonly string[] | null | undefined,
): (sentence: string) => boolean {
  if (!stems?.length) return () => true;
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${stems.map((s) => escape(lower(s))).join("|")})`,
    "u",
  );
  return (sentence) => pattern.test(lower(sentence));
}

/**
 * Whether a sentence names something: the name's words, together and in
 * order, as whole words. Case doesn't matter, and a plural "s" is allowed
 * ("cats" names a cat).
 */
export function mentions(sentence: string, name: string): boolean {
  const words = lower(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (!words.length) return false;
  const pattern = words.map(escape).join("[^\\p{L}\\p{N}]+");
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${pattern}(?:e?s)?(?![\\p{L}\\p{N}])`,
    "u",
  ).test(lower(sentence));
}
