// End-to-end tests of the app, against the stub API (apps/stub-api), so they
// need no account, no cloud service and no network beyond the stub's first
// snapshot of the live hub. The servers are started here, without portless,
// at the fixed addresses the two apps' .env.stub files and the stub's
// defaults agree on; a server already running at any of the addresses is
// reused, which is how to watch a test against your own dev servers.
//
// Two projects, one per app, while the rewrite is under way (see
// apps/docs/docs/developers/web-app/rewrite.md): `web` runs every spec
// against the old app, and `web-next` runs the specs for the routes that have
// moved against the new one. A spec whose name ends in `.next.spec.ts` is the
// new app's alone: it checks something only it does (the hand-over of a path
// it doesn't serve). When the last route moves, the old project goes.
//
// What these cover, and why they exist, is in
// apps/docs/docs/developers/web-app/end-to-end-tests.md.

import { defineConfig, devices } from "@playwright/test";

export const APP_URL = "http://localhost:5180";
export const NEXT_URL = "http://127.0.0.1:5181";
export const STUB_URL = "http://localhost:8787";

// The specs the new app runs: the routes it serves so far. The hub spec's
// second test opens a lesson, which is still the old app's, so it waits.
const NEXT_SPECS = /(hub|profile)\.spec\.ts$|\.next\.spec\.ts$/;

export default defineConfig({
  testDir: "./e2e",
  // Every test is its own browser context with its own storage, but the stub
  // keeps what a test publishes or comments until it restarts, so tests that
  // write give their writing a name of their own rather than assuming a
  // clean hub.
  fullyParallel: true,
  // A test walks several pages, waits out the editor's four-second commit
  // pause, and on a cold dev server pays for the first compile of the whole
  // app; Playwright's 30s default is not enough for that.
  timeout: 90_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "web",
      use: { ...devices["Desktop Chrome"], baseURL: APP_URL },
      testIgnore: /\.next\.spec\.ts$/,
    },
    {
      name: "web-next",
      use: { ...devices["Desktop Chrome"], baseURL: NEXT_URL },
      testMatch: NEXT_SPECS,
      grepInvert: /opens a lesson from the hub/,
    },
  ],
  webServer: [
    {
      command: "node ../stub-api/src/cli.js",
      url: `${STUB_URL}/practice`,
      reuseExistingServer: !process.env.CI,
      // The first start snapshots the live hub's lessons into
      // apps/stub-api/.cache, which takes a while.
      timeout: 180_000,
      env: {
        PORT: "8787",
        APP_ORIGIN: APP_URL,
        PEER_ORIGIN: "http://127.0.0.1:5180",
        // The new app's dev server calls the stub from the browser too.
        EXTRA_ORIGINS: NEXT_URL,
      },
    },
    {
      command: "pnpm exec vite --mode stub",
      url: APP_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command:
        "pnpm --filter @spelling-creator/web-next exec react-router dev --mode stub",
      url: `${NEXT_URL}/hub`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
