#!/usr/bin/env node
// pnpm dev:stub                                       start the stub API on https://api.stub.spelling-creator.localhost
// pnpm --filter @spelling-creator/stub-api snapshot   re-read the live hub's lessons
//
// Environment: PORT, APP_ORIGIN, PEER_ORIGIN, STUB_DATA_DIR, HUB_URL, STUB_AI,
// STUB_AI_MODEL (see server.js), and PIXABAY_API_KEY for Pixabay image search
// (see ai.js). `pnpm dev:stub` runs this through portless, which sets PORT and
// PORTLESS_URL; without PORTLESS_URL it falls back to port 8787.

import { execFileSync } from "node:child_process";
import { startStub, DEFAULT_DATA_DIR } from "./server.js";
import { loadHub, DEFAULT_HUB_URL } from "./snapshot.js";
import { PEOPLE } from "./people.js";

const log = (line) =>
  console.log(`${new Date().toTimeString().slice(0, 8)} ${line}`);
const dataDir = process.env.STUB_DATA_DIR || DEFAULT_DATA_DIR;
const hubUrl = process.env.HUB_URL || DEFAULT_HUB_URL;

// Under portless, `pnpm dev:web:stub` is at a named URL too, and `portless get`
// works it out the same way `portless run` named it, worktree prefix included.
const portlessUrl = (name) =>
  process.env.PORTLESS_URL
    ? execFileSync("portless", ["get", name], { encoding: "utf8" }).trim()
    : undefined;

if (process.argv[2] === "snapshot") {
  await loadHub({ dataDir, hubUrl, refresh: true, log });
} else {
  const stub = await startStub({
    port: Number(process.env.PORT || 8787),
    appOrigin: process.env.APP_ORIGIN || portlessUrl("stub.spelling-creator"),
    peerOrigin:
      process.env.PEER_ORIGIN || portlessUrl("peer.stub.spelling-creator"),
    dataDir,
    hubUrl,
    ai: process.env.STUB_AI || "",
    aiModel: process.env.STUB_AI_MODEL || undefined,
    log,
  });
  log(`stub API on ${process.env.PORTLESS_URL || stub.url}`);
  log(
    process.env.STUB_AI === "claude"
      ? "AI: saved answers, then claude -p"
      : "AI: saved answers only (STUB_AI=claude to ask Claude)",
  );
  log(`sign in as ${Object.keys(PEOPLE).join(", ")} (any password)`);
  const stop = async () => {
    await stub.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
