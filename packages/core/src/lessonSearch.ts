// Fully client-side lesson search, powered by Fuse.js. The hub loads every
// published lesson summary up front (GET /lessons), so there's no need to hit a
// backend for search — we build a small in-memory Fuse index over those
// summaries and rank them in the browser. This replaces the old Algolia
// integration with zero network calls and no API keys.
//
// Lesson summaries only carry `title` and `author` (not the full document), so
// those are the searchable fields. Title is weighted higher so a name match
// outranks an author match.

import Fuse, { type IFuseOptions } from "fuse.js";

/** The fields of a hub lesson summary that search reads. */
export interface LessonSummary {
  id: string;
  title?: string;
  author?: string;
}

/** What the index holds: the searchable text, and the summary it came from. */
export interface LessonIndexEntry<T extends LessonSummary = LessonSummary> {
  title: string;
  author: string;
  lesson: T;
}

/** An index buildLessonIndex built, for searchLessons to run queries on. */
export type LessonIndex<T extends LessonSummary = LessonSummary> = Fuse<
  LessonIndexEntry<T>
>;

// Fuse is fuzzy by default, which covers both as-you-type prefix matches
// ("spel" -> "spelling") and small typos in one pass. `ignoreLocation` lets a
// match land anywhere in the field (not just near the start), and the threshold
// is kept fairly tight so results stay relevant rather than matching almost
// everything.
const FUSE_OPTIONS: IFuseOptions<LessonIndexEntry> = {
  useTokenSearch: true,
  includeScore: false,
  ignoreLocation: true,
  threshold: 0.4,
  minMatchCharLength: 2,
  keys: [
    { name: "title", weight: 2 },
    { name: "author", weight: 1 },
  ],
};

/**
 * Build a Fuse index over the given lesson summaries. Cheap enough to rebuild
 * whenever the lesson list changes (the hub has at most a few hundred lessons).
 */
export function buildLessonIndex<T extends LessonSummary>(
  lessons: readonly T[],
): LessonIndex<T> {
  // Index entries mirror the UI's fallbacks so a search for "untitled" or
  // "anonymous" finds the cards that display those placeholders. The original
  // summary is carried along so callers get it back unchanged.
  const entries = lessons.map((lesson): LessonIndexEntry<T> => ({
    title: lesson.title || "Untitled Lesson",
    author: lesson.author || "Anonymous",
    lesson,
  }));

  return new Fuse(entries, FUSE_OPTIONS);
}

/**
 * Run a query against a built index and return the matching lesson summaries in
 * relevance order (best first). An empty/whitespace query returns null, letting
 * the caller fall back to its default (newest-first) listing.
 */
export function searchLessons<T extends LessonSummary>(
  index: LessonIndex<T> | null | undefined,
  query: string | null | undefined,
): T[] | null {
  if (!index) return null;
  const trimmed = (query || "").trim();
  if (!trimmed) return null;

  return index.search(trimmed).map((result) => result.item.lesson);
}
