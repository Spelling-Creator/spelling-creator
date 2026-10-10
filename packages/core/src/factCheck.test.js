import { describe, expect, it, vi } from "vitest";

import {
  FACT_PROPERTY_KEYS,
  FACT_TEXT_WORDS,
  checkClaims,
  claimProblem,
  confirmFromText,
  convertUnit,
  currentStatements,
  isKind,
  judgeClaim,
  judgeVolcano,
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

// A stand-in for the Wikimedia endpoints and the Smithsonian's, answering
// from fixtures.
function fakeWikidata({
  articles = {},
  texts = {},
  search = {},
  bindings = [],
  volcanoes = [],
  eruptions = [],
  fail = {},
}) {
  return vi.fn(async (url) => {
    const u = new URL(url);
    if (u.hostname === "webservices.volcano.si.edu") {
      if (fail.smithsonian) return new Response("", { status: 503 });
      const rows = u.searchParams.get("typeNames").endsWith("Eruptions")
        ? eruptions
        : volcanoes;
      return Response.json({
        features: rows.map((properties) => ({ properties })),
      });
    }
    // An article's text, keyed by its title.
    if (u.searchParams.get("prop") === "extracts") {
      if (fail.text || fail.wikipedia) {
        return new Response("", { status: 429 });
      }
      const title = u.searchParams.get("titles");
      return Response.json({
        query: { pages: [{ title, extract: texts[title] || "" }] },
      });
    }
    // Wikipedia's article search, keyed by what was searched. Nothing by
    // default, so a test that gives only `search` exercises the Wikidata
    // fallback.
    if (u.hostname.endsWith("wikipedia.org")) {
      if (fail.search || fail.wikipedia) {
        return new Response("", { status: 503 });
      }
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

// A statement whose value is a string: a scientific name, a GVP number.
const textStatement = (item, pid, text) => ({
  item: { value: `http://www.wikidata.org/entity/${item}` },
  pid: { value: pid },
  st: { value: `${item}-${pid}-${text}` },
  rank: { value: "http://wikiba.se/ontology#NormalRank" },
  text: { value: text },
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
      source: "wikidata",
      sourceUrl: "https://www.wikidata.org/wiki/Q408",
      found: { pid: "P36", items: [{ id: "Q3114", label: "Canberra" }] },
    });
    expect(byLabel.status).toBe("agrees");
    // Melbourne's statement has an end date, so it is not current.
    expect(former.status).toBe("disagrees");
    expect(wrong.status).toBe("disagrees");
    // Melbourne isn't offered as what Wikidata says, either.
    expect(wrong.found.items.map((i) => i.label)).toEqual(["Canberra"]);
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
    // The subject's two article searches (bare, and with the kind), the
    // stated name's, and one query: no Wikidata search at all.
    expect(fetch).toHaveBeenCalledTimes(4);
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
    expect(fetch).toHaveBeenCalledTimes(4);
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

  it("lets the kind pick a later article by its title, over the name's own", async () => {
    const fetch = fakeWikidata({
      articles: {
        // The name alone means the company; the river is the kind's answer.
        Amazon: [
          { id: "Q3884", title: "Amazon (company)" },
          { id: "Q456120", title: "Amazon" },
        ],
        "Amazon river": [{ id: "Q3783", title: "Amazon River" }],
        // The kind search can rank worse than the name alone.
        penicillin: [{ id: "Q12190", title: "Penicillin" }],
        "penicillin medicine": [
          { id: "Q120776459", title: "Discovery of penicillin" },
          { id: "Q12190", title: "Penicillin" },
        ],
        "Alexander Fleming": [{ id: "Q37064", title: "Alexander Fleming" }],
      },
      bindings: [
        statement("Q3884", "P2043", 1),
        statement("Q3783", "P2043", 6400, {
          unit: { value: "http://www.wikidata.org/entity/Q828224" },
        }),
        itemStatement("Q12190", "P61", "Q37064", "Alexander Fleming"),
      ],
    });
    const [river, drug] = await checkClaims(
      [
        {
          subject: "Amazon",
          kind: "river",
          property: "length",
          value: 6400,
          unit: "km",
        },
        {
          subject: "penicillin",
          kind: "medicine",
          property: "discoverer",
          stated: "Alexander Fleming",
        },
      ],
      { fetch },
    );
    expect(river).toMatchObject({ status: "agrees", entity: { id: "Q3783" } });
    expect(drug).toMatchObject({ status: "agrees", entity: { id: "Q12190" } });
  });

  it("ignores a title that merely has the kind in it", async () => {
    const fetch = fakeWikidata({
      articles: {
        Australia: [{ id: "Q408", title: "Australia" }],
        "Australia country": [
          { id: "Q2407589", title: "Australian country music" },
          { id: "Q408", title: "Australia" },
        ],
        Canberra: [{ id: "Q3114", title: "Canberra" }],
      },
      bindings: [itemStatement("Q408", "P36", "Q3114", "Canberra")],
    });
    const [result] = await checkClaims(
      [
        {
          subject: "Australia",
          kind: "country",
          property: "capital",
          stated: "Canberra",
        },
      ],
      { fetch },
    );
    expect(result).toMatchObject({ status: "agrees", entity: { id: "Q408" } });
  });

  it("matches a surname to the full name Wikidata gives", () => {
    const byPid = new Map([
      [
        "P61",
        [{ value: "Q37064", valueLabel: "Alexander Fleming", rank: "normal" }],
      ],
    ]);
    const claim = (stated) => ({
      property: "discoverer",
      stated,
      qualifier: "exact",
    });
    expect(judgeClaim(claim("Fleming"), byPid).status).toBe("agrees");
    expect(judgeClaim(claim("Alexander Fleming"), byPid).status).toBe("agrees");
    expect(judgeClaim(claim("Alex"), byPid).status).toBe("disagrees");
  });

  it("without a kind, lets a first with nothing to check give way to one that has", async () => {
    const fetch = fakeWikidata({
      articles: {
        Mercury: [
          { id: "Q48397", title: "Mercury" },
          { id: "Q308", title: "Mercury (planet)" },
        ],
      },
      bindings: [
        statement("Q308", "P2146", 87.969, {
          unit: { value: "http://www.wikidata.org/entity/Q573" },
        }),
      ],
    });
    const [result] = await checkClaims(
      [
        {
          subject: "Mercury",
          property: "orbital_period",
          value: 88,
          unit: "day",
        },
      ],
      { fetch },
    );
    expect(result).toMatchObject({ status: "agrees", entity: { id: "Q308" } });
  });

  it("keeps the first article over a later one that merely has the property", async () => {
    const fetch = fakeWikidata({
      articles: {
        "Titanic ship": [
          { id: "Q25173", title: "Titanic" },
          { id: "Q44578", title: "Titanic (1997 film)" },
        ],
        "Harland and Wolff": [{ id: "Q1", title: "Harland & Wolff" }],
      },
      // The ship has no creator on Wikidata; the film has a director.
      bindings: [
        {
          item: { value: "http://www.wikidata.org/entity/Q25173" },
          itemLabel: { value: "Titanic" },
          itemDescription: { value: "British passenger liner, sunk in 1912" },
        },
        itemStatement("Q44578", "P57", "Q42574", "James Cameron"),
      ],
    });
    const [result] = await checkClaims(
      [
        {
          subject: "Titanic",
          kind: "ship",
          property: "creator",
          stated: "Harland and Wolff",
        },
      ],
      { fetch },
    );
    expect(result).toMatchObject({
      status: "unknown",
      reason: "no-value",
      entity: {
        id: "Q25173",
        label: "Titanic",
        description: "British passenger liner, sunk in 1912",
      },
    });
  });

  it("still checks from Wikidata's search when Wikipedia is down", async () => {
    const fetch = fakeWikidata({
      fail: { wikipedia: true },
      search: {
        Australia: [{ id: "Q408", label: "Australia", description: "country" }],
        Canberra: [
          {
            id: "Q3114",
            label: "Canberra",
            match: { type: "label", text: "Canberra" },
          },
        ],
      },
      bindings: [itemStatement("Q408", "P36", "Q3114", "Canberra")],
    });
    const [result] = await checkClaims(
      [{ subject: "Australia", property: "capital", stated: "Canberra" }],
      { fetch },
    );
    expect(result).toMatchObject({ status: "agrees", entity: { id: "Q408" } });
  });

  it("shows the article's title for an item with no label in the languages asked", async () => {
    const fetch = fakeWikidata({
      articles: { "Hamlet play": [{ id: "Q41567", title: "Hamlet" }] },
      bindings: [
        itemStatement("Q41567", "P50", "Q692", "William Shakespeare", {
          itemLabel: { value: "Q41567" },
        }),
      ],
    });
    const [result] = await checkClaims(
      [{ subject: "Hamlet", kind: "play", property: "creator", stated: "X" }],
      { fetch },
    );
    expect(result.entity.label).toBe("Hamlet");
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
      source: "wikidata",
      found: { pid: "P6" },
    });
    expect(judgeClaim(king, byPid).found.items).toHaveLength(2);
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
      found: { pid: "P2044", unit: "ft" },
    });
    expect(wrong).toMatchObject({
      status: "disagrees",
      found: { value: 8848.86, unit: "m" },
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

// Mount St. Helens as the Smithsonian has it, cut down.
const ST_HELENS = {
  number: "321050",
  name: "St. Helens",
  elevation: 2549,
  eruptions: [
    {
      confirmed: true,
      start: { year: -1860, month: 0, day: 0 },
      end: null,
      uncertainty: 40,
    },
    {
      confirmed: true,
      start: { year: 1980, month: 3, day: 27 },
      end: { year: 1986, month: 10, day: 28 },
      uncertainty: 0,
    },
    {
      confirmed: true,
      start: { year: 2004, month: 10, day: 1 },
      end: { year: 2008, month: 1, day: 27 },
      uncertainty: 0,
    },
  ],
};

describe("judging a claim against the Smithsonian", () => {
  const claim = (property, value, extra = {}) =>
    normalizeClaim({ subject: "Mount St. Helens", property, value, ...extra });

  it("compares the summit's height in the claim's unit", () => {
    expect(
      judgeVolcano(claim("height", 8363, { unit: "ft" }), ST_HELENS),
    ).toMatchObject({
      status: "agrees",
      source: "smithsonian",
      sourceUrl: "https://volcano.si.edu/volcano.cfm?vn=321050",
    });
    const wrong = judgeVolcano(
      claim("elevation", 3100, { unit: "m" }),
      ST_HELENS,
    );
    expect(wrong).toMatchObject({
      status: "disagrees",
      found: { value: 2549, unit: "m" },
    });
  });

  it("takes either end of the latest eruption as when it last erupted", () => {
    expect(judgeVolcano(claim("last_eruption", 2004), ST_HELENS).status).toBe(
      "agrees",
    );
    expect(judgeVolcano(claim("last_eruption", 2008), ST_HELENS).status).toBe(
      "agrees",
    );
    // Out of date: it has erupted since.
    expect(judgeVolcano(claim("last_eruption", 1980), ST_HELENS)).toMatchObject(
      {
        status: "disagrees",
        found: {
          year: 2004,
          month: 10,
          day: 1,
          precision: 11,
          until: { year: 2008, month: 1, day: 27 },
        },
      },
    );
  });

  it("finds any eruption a date falls in, to the day", () => {
    const may18 = claim("erupted", 1980, { month: 5, day: 18 });
    expect(judgeVolcano(may18, ST_HELENS).status).toBe("agrees");
    // A year with no eruption, after the record starts: wrong, with the
    // nearest one.
    expect(judgeVolcano(claim("erupted", 1995), ST_HELENS)).toMatchObject({
      status: "disagrees",
      found: { year: 1980, month: 3 },
    });
    // A date dated from the rocks allows its uncertainty.
    expect(judgeVolcano(claim("erupted", -1830), ST_HELENS).status).toBe(
      "agrees",
    );
    // Before the first eruption anyone saw, a missing one may just be undated.
    expect(judgeVolcano(claim("erupted", -1500), ST_HELENS)).toMatchObject({
      status: "unknown",
      reason: "before-record",
      source: "smithsonian",
    });
  });

  it("holds a date before 1583 to its year only", () => {
    const vesuvius = {
      number: "211020",
      elevation: 1281,
      eruptions: [
        {
          confirmed: true,
          start: { year: 79, month: 10, day: 24 },
          end: { year: 79, month: 10, day: 28 },
          uncertainty: 0,
        },
      ],
    };
    // The traditional date, which GVP has since revised.
    const august = normalizeClaim({
      subject: "Mount Vesuvius",
      property: "erupted",
      value: 79,
      month: 8,
      day: 24,
    });
    expect(judgeVolcano(august, vesuvius).status).toBe("agrees");
  });

  it("knows nothing of a volcano with no record", () => {
    expect(judgeVolcano(claim("erupted", 1980), undefined)).toEqual({
      status: "unknown",
      reason: "no-value",
    });
  });
});

describe("confirming a claim from an article's words", () => {
  const CAT = [
    "The cat is a small domesticated carnivorous mammal.",
    "== Characteristics ==",
    "Adult domestic cats typically weigh 4–5 kg (8.8–11.0 lb). Males are larger.",
    "The average lifespan of pet cats has risen in recent decades. In the early 1980s, it was about 7 years, rising to an average of about 13 years as of 2014.",
    "The gestation of queens lasts between 64 and 67 days.",
  ].join("\n");
  const claim = (raw) => normalizeClaim({ subject: "Cat", ...raw });

  it("finds a figure in a sentence about the property, in any unit", () => {
    expect(
      confirmFromText(
        claim({ property: "mass", value: 10, unit: "lb", qualifier: "about" }),
        CAT,
      ),
    ).toBe("Adult domestic cats typically weigh 4–5 kg (8.8–11.0 lb).");
    expect(
      confirmFromText(
        claim({
          property: "gestation",
          value: 9,
          unit: "week",
          qualifier: "about",
        }),
        CAT,
      ),
    ).toMatch(/^The gestation of queens/);
  });

  it("takes the property's word from the sentence before", () => {
    const found = confirmFromText(
      claim({
        property: "lifespan",
        value: 13,
        unit: "year",
        qualifier: "about",
      }),
      CAT,
    );
    expect(found).toMatch(
      /^The average lifespan .* about 13 years as of 2014\.$/,
    );
  });

  it("confirms nothing it can't find, or finds without the property's words", () => {
    expect(
      confirmFromText(claim({ property: "mass", value: 40, unit: "kg" }), CAT),
    ).toBeNull();
    // 7 years is in the text, but as a lifespan, not a gestation.
    expect(
      confirmFromText(
        claim({ property: "gestation", value: 7, unit: "year" }),
        CAT,
      ),
    ).toBeNull();
  });

  it("wants a claim's month in the sentence, not just its year", () => {
    const text = "The volcano erupted in 1980, after weeks of earthquakes.";
    const erupted = (month) =>
      normalizeClaim({
        subject: "Mount St. Helens",
        property: "erupted",
        value: 1980,
        month,
      });
    expect(confirmFromText(erupted(0), text)).toBe(text);
    expect(confirmFromText(erupted(5), text)).toBeNull();
    expect(confirmFromText(erupted(5), "It erupted on May 18, 1980.")).toBe(
      "It erupted on May 18, 1980.",
    );
  });

  it("reads where something is from the opening paragraphs only", () => {
    const text = [
      "The Nile is a river in northeastern Africa, flowing through Egypt and Sudan.",
      "== History ==",
      "Explorers had searched for its source since the time of the pharaohs, as far away as India.",
    ].join("\n");
    const country = (stated) =>
      normalizeClaim({ subject: "Nile", property: "country", stated });
    expect(confirmFromText(country("Egypt"), text)).toMatch(/^The Nile/);
    expect(confirmFromText(country("India"), text)).toBeNull();
  });

  it("has words for every property", () => {
    expect(Object.keys(FACT_TEXT_WORDS).sort()).toEqual(
      [...FACT_PROPERTY_KEYS].sort(),
    );
  });
});

describe("kinds of living things", () => {
  it("are taxa, breeds, and animals known by their common name", () => {
    const of = (pid, statement) => new Map([[pid, [statement]]]);
    expect(isKind(of("P225", { text: "Panthera onca", rank: "normal" }))).toBe(
      true,
    );
    expect(isKind(of("P31", { value: "Q55983715", rank: "normal" }))).toBe(
      true,
    );
    expect(isKind(of("P31", { value: "Q6256", rank: "normal" }))).toBe(false);
    expect(isKind(undefined)).toBe(false);
  });

  it("reads a string value from the query", () => {
    const byItem = statementsFromBindings([
      textStatement("Q35694", "P225", "Panthera onca"),
    ]);
    expect(byItem.get("Q35694").get("P225")[0].text).toBe("Panthera onca");
  });
});

describe("checking claims against every source", () => {
  it("asks the Smithsonian about a volcano, once for all of them", async () => {
    const fetch = fakeWikidata({
      articles: {
        "Mount St. Helens": [{ id: "Q4675", title: "Mount St. Helens" }],
        "Mount St. Helens volcano": [
          { id: "Q4675", title: "Mount St. Helens" },
        ],
      },
      bindings: [
        textStatement("Q4675", "P1886", "321050"),
        statement("Q4675", "P2044", 2549),
      ],
      volcanoes: [
        { Volcano_Number: 321050, Volcano_Name: "St. Helens", Elevation: 2549 },
      ],
      eruptions: [
        {
          Volcano_Number: 321050,
          Activity_Type: "Confirmed Eruption",
          StartDateYear: 2004,
          StartDateMonth: 10,
          StartDateDay: 1,
          EndDateYear: 2008,
          EndDateMonth: 1,
          EndDateDay: 27,
        },
      ],
    });
    const helens = (property, value, unit) => ({
      subject: "Mount St. Helens",
      kind: "volcano",
      property,
      value,
      ...(unit ? { unit } : {}),
    });
    const [last, wrong, height] = await checkClaims(
      [
        helens("last_eruption", 2008),
        helens("last_eruption", 1980),
        helens("height", 2549, "m"),
      ],
      { fetch },
    );
    expect(last).toMatchObject({
      status: "agrees",
      source: "smithsonian",
      entity: { id: "Q4675" },
    });
    expect(wrong).toMatchObject({ status: "disagrees", source: "smithsonian" });
    // Both agree; Wikidata, asked first, is the one shown.
    expect(height).toMatchObject({ status: "agrees", source: "wikidata" });
    const smithsonian = fetch.mock.calls.filter(([url]) =>
      url.startsWith("https://webservices.volcano.si.edu/"),
    );
    expect(smithsonian).toHaveLength(2);
    expect(new URL(smithsonian[0][0]).searchParams.get("CQL_FILTER")).toBe(
      "Volcano_Number IN (321050)",
    );
  });

  it("leaves a volcano claim unknown when the Smithsonian can't be reached", async () => {
    const fetch = fakeWikidata({
      articles: { "Mount Fuji": [{ id: "Q39231", title: "Mount Fuji" }] },
      bindings: [textStatement("Q39231", "P1886", "283030")],
      fail: { smithsonian: true },
    });
    const [result] = await checkClaims(
      [{ subject: "Mount Fuji", property: "last_eruption", value: 1707 }],
      { fetch },
    );
    expect(result).toMatchObject({
      status: "unknown",
      reason: "lookup-failed",
    });
  });

  it("reads the article when no source has a value, once for every claim", async () => {
    const fetch = fakeWikidata({
      articles: { Cat: [{ id: "Q146", title: "Cat" }] },
      bindings: [itemStatement("Q146", "P31", "Q55983715", "organisms")],
      texts: {
        Cat: "Adult domestic cats typically weigh 4–5 kg (8.8–11.0 lb).",
      },
    });
    const cat = (value) => ({
      subject: "Cat",
      property: "mass",
      value,
      unit: "kg",
    });
    const [right, wrong] = await checkClaims([cat(4), cat(40)], { fetch });
    expect(right).toEqual(
      expect.objectContaining({
        status: "agrees",
        source: "wikipedia",
        sourceUrl: "https://en.wikipedia.org/wiki/Cat",
        found: {
          text: "Adult domestic cats typically weigh 4–5 kg (8.8–11.0 lb).",
        },
      }),
    );
    expect(right.reason).toBeUndefined();
    // Not in the article: still unknown, never wrong.
    expect(wrong).toMatchObject({ status: "unknown", reason: "no-value" });
    const reads = fetch.mock.calls.filter(
      ([url]) => new URL(url).searchParams.get("prop") === "extracts",
    );
    expect(reads).toHaveLength(1);
  });

  it("never calls a fact about a kind of animal wrong", async () => {
    const fetch = fakeWikidata({
      articles: { Jaguar: [{ id: "Q35694", title: "Jaguar" }] },
      bindings: [
        textStatement("Q35694", "P225", "Panthera onca"),
        statement("Q35694", "P2067", 100, {
          unit: { value: "http://www.wikidata.org/entity/Q11570" },
        }),
      ],
    });
    const [result] = await checkClaims(
      [{ subject: "Jaguar", property: "mass", value: 300, unit: "kg" }],
      { fetch },
    );
    // What Wikidata said is kept, to show.
    expect(result).toMatchObject({
      status: "unknown",
      reason: "varies",
      source: "wikidata",
      found: { value: 100, unit: "kg" },
    });
  });

  it("reads no article for a language other than English", async () => {
    const fetch = fakeWikidata({
      articles: { Katze: [{ id: "Q146", title: "Katze" }] },
      texts: { Katze: "Eine Katze wiegt 4 kg." },
    });
    const [result] = await checkClaims(
      [{ subject: "Katze", property: "mass", value: 4, unit: "kg" }],
      { fetch, language: "de" },
    );
    expect(result).toMatchObject({ status: "unknown", reason: "no-value" });
    expect(
      fetch.mock.calls.some(
        ([url]) => new URL(url).searchParams.get("prop") === "extracts",
      ),
    ).toBe(false);
  });

  it("says a source couldn't be reached when the article can't be read", async () => {
    const fetch = fakeWikidata({
      articles: { Cat: [{ id: "Q146", title: "Cat" }] },
      fail: { text: true },
    });
    const [result] = await checkClaims(
      [{ subject: "Cat", property: "mass", value: 4, unit: "kg" }],
      { fetch },
    );
    expect(result).toMatchObject({
      status: "unknown",
      reason: "lookup-failed",
    });
  });
});
