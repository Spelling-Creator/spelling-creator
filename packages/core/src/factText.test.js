import { describe, expect, it } from "vitest";

import {
  datesIn,
  mentions,
  paragraphsOf,
  quantitiesIn,
  stemTest,
} from "./factText.js";

describe("quantities in a sentence", () => {
  it("reads numbers with their units, as Wikipedia writes them", () => {
    expect(quantitiesIn("Everest is 8,848.86 m (29,031.7 ft) high.")).toEqual([
      { value: 8848.86, unit: "m" },
      { value: 29031.7, unit: "ft" },
    ]);
    expect(quantitiesIn("It reached −89.2 °C and 100 km/h.")).toEqual([
      { value: -89.2, unit: "celsius" },
      { value: 100, unit: "km/h" },
    ]);
  });

  it("reads a range as its middle and its ends", () => {
    expect(quantitiesIn("They weigh 4–5 kg.")).toEqual([
      { value: 4.5, lower: 4, upper: 5, unit: "kg" },
    ]);
    expect(quantitiesIn("It lasts between 64 and 67 days.")).toEqual([
      { value: 65.5, lower: 64, upper: 67, unit: "day" },
    ]);
  });

  it("scales words, and leaves a plain number without a unit", () => {
    expect(quantitiesIn("About 2.1 million people live there.")).toEqual([
      { value: 2100000, unit: "" },
    ]);
  });

  it("doesn't read a unit out of a longer word", () => {
    expect(quantitiesIn("Seen by 5 monks.")).toEqual([{ value: 5, unit: "" }]);
    expect(quantitiesIn("All 3 kinds.")).toEqual([{ value: 3, unit: "" }]);
  });
});

describe("dates in a sentence", () => {
  it("reads days, months, eras and years ago", () => {
    expect(
      datesIn(
        "It erupted on 18 May 1980, on October 24, 79, in October 2004, in AD 79 and in 2560 BC.",
      ),
    ).toEqual(
      expect.arrayContaining([
        { year: 1980, month: 5, day: 18 },
        { year: 79, month: 10, day: 24 },
        { year: 2004, month: 10, day: 0 },
        { year: 79, month: 0, day: 0 },
        { year: -2560, month: 0, day: 0 },
      ]),
    );
    expect(datesIn("It formed 4.5 billion years ago.")).toEqual([
      { year: -4.5e9, month: 0, day: 0 },
    ]);
  });

  it("reads each date once, and not out of other numbers", () => {
    expect(datesIn("Built from 1887 to 1889.")).toEqual([
      { year: 1887, month: 0, day: 0 },
      { year: 1889, month: 0, day: 0 },
    ]);
    expect(datesIn("On May 18, 1980.")).toEqual([
      { year: 1980, month: 5, day: 18 },
    ]);
    expect(datesIn("It is 1,980.5 m and 21980 people.")).toEqual([]);
  });
});

describe("an article's paragraphs", () => {
  it("splits sentences, keeps abbreviations whole, and marks the lead", () => {
    const text = [
      "Mount St. Helens is a volcano. It erupted c. 1480 and again later.",
      "== History ==",
      "The 1980 eruption was huge.",
    ].join("\n");
    expect(paragraphsOf(text)).toEqual([
      {
        lead: true,
        sentences: [
          "Mount St. Helens is a volcano.",
          "It erupted c. 1480 and again later.",
        ],
      },
      { lead: false, sentences: ["The 1980 eruption was huge."] },
    ]);
  });
});

describe("words in a sentence", () => {
  it("finds a word by its start, and a name with a plural", () => {
    const aboutMass = stemTest(["weigh", "mass"]);
    expect(aboutMass("Adult cats weigh 4 kg.")).toBe(true);
    expect(aboutMass("Its weight is 4 kg.")).toBe(true);
    expect(aboutMass("A massive 4 kg.")).toBe(true);
    expect(aboutMass("Amass 4 kg.")).toBe(false);
    expect(stemTest([])("Anything at all.")).toBe(true);
    expect(mentions("Adult domestic cats weigh", "cat")).toBe(true);
    expect(mentions("Its capital is Canberra.", "canberra")).toBe(true);
    expect(mentions("Canberran suburbs.", "Canberra")).toBe(false);
  });
});
