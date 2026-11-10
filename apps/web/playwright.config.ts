// End-to-end tests of the app, against the stub API (apps/stub-api), so they
// need no account, no cloud service and no network beyond the stub's first
// snapshot of the live hub. Both servers are started here, without portless,
// at the fixed addresses .env.stub and the stub's defaults agree on; a server
// already running at either address is reused, which is how to watch a test
// against your own dev servers.
//
// What these cover, and why they exist, is in
// apps/docs/docs/developers/web-app/end-to-end-tests.md.

import { defineConfig, devices } from "@playwright/test";

export const APP_URL = "http://localhost:5180";
export const STUB_URL = "http://localhost:8787";

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
    baseURL: APP_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
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
      },
    },
    {
      command: "pnpm exec vite --mode stub",
      url: APP_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
