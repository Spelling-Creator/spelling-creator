import { describe, expect, it, vi } from "vitest";

import {
  dateSpan,
  type Eruption,
  type EruptionDate,
  eruptionOverlaps,
  latestEruption,
  recordedSince,
  volcanoRecords,
} from "./smithsonian.ts";

describe("a volcano's record", () => {
  it("asks each layer once for every volcano, and sorts eruptions oldest first", async () => {
    const fetch = vi.fn(async (url) => {
      const u = new URL(url);
      expect(u.hostname).toBe("webservices.volcano.si.edu");
      expect(u.searchParams.get("CQL_FILTER")).toBe(
        "Volcano_Number IN (211020,321050)",
      );
      expect(u.searchParams.get("outputFormat")).toBe("application/json");
      const features = u.searchParams.get("typeNames")?.endsWith("Eruptions")
        ? [
            {
              Volcano_Number: 211020,
              Activity_Type: "Confirmed Eruption",
              StartDateYear: 1913,
              StartDateMonth: 7,
              StartDateDay: 5,
              EndDateYear: 1944,
              EndDateMonth: 4,
              EndDateDay: 4,
            },
            {
              Volcano_Number: 211020,
              Activity_Type: "Uncertain Eruption",
              StartDateYear: -2420,
              StartDateMonth: 0,
              StartDateDay: 0,
              StartDateYearUncertainty: 40,
              EndDateYear: null,
            },
          ]
        : [
            {
              Volcano_Number: 211020,
              Volcano_Name: "Vesuvius",
              Elevation: 1281,
            },
          ];
      return Response.json({
        features: features.map((properties) => ({ properties })),
      });
    });
    // A number that isn't one is never put in the filter.
    const records = await volcanoRecords(["211020", 321050, "1 OR 1=1"], {
      fetch,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(records.get("211020")).toEqual({
      number: "211020",
      name: "Vesuvius",
      elevation: 1281,
      eruptions: [
        {
          confirmed: false,
          start: { year: -2420, month: 0, day: 0 },
          end: null,
          uncertainty: 40,
        },
        {
          confirmed: true,
          start: { year: 1913, month: 7, day: 5 },
          end: { year: 1944, month: 4, day: 4 },
          uncertainty: 0,
        },
      ],
    });
    // No record for a volcano the layers don't have.
    expect(records.has("321050")).toBe(false);
  });

  it("asks nothing when there is no volcano to ask about", async () => {
    const fetch = vi.fn();
    expect(await volcanoRecords(["nope"], { fetch })).toEqual(new Map());
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("eruption dates", () => {
  const eruption = (
    start: EruptionDate,
    end: EruptionDate | null = null,
    uncertainty = 0,
  ): Eruption => ({
    confirmed: true,
    start,
    end,
    uncertainty,
  });

  it("covers every day a date could mean", () => {
    const [from, to] = dateSpan({ year: 1980 });
    expect(dateSpan({ year: 1980, month: 5, day: 18 })[0]).toBeGreaterThan(
      from,
    );
    expect(dateSpan({ year: 1980, month: 5, day: 18 })[0]).toBeLessThan(to);
  });

  it("overlaps a span from start to end, with its uncertainty", () => {
    const longOne = eruption(
      { year: 2004, month: 10, day: 1 },
      { year: 2008, month: 1, day: 27 },
    );
    expect(eruptionOverlaps(longOne, dateSpan({ year: 2006 }))).toBe(true);
    expect(eruptionOverlaps(longOne, dateSpan({ year: 2009 }))).toBe(false);
    expect(eruptionOverlaps(longOne, dateSpan({ year: 2009 }), 1)).toBe(true);
    const dated = eruption({ year: -1860, month: 0, day: 0 }, null, 40);
    expect(eruptionOverlaps(dated, dateSpan({ year: -1830 }))).toBe(true);
    expect(eruptionOverlaps(dated, dateSpan({ year: -1700 }))).toBe(false);
  });

  it("knows the latest confirmed eruption, and when the record can be trusted", () => {
    const record = {
      eruptions: [
        eruption({ year: -6940, month: 0, day: 0 }),
        eruption({ year: 79, month: 10, day: 24 }),
        { ...eruption({ year: 1944, month: 3, day: 18 }), confirmed: false },
      ],
    };
    expect(latestEruption(record)?.start.year).toBe(79);
    expect(recordedSince(record)).toBe(79);
    expect(recordedSince({ eruptions: [] })).toBeNull();
  });

  it("takes the eruption that went on latest, not the one that started latest", () => {
    const long = eruption(
      { year: 1983, month: 1, day: 3 },
      { year: 2018, month: 4, day: 30 },
    );
    const short = eruption(
      { year: 2008, month: 3, day: 19 },
      { year: 2009, month: 1, day: 1 },
    );
    expect(latestEruption({ eruptions: [long, short] })).toBe(long);
  });
});
