// Tests run inside the real Workers runtime (workerd) rather than Node, because
// some of the code under test only exists there.
//
// That used to include the rich-text sanitizer, which was built on HTMLRewriter; it
// parses with parse5 now and would run anywhere. What still pins this to workerd is
// the platform adapters — src/platform/cloudflare.test.js runs the conformance suite
// against real R2 and KV, and a Node-shaped fake of those would only assert our own
// assumptions back at us.
//
// The same goes double for CollabRoom: it's a Durable Object holding the live session's
// Yjs document in SQLite and handing it to late joiners, so the only test worth having
// runs it as a real Durable Object. PracticeRoom, the letterboard relay, is tested the
// same way. `main` points at a test-only entry exporting just those classes (see
// src/collab-room.test-worker.js), because the production entry would drag in
// Puppeteer and the whole route table for no benefit.

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/collab-room.test-worker.js",
      miniflare: {
        compatibilityDate: "2026-05-28",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: {
          COLLAB_ROOM: { className: "CollabRoom", useSQLite: true },
          PRACTICE_ROOM: { className: "PracticeRoom", useSQLite: true },
        },
        // A bucket and a namespace for the platform-adapter conformance suite
        // (src/platform/cloudflare.test.js) to run against. Deliberately not
        // named after the production bindings: these exist to exercise the
        // adapters, and reusing IMAGES/RATE_LIMIT_KV here would invite a test
        // to reach for a binding instead of the seam in front of it.
        r2Buckets: ["TEST_BLOBS"],
        kvNamespaces: ["TEST_KV"],
      },
    }),
  ],
  test: {
    name: "workers",
    // Image conversion runs in the Node project only, which is a limitation of
    // this runner rather than a gap in the code. Its codecs arrive as `.wasm`
    // imports from a dependency, and @cloudflare/vitest-plugin cannot resolve
    // one out of node_modules, because it uses Vite's module graph rather than
    // wrangler's bundler.
    //
    // So a pass here would not have said much about production either way: what
    // actually has to resolve those imports is `wrangler deploy`, and CI checks
    // that directly by bundling the Worker (`pnpm --filter @spelling-creator/api
    // bundle`). The half of the loader that only Node runs is covered by the
    // Node project, which is the half that had no coverage at all before.
    //
    // Spread the defaults rather than replacing them: `exclude` is not additive,
    // and vitest's default list is what keeps node_modules out. Dropping it
    // hands the runner every test file in every installed dependency.
    include: ["src/**/*.test.js"],
    exclude: [
      ...configDefaults.exclude,
      "src/imageConvert.test.js",
      // The Node entry point and its filesystem-backed asset server. There is
      // nothing here for workerd to run — this host is the other one.
      "src/node/**",
      // Fedify's OpenTelemetry dependency imports `node:process` on load, which
      // this runner cannot resolve even with nodejs_compat (the real bundle
      // can, which `pnpm --filter @spelling-creator/api bundle` checks). The
      // federation is exercised under Node; the routes that call into it load
      // it lazily, which is what keeps their own suites runnable here.
      "src/lib/federation/**",
    ],
  },
});
