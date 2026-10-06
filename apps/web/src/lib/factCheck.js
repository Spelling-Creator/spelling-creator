// Fact checking, as the editor shows it.
//
// The lesson checks in ./lessonChecks.js are free and rerun on every pause in
// typing. This is the opposite: one request that asks a model to find the
// passages' numbers and dates and then looks each up on Wikidata, behind a
// Turnstile challenge like every other AI helper. So it runs only when asked,
// and its result is a snapshot. The panel hides any finding whose words have
// since changed in the lesson (core's quoteStillThere), which is how fixing a
// number makes its finding go away without checking again.
//
// The check itself is @spelling-creator/core/factCheck, the same code the MCP
// server's check_facts runs. Findings are worded here, from the `checks`
// namespace's `facts` keys.

import { useCallback, useState } from "react";
import { checkFacts } from "@spelling-creator/core/aiSuggest";
import { lessonPassages } from "@spelling-creator/core/factCheck";

const IDLE = Object.freeze({ status: "idle", facts: [], error: "" });

/**
 * The fact check for the lesson being edited. Lives on the editor page rather
 * than in the panel, so closing the panel to go to a finding doesn't throw the
 * result away.
 */
export function useFactCheck() {
  const [state, setState] = useState(IDLE);
  const run = useCallback(async (doc, token) => {
    setState((prev) => ({ ...prev, status: "running", error: "" }));
    try {
      const facts = await checkFacts(lessonPassages(doc), token, {
        documentName: doc?.title || "",
      });
      setState({ status: "done", facts, error: "" });
    } catch (e) {
      setState({ status: "error", facts: [], error: e.message || "" });
    }
  }, []);
  return { ...state, run };
}

// Units Intl can name in every language it knows, plurals included. The rest
// (square and cubic measures, tonnes, light-years) are worded in checks.json.
const INTL_UNITS = {
  m: "meter",
  km: "kilometer",
  cm: "centimeter",
  mm: "millimeter",
  ft: "foot",
  in: "inch",
  yd: "yard",
  mi: "mile",
  acre: "acre",
  ha: "hectare",
  l: "liter",
  kg: "kilogram",
  g: "gram",
  lb: "pound",
  oz: "ounce",
  "m/s": "meter-per-second",
  "km/h": "kilometer-per-hour",
  mph: "mile-per-hour",
  celsius: "celsius",
  fahrenheit: "fahrenheit",
  s: "second",
  min: "minute",
  h: "hour",
  day: "day",
  week: "week",
  month: "month",
  year: "year",
};

function numberText(language, value, unit) {
  const options =
    Math.abs(value) >= 1e15
      ? { maximumSignificantDigits: 4 }
      : { maximumFractionDigits: 2 };
  const intlUnit = INTL_UNITS[unit];
  if (intlUnit) {
    try {
      return new Intl.NumberFormat(language, {
        ...options,
        style: "unit",
        unit: intlUnit,
        unitDisplay: "long",
      }).format(value);
    } catch {
      // An engine without that unit; fall through to the plain number.
    }
  }
  return new Intl.NumberFormat(language, options).format(value);
}

/** A quantity as Wikidata gives it, in the passage's unit. */
export function quantityText(t, language, value, unit) {
  const number = numberText(language, value, unit);
  if (!unit || INTL_UNITS[unit]) return number;
  return t(`facts.units.${unit}`, { value: number });
}

/** A date as precisely as Wikidata knows it. */
export function dateText(t, language, { year, month, day, precision }) {
  if (year > 0 && precision >= 10) {
    const date = new Date(Date.UTC(2000, month - 1, day || 1));
    date.setUTCFullYear(year);
    return new Intl.DateTimeFormat(language, {
      year: "numeric",
      month: "long",
      ...(precision >= 11 ? { day: "numeric" } : {}),
      timeZone: "UTC",
    }).format(date);
  }
  let text;
  if (year <= -100000) {
    const years = new Intl.NumberFormat(language, {
      notation: "compact",
      compactDisplay: "long",
      maximumSignificantDigits: 3,
    }).format(-year);
    text = t("facts.yearsAgo", { years });
  } else if (year < 0) {
    text = t("facts.bc", { year: -year });
  } else {
    text = String(year);
  }
  // Known only to the decade or coarser.
  return precision < 9 ? t("facts.around", { date: text }) : text;
}

/** What Wikidata says, in words: "8,848.86 meters", "28 January 1887". */
export function wikidataText(t, language, fact) {
  const wd = fact.wikidata;
  if (!wd) return "";
  if (wd.year != null) return dateText(t, language, wd);
  const value = quantityText(t, language, wd.value, wd.unit);
  return wd.asOf ? t("facts.asOf", { value, year: wd.asOf }) : value;
}

/**
 * One fact in the editor's words.
 * @param {import("i18next").TFunction} t  Bound to the `checks` namespace.
 */
export function describeFact(t, fact, language) {
  const values = {
    quote: fact.quote,
    subject: fact.entity?.label || fact.subject,
    property: t(`facts.properties.${fact.property}`),
    value: wikidataText(t, language, fact),
  };
  if (fact.status === "unknown") {
    return t(`facts.unknown.${fact.reason || "no-value"}`, values);
  }
  return t(`facts.${fact.status}`, values);
}
