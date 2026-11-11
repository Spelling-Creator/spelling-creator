// Put this app's client build where the hosts serve static files from.
//
// Both hosts serve one directory of files: the Worker's ASSETS binding and
// the Node server's WEB_DIST both point at apps/web/dist, the old app's
// build. While the two apps share the site, this app's hashed scripts,
// styles and fonts are copied in beside the old app's, the way the docs are
// copied into dist/docs (apps/docs's copy-to-web). The names cannot collide:
// every file under assets/ carries a content hash in its name, and the files
// from public/ are the same files the old app ships.
//
// Run after the old app's build, which empties dist first; turbo.json orders
// the two. Never cached, for the reason the docs copy is not: a cache hit on
// the old build restores dist without these files in it.

import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const client = path.resolve(here, "../build/client");
const dist = path.resolve(here, "../../web/dist");

if (!existsSync(client)) {
  console.error(`copy-to-web: ${client} does not exist; run the build first.`);
  process.exit(1);
}
if (!existsSync(dist)) {
  console.error(
    `copy-to-web: ${dist} does not exist; build @spelling-creator/web first.`,
  );
  process.exit(1);
}

// The old app's index.html is the shell the old routes are served as. This
// app has no index.html of its own (every document is rendered on request),
// so there is nothing of that name to copy over it, but the check keeps that
// true rather than assuming it.
const shell = path.join(client, "index.html");
if (existsSync(shell)) {
  console.error(
    "copy-to-web: build/client has an index.html, which would replace the old app's shell. Is a route prerendered?",
  );
  process.exit(1);
}

// The server build is not for the assets directory: the Worker imports it.
rmSync(path.join(dist, ".vite"), { recursive: true, force: true });
cpSync(client, dist, { recursive: true });
console.log(`copy-to-web: copied ${path.relative(process.cwd(), client)}`);
