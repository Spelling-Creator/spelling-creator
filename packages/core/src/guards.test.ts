// The guards core reads untrusted values with. The difference between the two
// object checks is the point: one lets an array through, one doesn't.

import { describe, expect, it } from "vitest";

import { errorName, isObjectLike, isRecord, ownValue } from "./guards.ts";

describe("isRecord and isObjectLike", () => {
  it("agree on objects and on what isn't one", () => {
    for (const value of [null, undefined, 0, "", "text", true]) {
      expect(isRecord(value)).toBe(false);
      expect(isObjectLike(value)).toBe(false);
    }
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isObjectLike({ a: 1 })).toBe(true);
  });

  it("differ on an array", () => {
    expect(isRecord([1])).toBe(false);
    expect(isObjectLike([1])).toBe(true);
  });
});

describe("ownValue", () => {
  const map = { left: "L", right: "R" };

  it("finds the map's own entries", () => {
    expect(ownValue(map, "left")).toBe("L");
    expect(ownValue(map, "middle")).toBe(undefined);
  });

  it("never finds what every object inherits", () => {
    for (const key of [
      "constructor",
      "toString",
      "hasOwnProperty",
      "__proto__",
    ]) {
      expect(ownValue(map, key)).toBe(undefined);
    }
  });

  it("takes only a string key", () => {
    expect(ownValue(map, 5)).toBe(undefined);
    expect(ownValue(map, null)).toBe(undefined);
  });
});

describe("errorName", () => {
  it("reads a thrown error's name, and nothing off anything else", () => {
    expect(errorName(new DOMException("stop", "AbortError"))).toBe(
      "AbortError",
    );
    expect(errorName("AbortError")).toBe(undefined);
    expect(errorName(null)).toBe(undefined);
  });
});
