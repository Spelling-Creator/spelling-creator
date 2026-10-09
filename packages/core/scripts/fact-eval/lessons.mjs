// Every published hub lesson but those NOT_ARCHIVED, newest first, through
// the extraction experiment's fetcher and its cache
// (extract-eval/.cache/lessons), so the two experiments read the same lessons.

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_API,
  NOT_ARCHIVED,
  fetchLessons,
} from "../extract-eval/lessons.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const LESSON_CACHE = path.join(here, "..", "extract-eval", ".cache", "lessons");

/** @returns {Promise<Array<{id: string, createdAt: string, doc: object}>>} */
export async function allLessons(api = DEFAULT_API) {
  const list = JSON.parse(
    await readFile(path.join(LESSON_CACHE, "list.json"), "utf8").catch(
      async () =>
        JSON.stringify((await (await fetch(`${api}/lessons`)).json()).lessons),
    ),
  );
  const lessons = [];
  for (const sectionCount of new Set(list.map((l) => l.sectionCount))) {
    lessons.push(
      ...(await fetchLessons({
        count: Infinity,
        api,
        cacheDir: LESSON_CACHE,
        sectionCount,
        skip: NOT_ARCHIVED,
      })),
    );
  }
  return lessons.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
