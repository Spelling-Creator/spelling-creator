import { describe, expect, it, vi } from "vitest";

import {
  checkClaims,
  claimProblem,
  convertUnit,
  currentStatements,
  judgeClaim,
  normalizeClaim,
  parseSparqlTime,
  prepareClaims,
  quantityAgrees,
  roundingSlack,
  statementsFromBindings,
  statementsQuery,
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

describe("preparing claims", () => {
  it("says why a claim can't be checked", () => {
    const problem = (claim) => claimProblem(claim);
    expect(problem({ subject: "X", property: "colour", value: 1 })).toBe(
      "property",
    );
    expect(problem({ subject: " ", property: "height", value: 1 })).toBe(
      "subject",
    );
    expect(problem({ subject: "X", property: "height", value: "tall" })).toBe(
      "value",
    );
    expect(problem({ subject: "X", property: "height", value: 3 })).toBe(
      "unit-missing",
    );
    expect(
      problem({ subject: "X", property: "height", value: 3, unit: "kg" }),
    ).toBe("unit-wrong");
    // A population needs no unit, and a date never has one.
    expect(
      problem({ subject: "Paris", property: "population", value: 2e6 }),
    ).toBe(null);
    expect(problem({ subject: "X", property: "born", value: 1867 })).toBe(null);
    // A named fact needs the name, and no number.
    expect(problem({ subject: "Australia", property: "capital" })).toBe(
      "stated",
    );
    expect(
      problem({
        subject: "Australia",
        property: "capital",
        stated: "Canberra",
      }),
    ).toBe(null);
  });

  it("keeps the good ones in order, up to the cap, and lists the rest", () => {
    const good = {
      subject: "Nile",
      property: "length",
      value: 6650,
      unit: "km",
    };
    const { claims, dropped } = prepareClaims(
      [good, { subject: "X", property: "height", value: 3 }, good, good],
      { maxClaims: 2 },
    );
    expect(claims).toHaveLength(2);
    expect(claims[0]).toMatchObject({ subject: "Nile", qualifier: "exact" });
    expect(dropped).toEqual([
      { index: 1, reason: "unit-missing" },
      { index: 3, reason: "over-limit" },
    ]);
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

  it("asks for labels in the language, English and Wikidata's 'mul'", () => {
    expect(statementsQuery(["Q7186"], ["P569"])).toContain('"en,mul"');
    expect(statementsQuery(["Q7186"], ["P569"], "de")).toContain('"de,en,mul"');
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
function fakeWikidata({
  articles = {},
  search = {},
  bindings = [],
  fail = {},
}) {
  return vi.fn(async (url) => {
    const u = new URL(url);
    // Wikipedia's article search, keyed by what was searched. Nothing by
    // default, so a test that gives only `search` exercises the Wikidata
    // fallback.
    if (u.hostname.endsWith("wikipedia.org")) {
      if (fail.search) return new Response("", { status: 503 });
      const pages = (articles[u.searchParams.get("gsrsearch")] || []).map(
        ({ id, title }, i) => ({
          pageid: i + 1,
          index: i + 1,
          title,
          ...(id ? { pageprops: { wikibase_item: id } } : {}),
        }),
      );
      return Response.json({ query: { pages } });
    }
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

// A statement that points at another item, as the query service gives it.
const itemStatement = (item, pid, value, label, extra = {}) => ({
  item: { value: `http://www.wikidata.org/entity/${item}` },
  pid: { value: pid },
  st: { value: `${item}-${pid}-${value}` },
  rank: { value: "http://wikiba.se/ontology#NormalRank" },
  value: { value: `http://www.wikidata.org/entity/${value}` },
  valueLabel: { value: label },
  ...extra,
});

describe("checking a named fact", () => {
  it("agrees by item, by label when the name is unknown, and retires an ended value", async () => {
    const fetch = fakeWikidata({
      search: {
        Australia: [{ id: "Q408", label: "Australia", description: "country" }],
        // The stated capital, looked up to its item; "Oz capital" finds none.
        Canberra: [
          {
            id: "Q3114",
            label: "Canberra",
            match: { type: "label", text: "Canberra" },
          },
        ],
      },
      bindings: [
        itemStatement("Q408", "P36", "Q3114", "Canberra"),
        itemStatement("Q408", "P36", "Q3141", "Melbourne", {
          ended: { value: "1927-05-09T00:00:00Z" },
        }),
      ],
    });
    const claim = (stated) => ({
      subject: "Australia",
      property: "capital",
      stated,
    });
    const [byId, byLabel, former, wrong] = await checkClaims(
      [
        claim("Canberra"),
        claim("canberra "),
        claim("Melbourne"),
        claim("Sydney"),
      ],
      { fetch },
    );
    expect(byId).toMatchObject({
      status: "agrees",
      wikidata: { pid: "P36", items: [{ id: "Q3114", label: "Canberra" }] },
    });
    expect(byLabel.status).toBe("agrees");
    // Melbourne's statement has an end date, so it is not current.
    expect(former.status).toBe("disagrees");
    expect(wrong.status).toBe("disagrees");
    // Melbourne isn't offered as what Wikidata says, either.
    expect(wrong.wikidata.items.map((i) => i.label)).toEqual(["Canberra"]);
  });

  it("finds the subject through Wikipedia, searched with its kind", async () => {
    const fetch = fakeWikidata({
      articles: {
        // Wikidata's search would rank the film first; Wikipedia, asked for
        // the play, gives the play.
        "Hamlet play": [
          { id: "Q41567", title: "Hamlet" },
          { id: "Q27178", title: "Hamlet (1948 film)" },
        ],
        "William Shakespeare": [{ id: "Q692", title: "William Shakespeare" }],
      },
      bindings: [
        itemStatement("Q27178", "P57", "Q55245", "Laurence Olivier"),
        itemStatement("Q41567", "P50", "Q692", "William Shakespeare", {
          itemLabel: { value: "Hamlet" },
          itemDescription: { value: "tragedy by William Shakespeare" },
        }),
      ],
    });
    const [result] = await checkClaims(
      [
        {
          subject: "Hamlet",
          kind: "play",
          property: "creator",
          stated: "William Shakespeare",
        },
      ],
      { fetch },
    );
    expect(result).toMatchObject({
      status: "agrees",
      // Described by Wikidata, once the query has said what it is.
      entity: { id: "Q41567", description: "tragedy by William Shakespeare" },
    });
    // The subject's article search, the stated name's, and one query: no
    // Wikidata search at all.
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("describes a candidate by its article title until Wikidata has said", async () => {
    const fetch = fakeWikidata({
      articles: {
        "Mercury planet": [{ id: "Q308", title: "Mercury (planet)" }],
      },
    });
    const [result] = await checkClaims(
      [
        {
          subject: "Mercury",
          kind: "planet",
          property: "mass",
          value: 1,
          unit: "kg",
        },
      ],
      { fetch },
    );
    expect(result).toMatchObject({
      status: "unknown",
      reason: "no-value",
      entity: { id: "Q308", label: "Mercury", description: "planet" },
    });
  });

  it("resolves the stated name through Wikipedia too", async () => {
    const fetch = fakeWikidata({
      articles: {
        "Amazon river": [{ id: "Q3783", title: "Amazon River" }],
        "Atlantic Ocean": [{ id: "Q97", title: "Atlantic Ocean" }],
      },
      bindings: [itemStatement("Q3783", "P403", "Q97", "Atlantic Ocean")],
    });
    const [result] = await checkClaims(
      [
        {
          subject: "Amazon",
          kind: "river",
          property: "flows_into",
          stated: "Atlantic Ocean",
        },
      ],
      { fetch },
    );
    expect(result).toMatchObject({ status: "agrees", entity: { id: "Q3783" } });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("searches once per name and kind, not once per name", async () => {
    const fetch = fakeWikidata({
      articles: {
        "Mercury planet": [{ id: "Q308", title: "Mercury (planet)" }],
        // Copernicium has a discoverer and the element mercury doesn't; the
        // kind the author gave still wins.
        "Mercury element": [
          { id: "Q925", title: "Mercury (element)" },
          { id: "Q1278", title: "Copernicium" },
        ],
      },
      bindings: [
        // The planet's discoverer is "unknown value": a blank node, not an item.
        itemStatement("Q308", "P61", "", "", {
          value: { value: "http://www.wikidata.org/.well-known/genid/abc" },
        }),
        itemStatement("Q1278", "P61", "Q1", "GSI"),
      ],
    });
    const [planet, element] = await checkClaims(
      [
        {
          subject: "Mercury",
          kind: "planet",
          property: "discoverer",
          stated: "X",
        },
        {
          subject: "Mercury",
          kind: "element",
          property: "discoverer",
          stated: "X",
        },
      ],
      { fetch },
    );
    // Each claim found its own thing, and neither has a discoverer to check.
    expect(planet).toMatchObject({
      entity: { id: "Q308" },
      reason: "no-value",
    });
    expect(element).toMatchObject({
      entity: { id: "Q925" },
      reason: "no-value",
    });
  });

  it("reads pooled properties together", () => {
    const byPid = new Map([
      ["P6", [{ value: "Q1", valueLabel: "The PM", rank: "normal" }]],
      ["P35", [{ value: "Q2", valueLabel: "The King", rank: "normal" }]],
    ]);
    const king = {
      property: "leader",
      stated: "The King",
      qualifier: "exact",
    };
    expect(judgeClaim(king, byPid)).toMatchObject({
      status: "agrees",
      wikidata: { pid: "P6" },
    });
    expect(judgeClaim(king, byPid).wikidata.items).toHaveLength(2);
  });
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
    // Wikipedia for the one name (nothing, so Wikidata's search next), then
    // one query for the values.
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0][1].headers["User-Agent"]).toBe("test");
  });

  it("falls back to Wikidata's search, preferring the right kind, when Wikipedia has no article", async () => {
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
