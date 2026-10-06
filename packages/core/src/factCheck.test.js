import { describe, expect, it, vi } from "vitest";

import {
  checkClaims,
  convertUnit,
  currentStatements,
  normalizeClaim,
  parseSparqlTime,
  quantityAgrees,
  roundingSlack,
  statementsFromBindings,
  timeAgrees,
} from "./factCheck.js";

describe("rounding", () => {
  it("allows half a unit in the last place the number was written to", () => {
    expect(roundingSlack(8849)).toBe(0.5);
    expect(roundingSlack(9000)).toBe(500);
    expect(roundingSlack(8848.86)).toBeCloseTo(0.005);
    expect(roundingSlack(4.5e9)).toBe(5e7);
    expect(roundingSlack(-2560)).toBe(5);
    expect(roundingSlack(0)).toBe(0);
  });
});

describe("units", () => {
  it("converts within a dimension and refuses across them", () => {
    expect(convertUnit(1, "km", "m")).toBe(1000);
    expect(convertUnit(8848.86, "m", "ft")).toBeCloseTo(29031.69, 1);
    expect(convertUnit(100, "celsius", "fahrenheit")).toBeCloseTo(212);
    expect(convertUnit(0, "celsius", "kelvin")).toBeCloseTo(273.15);
    expect(convertUnit(1, "kg", "m")).toBeNull();
    expect(convertUnit(1, "furlong", "m")).toBeNull();
  });
});

describe("normalizing a claim", () => {
  it("fills in defaults", () => {
    expect(
      normalizeClaim({
        subject: " Nile ",
        property: "length",
        value: "6650",
        unit: "km",
      }),
    ).toMatchObject({
      subject: "Nile",
      value: 6650,
      unit: "km",
      qualifier: "exact",
      month: 0,
      day: 0,
    });
  });

  it("rejects what can't be checked", () => {
    expect(normalizeClaim({ subject: "X", property: "colour", value: 1 })).toBe(
      null,
    );
    expect(normalizeClaim({ subject: "", property: "height", value: 1 })).toBe(
      null,
    );
    expect(
      normalizeClaim({ subject: "X", property: "height", value: "tall" }),
    ).toBe(null);
    // A unit that measures the wrong thing is a bad extraction.
    expect(
      normalizeClaim({
        subject: "X",
        property: "height",
        value: 3,
        unit: "kg",
      }),
    ).toBe(null);
  });

  it("drops units from counts and dates, and day parts from quantities", () => {
    expect(
      normalizeClaim({
        subject: "Paris",
        property: "population",
        value: 2e6,
        unit: "km",
      }).unit,
    ).toBe("");
    expect(
      normalizeClaim({
        subject: "X",
        property: "born",
        value: 1867,
        unit: "m",
        month: 13,
        day: 7,
      }),
    ).toMatchObject({ unit: "", month: 0, day: 7 });
  });
});

describe("reading the query service", () => {
  it("undoes the year-zero shift for dates known to the year", () => {
    expect(parseSparqlTime("-2559-01-01T00:00:00Z", 9).year).toBe(-2560);
    expect(parseSparqlTime("1889-03-31T00:00:00Z", 11)).toEqual({
      year: 1889,
      month: 3,
      day: 31,
    });
  });

  it("leaves coarser dates alone, as the service does", () => {
    expect(parseSparqlTime("-0300-01-01T00:00:00Z", 7).year).toBe(-300);
    expect(parseSparqlTime("-4540000000-01-01T00:00:00Z", 2).year).toBe(
      -4540000000,
    );
  });

  it("keeps a statement once, dated by its latest point in time", () => {
    const row = (pit) => ({
      item: { value: "http://www.wikidata.org/entity/Q90" },
      pid: { value: "P1082" },
      st: { value: "s1" },
      rank: { value: "http://wikiba.se/ontology#NormalRank" },
      amount: { value: "2145906" },
      unit: { value: "http://www.wikidata.org/entity/Q199" },
      pit: { value: pit },
    });
    const out = statementsFromBindings([
      row("2019-01-01T00:00:00Z"),
      row("2020-01-01T00:00:00Z"),
    ]);
    const statements = out.get("Q90").get("P1082");
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({
      amount: 2145906,
      unit: "Q199",
      rank: "normal",
      pointInTime: { year: 2020 },
    });
  });
});

describe("which statements count", () => {
  it("never counts deprecated ones", () => {
    expect(
      currentStatements([
        { rank: "deprecated", amount: 1 },
        { rank: "normal", amount: 2 },
      ]),
    ).toEqual([{ rank: "normal", amount: 2 }]);
  });

  it("counts only the latest of dated figures", () => {
    const old = { rank: "normal", amount: 1, pointInTime: { year: 1910 } };
    const now = { rank: "normal", amount: 2, pointInTime: { year: 2020 } };
    expect(currentStatements([old, now])).toEqual([now]);
  });
});

describe("comparing", () => {
  const claim = (value, qualifier = "exact") => ({ value, qualifier });

  it("lets a quantity round the way it was written", () => {
    expect(quantityAgrees(claim(9000), { value: 8848.86 })).toBe(true);
    expect(quantityAgrees(claim(8000), { value: 8848.86 })).toBe(false);
    expect(quantityAgrees(claim(6000, "about"), { value: 6650 })).toBe(true);
    expect(quantityAgrees(claim(5000, "about"), { value: 6650 })).toBe(false);
  });

  it("reads 'more than' and 'less than' as bounds", () => {
    expect(quantityAgrees(claim(8000, "more_than"), { value: 8848 })).toBe(
      true,
    );
    expect(quantityAgrees(claim(10000, "more_than"), { value: 8848 })).toBe(
      false,
    );
    expect(quantityAgrees(claim(9000, "less_than"), { value: 8848 })).toBe(
      true,
    );
  });

  it("accepts anything inside Wikidata's stated bounds", () => {
    expect(
      quantityAgrees(claim(7500000), {
        value: 7000000,
        lower: 7000000,
        upper: 8000000,
      }),
    ).toBe(true);
  });

  it("compares dates as precisely as Wikidata knows them", () => {
    const day = { year: 1867, month: 11, day: 7, precision: 11 };
    expect(timeAgrees({ ...claim(1867), month: 11, day: 7 }, day)).toBe(true);
    expect(timeAgrees({ ...claim(1867), month: 5 }, day)).toBe(false);
    expect(timeAgrees(claim(1868), day)).toBe(false);

    const century = { year: -300, precision: 7 };
    expect(timeAgrees(claim(-250), century)).toBe(true);
    expect(timeAgrees(claim(-500), century)).toBe(false);
  });

  it("rounds big and hedged years", () => {
    expect(timeAgrees(claim(-4.5e9), { year: -4.54e9, precision: 2 })).toBe(
      true,
    );
    expect(
      timeAgrees(claim(-2500, "about"), { year: -2560, precision: 9 }),
    ).toBe(true);
    expect(timeAgrees(claim(-2500), { year: -2560, precision: 9 })).toBe(false);
  });

  it("skips month and day for Julian dates", () => {
    const julian = {
      year: 1564,
      month: 2,
      day: 15,
      precision: 11,
      calendar: "Q1985786",
    };
    expect(timeAgrees({ ...claim(1564), month: 2, day: 25 }, julian)).toBe(
      true,
    );
  });
});

// A stand-in for the two Wikimedia endpoints, answering from fixtures.
function fakeWikidata({ search = {}, bindings = [], fail = {} }) {
  return vi.fn(async (url) => {
    const u = new URL(url);
    if (u.hostname === "www.wikidata.org") {
      if (fail.search) return new Response("", { status: 503 });
      const hits = search[u.searchParams.get("search")] || [];
      return Response.json({ search: hits });
    }
    if (fail.sparql) return new Response("", { status: 503 });
    return Response.json({ results: { bindings } });
  });
}

const statement = (item, pid, value, extra = {}) => ({
  item: { value: `http://www.wikidata.org/entity/${item}` },
  pid: { value: pid },
  st: { value: `${item}-${pid}-${value}` },
  rank: { value: "http://wikiba.se/ontology#NormalRank" },
  amount: { value: String(value) },
  unit: { value: "http://www.wikidata.org/entity/Q11573" },
  ...extra,
});

describe("checking claims", () => {
  it("finds the item, reads the value and judges the claim", async () => {
    const fetch = fakeWikidata({
      search: {
        "Mount Everest": [
          { id: "Q513", label: "Mount Everest", description: "mountain" },
        ],
      },
      bindings: [statement("Q513", "P2044", 8848.86)],
    });
    const [right, wrong] = await checkClaims(
      [
        {
          subject: "Mount Everest",
          property: "height",
          value: 29032,
          unit: "ft",
          quote: "29,032 FEET",
        },
        {
          subject: "Mount Everest",
          property: "height",
          value: 8000,
          unit: "m",
        },
      ],
      { fetch, userAgent: "test" },
    );
    expect(right).toMatchObject({
      status: "agrees",
      quote: "29,032 FEET",
      entity: { id: "Q513", url: "https://www.wikidata.org/wiki/Q513" },
      wikidata: { pid: "P2044", unit: "ft" },
    });
    expect(wrong).toMatchObject({
      status: "disagrees",
      wikidata: { value: 8848.86, unit: "m" },
    });
    // One search for the one name, one query for the values.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1].headers["User-Agent"]).toBe("test");
  });

  it("prefers the candidate that has the property, then the one of the right kind", async () => {
    const fetch = fakeWikidata({
      search: {
        Georgia: [
          { id: "Q1428", label: "Georgia", description: "state of the US" },
          { id: "Q230", label: "Georgia", description: "country in Asia" },
          { id: "Q9", label: "Georgia", description: "given name" },
        ],
      },
      bindings: [
        statement("Q1428", "P1082", 11000000, {
          unit: { value: "http://www.wikidata.org/entity/Q199" },
        }),
        statement("Q230", "P1082", 3700000, {
          unit: { value: "http://www.wikidata.org/entity/Q199" },
        }),
      ],
    });
    const [result] = await checkClaims(
      [
        {
          subject: "Georgia",
          kind: "country",
          property: "population",
          value: 3700000,
        },
      ],
      { fetch },
    );
    expect(result).toMatchObject({ status: "agrees", entity: { id: "Q230" } });
  });

  it("says what it couldn't check, and why", async () => {
    const fetch = fakeWikidata({
      search: {
        Octopus: [{ id: "Q611843", label: "Octopus", description: "genus" }],
      },
    });
    const [missingValue, missingItem] = await checkClaims(
      [
        { subject: "Octopus", property: "mass", value: 15, unit: "kg" },
        { subject: "Zorblax", property: "began", value: 1200 },
      ],
      { fetch },
    );
    expect(missingValue).toMatchObject({
      status: "unknown",
      reason: "no-value",
      entity: { id: "Q611843" },
    });
    expect(missingItem).toMatchObject({ status: "unknown", reason: "no-item" });
  });

  it("reports an unreachable Wikidata as unknown rather than throwing", async () => {
    const fetch = fakeWikidata({
      search: { Nile: [{ id: "Q3392", label: "Nile", description: "river" }] },
      fail: { sparql: true },
    });
    const [result] = await checkClaims(
      [{ subject: "Nile", property: "length", value: 6650, unit: "km" }],
      { fetch },
    );
    expect(result).toMatchObject({
      status: "unknown",
      reason: "lookup-failed",
    });

    const down = fakeWikidata({ fail: { search: true } });
    const [again] = await checkClaims(
      [{ subject: "Nile", property: "length", value: 6650, unit: "km" }],
      { fetch: down },
    );
    expect(again).toMatchObject({ status: "unknown", reason: "lookup-failed" });
  });

  it("drops claims it can't read and makes no requests for none", async () => {
    const fetch = fakeWikidata({});
    expect(
      await checkClaims([{ subject: "X", property: "colour", value: 1 }], {
        fetch,
      }),
    ).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
