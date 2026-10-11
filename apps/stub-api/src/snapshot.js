// The lessons the stub serves are real published lessons, read from the live
// hub's public API once and kept in a local cache. They are other people's
// work, so they are never committed: the cache directory is gitignored, and a
// fresh checkout fetches its own copy the first time the stub starts.

import fs from "node:fs";
import path from "node:path";

export const DEFAULT_HUB_URL = "https://spellingcreator.org";

const FILE = "hub.json";

/**
 * The published lessons, each with its document: from the cache in `dataDir`,
 * or fetched from `hubUrl` (and cached) when there is none or `refresh` is set.
 *
 * @returns {Promise<Array<{ id, title, createdAt, doc }>>}
 */
export async function loadHub({
  dataDir,
  hubUrl = DEFAULT_HUB_URL,
  refresh = false,
  log = () => {},
}) {
  const file = path.join(dataDir, FILE);
  if (!refresh && fs.existsSync(file))
    return JSON.parse(fs.readFileSync(file, "utf8")).lessons;

  log(`fetching published lessons from ${hubUrl}`);
  const list = await getJson(`${hubUrl}/lessons`);
  const lessons = [];
  for (const summary of list.lessons) {
    const { lesson } = await getJson(`${hubUrl}/lessons/${summary.id}`);
    lessons.push({
      id: lesson.id,
      title: lesson.title,
      createdAt: lesson.createdAt,
      doc: lesson.doc,
    });
  }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ hubUrl, fetchedAt: new Date().toISOString(), lessons }),
  );
  log(`cached ${lessons.length} lessons in ${file}`);
  return lessons;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
  return res.json();
}

/**
 * A lesson image, from the cache or fetched once from the live hub. The stub
 * serves the same bytes the real hub does, so a lesson's pictures appear.
 *
 * @returns {Promise<{ type: string, bytes: Buffer } | null>}
 */
export async function loadImage({ dataDir, hubUrl = DEFAULT_HUB_URL, hash }) {
  const dir = path.join(dataDir, "images");
  const file = path.join(dir, hash);
  if (!fs.existsSync(file)) {
    const res = await fetch(`${hubUrl}/images/${hash}`);
    if (!res.ok) return null;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    fs.writeFileSync(
      `${file}.type`,
      res.headers.get("content-type") || "image/jpeg",
    );
  }
  return {
    type: fs.readFileSync(`${file}.type`, "utf8"),
    bytes: fs.readFileSync(file),
  };
}
