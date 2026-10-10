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

  it("can name every source, and every source but Wikidata has a link", () => {
    for (const source of ["wikidata", "smithsonian", "wikipedia"]) {
      expect(checks.facts.sources[source], source).toBeTruthy();
    }
    expect(Object.keys(checks.facts.openSource).sort()).toEqual([
      "smithsonian",
      "wikipedia",
    ]);
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
          source: "wikidata",
          found: { value: 8848.86, unit: "m" },
        },
        "en",
      ),
    ).toBe(
      '"8,000 METRES": Wikidata gives the height of Mount Everest as 8,848.86 meters.',
    );
  });

  it("names the Smithsonian, and an eruption from start to end", () => {
    const helens = {
      subject: "Mount St. Helens",
      entity: { label: "Mount St. Helens" },
      source: "smithsonian",
      found: {
        year: 2004,
        month: 10,
        day: 1,
        precision: 11,
        until: { year: 2008, month: 1, day: 27, precision: 11 },
      },
    };
    expect(
      describeFact(
        t,
        {
          ...helens,
          quote: "1980",
          property: "last_eruption",
          status: "disagrees",
        },
        "en-GB",
      ),
    ).toBe(
      '"1980": the Smithsonian\'s Global Volcanism Program gives the last eruption of Mount St. Helens as 1 October 2004 to 27 January 2008.',
    );
    expect(
      describeFact(
        t,
        { ...helens, quote: "1995", property: "erupted", status: "disagrees" },
        "en-GB",
      ),
    ).toBe(
      '"1995": the Smithsonian\'s Global Volcanism Program has no eruption of Mount St. Helens then. The nearest is 1 October 2004 to 27 January 2008.',
    );
  });

  it("quotes the article for a match on Wikipedia", () => {
    expect(
      describeFact(
        t,
        {
          quote: "4 KG",
          property: "mass",
          entity: { label: "cat" },
          status: "agrees",
          source: "wikipedia",
          found: {
            text: "Adult domestic cats typically weigh 4–5 kg (8.8–11.0 lb).",
          },
        },
        "en",
      ),
    ).toBe(
      '"4 KG" matches Wikipedia, which says: Adult domestic cats typically weigh 4–5 kg (8.8–11.0 lb).',
    );
  });

  it("doesn't call a fact about a kind of animal wrong", () => {
    expect(
      describeFact(
        t,
        {
          quote: "20 YEARS",
          property: "lifespan",
          entity: { label: "cat" },
          status: "unknown",
          reason: "varies",
          source: "wikidata",
          found: { value: 15, unit: "year" },
        },
        "en",
      ),
    ).toBe(
      '"20 YEARS": Wikidata gives the lifespan of cat as 15 years. Animals vary, so this isn\'t counted as wrong.',
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
          source: "wikidata",
          found: { value: 2103778, unit: "", asOf: 2023 },
        },
        "en",
      ),
    ).toBe(
      '"9 million": Wikidata gives the population of Paris as 2,103,778 as of 2023.',
    );
  });

  it("lists what Wikidata names for a named fact", () => {
    expect(
      describeFact(
        t,
        {
          quote: "SYDNEY",
          property: "capital",
          entity: { label: "Australia" },
          status: "disagrees",
          source: "wikidata",
          found: { pid: "P36", items: [{ id: "Q3114", label: "Canberra" }] },
        },
        "en",
      ),
    ).toBe('"SYDNEY": Wikidata gives the capital of Australia as Canberra.');
    expect(
      describeFact(
        t,
        {
          quote: "EGYPT",
          property: "country",
          entity: { label: "Nile" },
          status: "agrees",
          source: "wikidata",
          found: {
            pid: "P17",
            items: [
              { id: "Q79", label: "Egypt" },
              { id: "Q1049", label: "Sudan" },
              { id: "Q1036", label: "Uganda" },
            ],
          },
        },
        "en",
      ),
    ).toBe('"EGYPT" matches Wikidata (Egypt, Sudan, and Uganda).');
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
    ).toBe('"8,000 METRES": no source gives the height of Mount Everest.');
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
