#!/usr/bin/env node
// pnpm dev:stub                                       start the stub API on :8787
// pnpm --filter @spelling-creator/stub-api snapshot   re-read the live hub's lessons
//
// Environment: PORT, APP_ORIGIN, STUB_DATA_DIR, HUB_URL (see server.js).

import { startStub, DEFAULT_DATA_DIR } from "./server.js";
import { loadHub, DEFAULT_HUB_URL } from "./snapshot.js";
import { PEOPLE } from "./people.js";

const log = (line) =>
  console.log(`${new Date().toTimeString().slice(0, 8)} ${line}`);
const dataDir = process.env.STUB_DATA_DIR || DEFAULT_DATA_DIR;
const hubUrl = process.env.HUB_URL || DEFAULT_HUB_URL;

if (process.argv[2] === "snapshot") {
  await loadHub({ dataDir, hubUrl, refresh: true, log });
} else {
  const stub = await startStub({
    port: Number(process.env.PORT || 8787),
    appOrigin: process.env.APP_ORIGIN,
    dataDir,
    hubUrl,
    log,
  });
  log(`stub API on ${stub.url}`);
  log(`sign in as ${Object.keys(PEOPLE).join(", ")} (any password)`);
  const stop = async () => {
    await stub.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
