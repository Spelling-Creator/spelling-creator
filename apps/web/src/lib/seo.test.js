// The JSON-LD builders: pure functions from page data to schema.org objects,
// testable without rendering. What a search engine is told is part of the
// page's contract, so the shapes are pinned here: one shared Organization
// identified across pages by its @id, and the lesson markup around it.

import { describe, expect, it } from "vitest";

import {
  buildLessonSchema,
  buildLessonListSchema,
  buildWebSiteSchema,
} from "./seo.jsx";

const ORIGIN = "https://spelling.test";
const LESSON = {
  id: "7296d446-4039-4c2d-8393-9d46a1dda3d3",
  title: "Volcano words",
  author: "Ada",
  createdAt: "2026-10-18T00:00:00Z",
  sectionCount: 2,
};

describe("the shared Organization", () => {
  it("is one entity everywhere, carried in full under one @id", () => {
    const site = buildWebSiteSchema({ origin: ORIGIN });
    const lesson = buildLessonSchema({
      lesson: LESSON,
      url: `${ORIGIN}/hub/${LESSON.id}`,
      origin: ORIGIN,
    });

    expect(site.publisher).toEqual(lesson.publisher);
    expect(site.publisher["@type"]).toBe("Organization");
    expect(site.publisher["@id"]).toBe(`${ORIGIN}/#organization`);
    // Embedded in full, not referenced: an @id alone only resolves against
    // nodes on the same page, and these blocks live on different pages.
    expect(site.publisher.name).toBe("Spelling Creator");
    expect(site.publisher.logo.url).toBe(
      `${ORIGIN}/icons/apple-touch-icon.png`,
    );
    expect(site.publisher.sameAs).toContain(
      "https://github.com/Spelling-Creator/spelling-creator",
    );
  });
});

describe("buildLessonSchema", () => {
  it("describes the lesson and who made it", () => {
    const schema = buildLessonSchema({
      lesson: LESSON,
      description: "Where pet cats come from.",
      url: `${ORIGIN}/hub/${LESSON.id}`,
      origin: ORIGIN,
    });
    expect(schema["@context"]).toBe("https://schema.org");
    expect(schema.name).toBe("Volcano words");
    expect(schema.learningResourceType).toBe("Lesson");
    expect(schema.isAccessibleForFree).toBe(true);
    expect(schema.author).toMatchObject({ "@type": "Person", name: "Ada" });
    expect(schema.dateCreated).toBe("2026-10-18T00:00:00.000Z");
  });

  it("returns null without a lesson", () => {
    expect(buildLessonSchema({ origin: ORIGIN })).toBeNull();
  });
});

describe("buildLessonListSchema", () => {
  it("embeds each lesson in full, in display order", () => {
    const schema = buildLessonListSchema({
      lessons: [LESSON, { ...LESSON, id: "b", title: "Second" }],
      origin: ORIGIN,
    });
    expect(schema.itemListElement).toHaveLength(2);
    expect(schema.itemListElement[1]).toMatchObject({
      position: 2,
      item: { name: "Second", url: `${ORIGIN}/hub/b` },
    });
  });

  it("emits nothing for an empty hub", () => {
    expect(buildLessonListSchema({ lessons: [], origin: ORIGIN })).toBeNull();
  });
});
