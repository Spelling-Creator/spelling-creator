import { describe, expect, it } from "vitest";

import {
  createSource,
  isSourceId,
  lessonSources,
  normalizeSource,
  normalizeSources,
  partsText,
  sourceCitationParts,
  sourceEntryParts,
  sourceEntryText,
  sourceHasContent,
} from "./sources.js";

const full = {
  id: "s1",
  title: "Cats of Egypt",
  author: "Jane Smith",
  publisher: "Penguin",
  year: "2020",
  url: "https://example.com/cats",
};

describe("normalizing", () => {
  it("accepts uuids and readable keys as ids, and nothing else", () => {
    expect(isSourceId(crypto.randomUUID())).toBe(true);
    expect(isSourceId("smith2020")).toBe(true);
    expect(isSourceId("has space")).toBe(false);
    expect(isSourceId("")).toBe(false);
    expect(isSourceId(7)).toBe(false);
  });

  it("trims every field and drops an unsafe link", () => {
    expect(
      normalizeSource({
        id: "s",
        title: "  T ",
        url: "javascript:alert(1)",
        junk: 1,
      }),
    ).toEqual({
      id: "s",
      title: "T",
      author: "",
      publisher: "",
      year: "",
      url: "",
    });
  });

  it("drops malformed rows and repeated ids, and empty ones when asked", () => {
    const list = [
      full,
      { ...full, title: "dupe" },
      { title: "no id" },
      { id: "e" },
    ];
    expect(normalizeSources(list).map((s) => s.id)).toEqual(["s1", "e"]);
    expect(
      normalizeSources(list, { dropEmpty: true }).map((s) => s.id),
    ).toEqual(["s1"]);
    expect(lessonSources({ sources: list }).map((s) => s.id)).toEqual(["s1"]);
  });

  it("starts a new source empty", () => {
    const source = createSource(() => "new");
    expect(source.id).toBe("new");
    expect(sourceHasContent(source)).toBe(false);
  });
});

describe("printed forms", () => {
  it("writes a full Sources list entry", () => {
    expect(sourceEntryText(full)).toBe(
      "Jane Smith. Cats of Egypt. Penguin, 2020. https://example.com/cats",
    );
    const parts = sourceEntryParts(full);
    expect(parts.find((p) => p.italic)?.text).toBe("Cats of Egypt");
    expect(parts.find((p) => p.url)?.url).toBe("https://example.com/cats");
  });

  it("writes an entry from whatever is known", () => {
    expect(sourceEntryText({ title: "Only a title" })).toBe("Only a title.");
    expect(sourceEntryText({ url: "https://a.example" })).toBe(
      "https://a.example",
    );
    expect(sourceEntryText({ author: "Ann", title: "Why?" })).toBe("Ann. Why?");
  });

  it("writes the shorter footnote citation, with a locator", () => {
    expect(partsText(sourceCitationParts(full, "p. 12"))).toBe(
      "Jane Smith, Cats of Egypt (Penguin, 2020), p. 12.",
    );
    expect(partsText(sourceCitationParts({ title: "Cats" }))).toBe("Cats.");
  });

  it("cites a bare link by its address", () => {
    const parts = sourceCitationParts({ url: "https://a.example/page" });
    expect(parts).toEqual([
      { text: "https://a.example/page", url: "https://a.example/page" },
      { text: "." },
    ]);
  });

  it("never links an unsafe address", () => {
    const parts = [
      ...sourceEntryParts({ title: "T", url: "javascript:alert(1)" }),
      ...sourceCitationParts({ url: "javascript:alert(1)" }),
    ];
    expect(parts.some((p) => p.url)).toBe(false);
  });
});
