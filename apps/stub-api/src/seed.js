// Turns the snapshot of published lessons into a small, lived-in hub: who wrote
// what, ratings, a few discussions, follows and notifications. Everything here
// is in memory, so restarting the stub puts it all back the way it started.

import crypto from "node:crypto";
import { PEOPLE, FOLLOWS, EXTRA_FOLLOWERS, byId } from "./people.js";

const DAY = 86_400_000;
const HOUR = 3_600_000;

// Who each known lesson is credited to, and how many days ago it was published.
// Matched by title. A lesson the live hub has gained since this was written is
// shared out between the practitioners below instead; one it has lost is simply
// missing, and anything here that refers to it is skipped.
const OWNERS = {
  "The History of Domestic Cats": ["daniel", 2],
  "Pompeii: The City Frozen in Time": ["priya", 6],
  Volcanoes: ["priya", 7],
  "Prindsessen paa Ærten": ["lars", 11],
  "An Introduction to Quantum Physics": ["priya", 15],
  "An Introduction to Theoretical Mathematics": ["priya", 21],
  "The World's Most Thrilling Theme Parks and Rides": ["priya", 26],
  Penguins: ["maya", 30],
  "Incredible Inventors": ["priya", 34],
  "The History of Programming": ["daniel", 40],
  "The History of the Web": ["daniel", 41],
  "The History of Chocolate": ["maya", 44],
  // Maya's draft: backed up to the cloud, not published.
  "The Life of Albert Einstein": ["maya", 3, false],
};
const FALLBACK_AUTHORS = ["daniel", "priya", "lars"];

/**
 * @param {Array<{ id, title, doc }>} hub  The snapshot (see snapshot.js).
 * @param {{ now?: number }} [opts]
 */
export function seed(hub, { now = Date.now() } = {}) {
  const lessons = new Map();
  let spare = 0;
  for (const h of hub) {
    let [who, daysAgo, published = true] = OWNERS[h.title] ?? [];
    if (!who) {
      who = FALLBACK_AUTHORS[spare % FALLBACK_AUTHORS.length];
      daysAgo = 48 + spare * 3;
      spare += 1;
    }
    lessons.set(h.id, {
      id: h.id,
      authorId: PEOPLE[who].id,
      title: h.title,
      doc: h.doc,
      published,
      forkedFrom: null,
      // Staggered within the day too, so the hub doesn't read as a batch import.
      createdAt: new Date(
        now - daysAgo * DAY - (daysAgo % 7) * HOUR,
      ).toISOString(),
      ratings: new Map(),
    });
  }
  const find = (title) =>
    [...lessons.values()].find((l) => l.title === title) ?? null;
  const cats = find("The History of Domestic Cats");
  const penguins = find("Penguins");
  const pompeii = find("Pompeii: The City Frozen in Time");
  const volcanoes = find("Volcanoes");

  const rate = (lesson, who, stars) =>
    lesson?.ratings.set(PEOPLE[who].id, stars);
  rate(cats, "jordan", 5);
  rate(cats, "sam", 5);
  rate(cats, "priya", 4);
  rate(pompeii, "maya", 5);
  rate(pompeii, "jordan", 5);
  rate(volcanoes, "sam", 4);
  rate(volcanoes, "daniel", 5);
  rate(penguins, "jordan", 5);

  const comments = [];
  const comment = (lesson, who, body, hoursAgo, parent = null) => {
    if (!lesson) return null;
    const c = {
      id: crypto.randomUUID(),
      lessonId: lesson.id,
      parentId: parent?.id ?? null,
      authorId: PEOPLE[who].id,
      body,
      createdAt: new Date(now - hoursAgo * HOUR).toISOString(),
      editedAt: null,
    };
    comments.push(c);
    return c;
  };
  const theo = comment(
    cats,
    "jordan",
    "<p>We did the first two sections tonight. Theo spelled that he wants to go back to the Egypt part tomorrow, and that cats chose people, not the other way round.</p>",
    40,
  );
  comment(
    cats,
    "daniel",
    "<p>He has the archaeology on his side. Tell him the wildcats moved in for the mice first.</p>",
    38,
    theo,
  );
  comment(
    cats,
    "sam",
    "<p>The VAKT break after the wildcat section worked really well in my sessions this week. Thanks for sharing this one.</p>",
    20,
  );
  comment(
    penguins,
    "jordan",
    "<p>Theo loved the emperor penguin section. We stopped twice so he could spell out his own questions about the huddle.</p>",
    5,
  );
  comment(
    pompeii,
    "maya",
    "<p>Two of my spellers asked for a part two. The section on the plaster casts started a long conversation.</p>",
    120,
  );
  comment(
    volcanoes,
    "sam",
    "<p>Great pacing. The open questions at the end of each section get real answers.</p>",
    150,
  );

  // Each notification belongs to `userId`. Maya's are about her lessons.
  const notifications = [];
  const notify = (who, fields, hoursAgo) =>
    notifications.push({
      id: crypto.randomUUID(),
      userId: PEOPLE[who].id,
      read: false,
      body: null,
      createdAt: new Date(now - hoursAgo * HOUR).toISOString(),
      ...fields,
    });
  if (penguins) {
    notify(
      "maya",
      {
        type: "comment",
        title: "Jordan Ellis commented on Penguins",
        body: "Theo loved the emperor penguin section.",
        link: `/hub/${penguins.id}/discussion`,
      },
      5,
    );
  }
  notify(
    "maya",
    {
      type: "follow",
      title: "Priya Shah followed you",
      link: `/users/${PEOPLE.priya.id}`,
      read: true,
    },
    72,
  );

  const follows = new Set(
    FOLLOWS.map(([a, b]) => `${PEOPLE[a].id}>${PEOPLE[b].id}`),
  );

  return { now, lessons, comments, notifications, follows, pulls: [], find };
}

// ---------------------------------------------------------------- views
// The response shapes, matching the real API's mappers (apps/api/src/lib/lesson.js,
// routes/comments.js and friends), so the app can't tell the difference.

export function summary(l) {
  return {
    id: l.id,
    authorId: l.authorId,
    title: l.title,
    author: byId[l.authorId].displayName,
    sectionCount: l.doc.sections.length,
    published: l.published,
    shadowbanned: false,
    forkedFrom: l.forkedFrom,
    forkedFromUrl: l.forkedFromUrl ?? null,
    createdAt: l.createdAt,
  };
}

export function ratingOf(l) {
  const stars = [...l.ratings.values()];
  if (!stars.length) return null;
  const average = stars.reduce((a, b) => a + b, 0) / stars.length;
  return { average: Math.round(average * 100) / 100, count: stars.length };
}

export function fullLesson(l) {
  const rating = ratingOf(l);
  return {
    ...summary(l),
    doc: l.doc,
    avgRating: rating?.average ?? null,
    ratingCount: rating?.count ?? 0,
  };
}

export function commentJson(c) {
  return { ...c, author: byId[c.authorId].displayName };
}

export function followerCount(state, id) {
  return (
    [...state.follows].filter((f) => f.endsWith(`>${id}`)).length +
    (EXTRA_FOLLOWERS[id] ?? 0)
  );
}

export function followingCount(state, id) {
  return [...state.follows].filter((f) => f.startsWith(`${id}>`)).length;
}

export function published(state) {
  return [...state.lessons.values()]
    .filter((l) => l.published)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
