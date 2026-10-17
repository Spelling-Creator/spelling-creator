// A stand-in for the Worker API (apps/api) that runs on a laptop with no
// Supabase, no Cloudflare and no network beyond one read of the public hub. See
// apps/docs/docs/developers/stub-api.md for what it covers and how to use it.

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadHub, DEFAULT_HUB_URL } from "./snapshot.js";
import { seed } from "./seed.js";
import { buildGit } from "./git.js";
import { createHandler } from "./routes.js";
import { createCollab } from "./collab.js";
import { createPractice } from "./practice.js";
import { createAi } from "./ai.js";

export const DEFAULT_DATA_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".cache",
);

/**
 * Start the stub. Resolves once it is listening.
 *
 * @param {object} [opts]
 * @param {number} [opts.port]        0 picks a free port. Default 8787, the port `wrangler dev` uses.
 * @param {string} [opts.appOrigin]   Where the web app runs, for links in feeds and /split.
 *                                    Default http://localhost:5180, where `pnpm dev:web:stub` serves it.
 * @param {string} [opts.dataDir]     The hub snapshot and image cache. Default apps/stub-api/.cache.
 * @param {string} [opts.hubUrl]      Where to snapshot published lessons from. Default the live hub.
 * @param {number} [opts.now]         "Now", for the seeded dates. Default the real time.
 * @param {"claude" | ""} [opts.ai]   "claude" answers AI requests with `claude -p` when no saved
 *                                    answer matches. Default "": saved answers only (see ai.js).
 * @param {string} [opts.aiModel]     The Claude model for those answers. Default "sonnet".
 * @param {number} [opts.aiReplayDelayMs] How long a saved answer takes to arrive. Default 1200.
 * @param {Function} [opts.log]       Called with one line per notable event.
 * @returns {Promise<{ url: string, port: number, state: object, close: () => Promise<void> }>}
 */
export async function startStub({
  port = 8787,
  appOrigin = "http://localhost:5180",
  dataDir = DEFAULT_DATA_DIR,
  hubUrl = DEFAULT_HUB_URL,
  now = Date.now(),
  ai = "",
  aiModel = "sonnet",
  aiReplayDelayMs = 1200,
  log = () => {},
} = {}) {
  const hub = await loadHub({ dataDir, hubUrl, log });
  const state = seed(hub, { now });
  Object.assign(state, await buildGit(state));
  log(
    `${state.lessons.size} lessons, ${state.pulls.length} open proposal${state.pulls.length === 1 ? "" : "s"}`,
  );

  let url = "";
  const aiRoutes = createAi({
    selfUrl: () => url,
    dataDir,
    ai,
    model: aiModel,
    replayDelayMs: aiReplayDelayMs,
    log,
  });
  const server = http.createServer(
    createHandler(state, { appOrigin, dataDir, hubUrl, ai: aiRoutes, log }),
  );
  // The two WebSocket rooms, each claiming its own path prefix; anything else
  // asking to upgrade is dropped.
  const sockets = [createCollab({ log }), createPractice({ log })];
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://stub");
    const room = sockets.find((s) => url.pathname.startsWith(s.path));
    if (!room) return socket.destroy();
    room.upgrade(req, socket, head, url);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, resolve);
  });
  const actual = server.address().port;
  url = `http://localhost:${actual}`;
  return {
    url,
    port: actual,
    state,
    async close() {
      for (const room of sockets) room.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
