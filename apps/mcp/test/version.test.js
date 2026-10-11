// The server's version lives in package.json, and SERVER_INFO reads it from
// there. manifest.json can't import anything (the .mcpb format wants a literal),
// so it keeps its own copy, and this is what stops the two drifting apart.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SERVER_INFO } from "../src/tools.js";

const readJson = (path) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

test("package.json, manifest.json and SERVER_INFO agree on the version", () => {
  const pkg = readJson("../package.json");
  const manifest = readJson("../manifest.json");
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, pkg.version, "bump manifest.json too");
  assert.equal(SERVER_INFO.version, pkg.version);
});
