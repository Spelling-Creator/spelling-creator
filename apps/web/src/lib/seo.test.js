// The JSON-LD builders: pure functions from page data to schema.org objects,
// testable without rendering. What a search engine is told is part of the
// page's contract, so the shapes are pinned here: one shared Organization
// identified across pages by its @id, and the lesson markup around it.

import { describe, expect, it } from "vitest";

import {
  buildBreadcrumbSchema,
  buildLessonSchema,
  buildLessonListSchema,
  buildProfileSchema,
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

describe("buildProfileSchema", () => {
  const AUTHOR_ID = "00000000-0000-0000-0000-000000000001";

  it("describes the person and the counts the page shows", () => {
    const schema = buildProfileSchema({
      id: AUTHOR_ID,
      name: "Ada",
      description: "Writes lessons about volcanoes.",
      followerCount: 3,
      followingCount: 2,
      lessonCount: 5,
      origin: ORIGIN,
    });
    expect(schema["@type"]).toBe("ProfilePage");
    expect(schema.mainEntity).toMatchObject({
      "@type": "Person",
      name: "Ada",
      identifier: AUTHOR_ID,
      url: `${ORIGIN}/users/${AUTHOR_ID}`,
    });
    // Followers are interactions with the person; follows and lessons written
    // are the person's own activity.
    expect(schema.mainEntity.interactionStatistic).toEqual([
      {
        "@type": "InteractionCounter",
        interactionType: "https://schema.org/FollowAction",
        userInteractionCount: 3,
      },
    ]);
    expect(
      schema.mainEntity.agentInteractionStatistic.map(
        (s) => s.userInteractionCount,
      ),
    ).toEqual([2, 5]);
  });

  it("gives a lesson's author the same @id as the profile's mainEntity", () => {
    const profile = buildProfileSchema({
      id: AUTHOR_ID,
      name: "Ada",
      origin: ORIGIN,
    });
    const lesson = buildLessonSchema({
      lesson: { ...LESSON, authorId: AUTHOR_ID },
      url: `${ORIGIN}/hub/${LESSON.id}`,
      origin: ORIGIN,
    });
    expect(profile.mainEntity["@id"]).toBe(
      `${ORIGIN}/users/${AUTHOR_ID}#person`,
    );
    expect(lesson.author["@id"]).toBe(profile.mainEntity["@id"]);
  });

  it("leaves the author un-identified without a user id", () => {
    const lesson = buildLessonSchema({
      lesson: LESSON,
      url: `${ORIGIN}/hub/${LESSON.id}`,
      origin: ORIGIN,
    });
    expect(lesson.author).toEqual({ "@type": "Person", name: "Ada" });
  });

  it("still links a nameless author to their profile", () => {
    const lesson = buildLessonSchema({
      lesson: { ...LESSON, author: "", authorId: AUTHOR_ID },
      url: `${ORIGIN}/hub/${LESSON.id}`,
      origin: ORIGIN,
    });
    expect(lesson.author.name).toBe("Anonymous");
    expect(lesson.author["@id"]).toBe(`${ORIGIN}/users/${AUTHOR_ID}#person`);
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
    // Article (a written piece whose comments belong to it) and
    // LearningResource (what the piece is), as one entity.
    expect(schema["@type"]).toEqual(["Article", "LearningResource"]);
    expect(schema.name).toBe("Volcano words");
    expect(schema.headline).toBe("Volcano words");
    expect(schema.learningResourceType).toBe("Lesson");
    expect(schema.isAccessibleForFree).toBe(true);
    expect(schema.author).toMatchObject({ "@type": "Person", name: "Ada" });
    expect(schema.dateCreated).toBe("2026-10-18T00:00:00.000Z");
    expect(schema.datePublished).toBe(schema.dateCreated);
    // Without a loaded comment list the markup says nothing about comments,
    // rather than claiming zero.
    expect(schema.commentCount).toBeUndefined();
  });

  it("nests the comment thread the way the discussion tab draws it", () => {
    const schema = buildLessonSchema({
      lesson: LESSON,
      url: `${ORIGIN}/hub/${LESSON.id}`,
      origin: ORIGIN,
      comments: [
        {
          id: "c1",
          parentId: null,
          authorId: "00000000-0000-0000-0000-000000000002",
          author: "Grace",
          body: "<p>Lovely <strong>lesson</strong>!</p>",
          createdAt: "2026-10-19T10:00:00Z",
        },
        {
          id: "c2",
          parentId: "c1",
          authorId: null,
          author: "",
          body: "<p>Thanks!</p>",
          createdAt: "2026-10-19T11:00:00Z",
        },
      ],
    });

    // Both comments count; only the top-level one starts a thread.
    expect(schema.commentCount).toBe(2);
    expect(schema.comment).toHaveLength(1);
    const [comment] = schema.comment;
    // Plain text, not the stored HTML.
    expect(comment.text).toBe("Lovely lesson !");
    expect(comment.dateCreated).toBe("2026-10-19T10:00:00.000Z");
    // The author points at their profile, like a lesson's author does.
    expect(comment.author["@id"]).toBe(
      `${ORIGIN}/users/00000000-0000-0000-0000-000000000002#person`,
    );
    expect(comment.comment).toHaveLength(1);
    expect(comment.comment[0].author).toEqual({
      "@type": "Person",
      name: "Anonymous",
    });
  });

  it("claims zero comments only when the list really is empty", () => {
    const schema = buildLessonSchema({
      lesson: LESSON,
      url: `${ORIGIN}/hub/${LESSON.id}`,
      origin: ORIGIN,
      comments: [],
    });
    expect(schema.commentCount).toBe(0);
    expect(schema.comment).toBeUndefined();
  });

  it("returns null without a lesson", () => {
    expect(buildLessonSchema({ origin: ORIGIN })).toBeNull();
  });

  it("carries each hub picture with the credit the page shows", () => {
    const hash = "a".repeat(64);
    const schema = buildLessonSchema({
      lesson: {
        ...LESSON,
        doc: {
          sections: [
            {
              blocks: [
                {
                  type: "image",
                  image: { hash },
                  caption: "A wildcat",
                  credit: "Image (by Ada, CC BY 4.0) via Wikimedia Commons",
                },
                // Legacy block: the credit still lives inside the caption and
                // must come out split, exactly as the page displays it.
                {
                  type: "image",
                  image: { hash: "b".repeat(64) },
                  caption: "Lions (Image from Pixabay)",
                },
                // A local image that never reached the hub has no public URL.
                { type: "image", caption: "Local only" },
                { type: "text", text: "Not a picture." },
              ],
            },
          ],
        },
      },
      url: `${ORIGIN}/hub/${LESSON.id}`,
      origin: ORIGIN,
    });

    expect(schema.image).toHaveLength(2);
    expect(schema.image[0]).toEqual({
      "@type": "ImageObject",
      contentUrl: `${ORIGIN}/images/${hash}`,
      caption: "A wildcat",
      creditText: "Image (by Ada, CC BY 4.0) via Wikimedia Commons",
    });
    expect(schema.image[1].caption).toBe("Lions");
    expect(schema.image[1].creditText).toBe("Image from Pixabay");
  });

  it("emits no image list for a lesson without hub pictures", () => {
    const schema = buildLessonSchema({
      lesson: { ...LESSON, doc: { sections: [{ blocks: [] }] } },
      url: `${ORIGIN}/hub/${LESSON.id}`,
      origin: ORIGIN,
    });
    expect(schema.image).toBeUndefined();
  });
});

describe("buildBreadcrumbSchema", () => {
  it("matches the visible trail, leaving the page itself without an item URL", () => {
    const schema = buildBreadcrumbSchema({
      crumbs: [{ name: "Lesson hub", path: "/hub" }, { name: "Volcano words" }],
      origin: ORIGIN,
    });
    expect(schema["@type"]).toBe("BreadcrumbList");
    expect(schema.itemListElement).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        name: "Lesson hub",
        item: `${ORIGIN}/hub`,
      },
      { "@type": "ListItem", position: 2, name: "Volcano words" },
    ]);
  });

  it("emits nothing without crumbs", () => {
    expect(buildBreadcrumbSchema({ crumbs: [], origin: ORIGIN })).toBeNull();
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
    // The list stays plain LearningResource: the Article half belongs to the
    // lesson's own page, where the comments it claims actually are.
    expect(schema.itemListElement[0].item["@type"]).toBe("LearningResource");
  });

  it("emits nothing for an empty hub", () => {
    expect(buildLessonListSchema({ lessons: [], origin: ORIGIN })).toBeNull();
  });
});
