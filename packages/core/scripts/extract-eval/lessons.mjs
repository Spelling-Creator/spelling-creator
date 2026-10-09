// The test set: the newest published hub lessons, fetched from the public API
// and cached on disk so a re-run is offline and deterministic.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_API = "https://spellingcreator.org";

// Hub lessons kept out of every dataset built from the hub, the archived and
// published ones included, because their author has not been asked whether
// their text may be republished (the datasets are CC BY 4.0). By id, with the
// title for the reader.
export const NOT_ARCHIVED = [
  "75759000-d43e-40a2-9583-633c17e0a632", // Prindsessen paa Ærten
];

async function cached(file, fetchIt) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    const value = await fetchIt();
    await writeFile(file, JSON.stringify(value, null, 2));
    return value;
  }
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url}: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * The newest `count` published lessons with exactly `sectionCount` sections.
 * @returns {Promise<Array<{id: string, title: string, author: string, doc: object}>>}
 */
export async function fetchLessons({
  count = 4,
  api = DEFAULT_API,
  cacheDir,
  sectionCount = 6,
  skip = [],
}) {
  await mkdir(cacheDir, { recursive: true });
  const list = await cached(
    path.join(cacheDir, "list.json"),
    async () => (await getJson(`${api}/lessons`)).lessons,
  );
  const picked = list
    .filter((l) => l.sectionCount === sectionCount && !skip.includes(l.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, count);
  const lessons = [];
  for (const summary of picked) {
    lessons.push(
      await cached(
        path.join(cacheDir, `${summary.id}.json`),
        async () => (await getJson(`${api}/lessons/${summary.id}`)).lesson,
      ),
    );
  }
  return lessons;
}
