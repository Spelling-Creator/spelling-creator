// Deletes every entry in .turbo/cache that the latest turbo run did not use.
//
// CI restores the cache, runs, and saves it again under a new key. Turborepo
// never evicts anything from its local cache, so without this each saved cache
// would hold every build since the first one, and grow on every commit. Keeping
// only what the run just hit or wrote leaves exactly what the next run can use.
//
// Needs the run to have been made with --summarize, which writes the task
// hashes to .turbo/runs/<id>.json. Cache files are named after those hashes:
// <hash>.tar.zst, <hash>-meta.json and <hash>-manifest.json.

import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const runsDir = ".turbo/runs";
const cacheDir = ".turbo/cache";

const latestRun = readdirSync(runsDir)
  .filter((name) => name.endsWith(".json"))
  .map((name) => join(runsDir, name))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];

if (!latestRun) {
  console.error(`No run summary in ${runsDir}; run turbo with --summarize.`);
  process.exit(1);
}

const keep = new Set(
  JSON.parse(readFileSync(latestRun, "utf8")).tasks.map((task) => task.hash),
);

let removed = 0;
for (const name of readdirSync(cacheDir)) {
  if (!keep.has(name.split(/[.-]/)[0])) {
    rmSync(join(cacheDir, name), { recursive: true, force: true });
    removed++;
  }
}

console.log(`Kept ${keep.size} cached tasks, removed ${removed} stale files.`);
