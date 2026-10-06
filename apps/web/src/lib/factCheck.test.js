// The editor words every fact itself, from the `facts` keys in checks.json. A
// property or unit added to core without wording would show the panel a bare
// i18n key, so these keep the two in step, and pin down how a finding reads.

import { describe, expect, it } from "vitest";
import i18next from "i18next";
import {
  FACT_PROPERTY_KEYS,
  FACT_UNIT_KEYS,
} from "@spelling-creator/core/factCheck";

import checks from "../locales/en/checks.json";
import { dateText, describeFact, quantityText } from "./factCheck.js";

const t = await (async () => {
  const instance = i18next.createInstance();
  await instance.init({
    lng: "en",
    resources: { en: { checks } },
    ns: ["checks"],
    defaultNS: "checks",
    interpolation: { escapeValue: false },
  });
  return instance.getFixedT("en", "checks");
})();

describe("wording", () => {
  it("has a name for every property core can check", () => {
    for (const key of FACT_PROPERTY_KEYS) {
      expect(checks.facts.properties[key], key).toBeTruthy();
    }
    expect(Object.keys(checks.facts.properties).sort()).toEqual(
      [...FACT_PROPERTY_KEYS].sort(),
    );
  });

  it("can write every unit, through Intl or checks.json", () => {
    for (const unit of FACT_UNIT_KEYS) {
      const written = quantityText(t, "en", 2, unit);
      expect(written, unit).not.toContain("facts.units");
      if (unit) expect(written, unit).not.toBe("2");
    }
  });
});

describe("describing a fact", () => {
  const everest = {
    quote: "8,000 METRES",
    subject: "Mount Everest",
    property: "height",
    entity: { id: "Q513", label: "Mount Everest" },
  };

  it("says what Wikidata gives, in the passage's unit", () => {
    expect(
      describeFact(
        t,
        {
          ...everest,
          status: "disagrees",
          wikidata: { value: 8848.86, unit: "m" },
        },
        "en",
      ),
    ).toBe(
      '"8,000 METRES": Wikidata gives the height of Mount Everest as 8,848.86 meters.',
    );
  });

  it("dates a figure that was taken in a given year", () => {
    expect(
      describeFact(
        t,
        {
          quote: "9 million",
          property: "population",
          entity: { label: "Paris" },
          status: "disagrees",
          wikidata: { value: 2103778, unit: "", asOf: 2023 },
        },
        "en",
      ),
    ).toBe(
      '"9 million": Wikidata gives the population of Paris as 2,103,778 as of 2023.',
    );
  });

  it("says why a fact couldn't be checked", () => {
    expect(
      describeFact(
        t,
        { ...everest, status: "unknown", reason: "no-item", entity: undefined },
        "en",
      ),
    ).toBe('"8,000 METRES": couldn\'t find Mount Everest on Wikidata.');
    expect(
      describeFact(
        t,
        { ...everest, status: "unknown", reason: "no-value" },
        "en",
      ),
    ).toBe('"8,000 METRES": Wikidata has no height for Mount Everest.');
  });
});

describe("dates", () => {
  it("writes a date as precisely as it is known", () => {
    expect(
      dateText(t, "en-GB", { year: 1867, month: 11, day: 7, precision: 11 }),
    ).toBe("7 November 1867");
    expect(
      dateText(t, "en-GB", { year: 1969, month: 7, day: 1, precision: 10 }),
    ).toBe("July 1969");
    expect(dateText(t, "en", { year: 1889, precision: 9 })).toBe("1889");
  });

  it("writes BC years and deep time", () => {
    expect(dateText(t, "en", { year: -2560, precision: 9 })).toBe("2560 BC");
    expect(dateText(t, "en", { year: -300, precision: 7 })).toBe(
      "around 300 BC",
    );
    expect(dateText(t, "en", { year: -4540000000, precision: 2 })).toBe(
      "around 4.54 billion years ago",
    );
  });

  it("handles years before 100, which Date would read as 19xx", () => {
    expect(
      dateText(t, "en-GB", { year: 79, month: 8, day: 24, precision: 11 }),
    ).toBe("24 August 79");
  });
});
