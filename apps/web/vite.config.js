import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import {
  STUB,
  addAlias,
  aliasName,
  portlessUrl,
  removeAliasSync,
  underPortless,
} from "../../scripts/portless.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Paths the Cloudflare Worker answers itself, so the service worker must never
// resolve a navigation to them from the precached SPA shell. `run_worker_first`
// means the Worker sees every request before the static assets do (see
// apps/api/wrangler.jsonc), and these are the paths it doesn't hand back to
// env.ASSETS — /docs is the statically-built VitePress site copied into dist/docs
// after this build, the rest are Worker routes (apps/api/src/index.js). Anything
// not listed here is assumed to be a client-side route in src/App.jsx.
//
// A denylist rather than an allowlist: adding a page to App.jsx shouldn't
// require a matching edit here, and the failure mode is the gentler one — an
// unlisted SPA route falls through to the network, which online still lands on
// index.html via the Worker's frontend fall-through
// (apps/api/src/routes/spa.js). Note that *that* file does need the matching
// edit: a route it doesn't know is still served the shell and still renders,
// but with a 404 status.
const WORKER_PATHS = [
  // The server-rendered routes (apps/api/src/routes/ssr.js). These have to be
  // here or the service worker answers the navigation from its precached shell
  // and the Worker is never asked — which silently turns SSR off for every
  // returning visitor, the exact people whose browsers have the shell cached.
  // Nothing is lost offline: all three need the network for their data anyway.
  //
  // Note how broad this first one is: it denies the *whole* of /hub/*, which
  // now includes a lesson's tabs (/hub/:id/history, /hub/:id/proposals/:prId,
  // …). That is only safe because ssr.js's LESSON_PATH matches them too. A path
  // denied here and unmatched there is denied the precached shell and gets no
  // server render either — which online falls through to the SPA shell and
  // works, and offline simply fails. Keep the two in step.
  /^\/hub(\/|$)/,
  /^\/users\//,
  /^\/docs(\/|$)/,
  /^\/images\//,
  /^\/git\//,
  /^\/collab(\/|$)/,
  /^\/og-image(\/|\?|$)/,
  /^\/authorize(\/|\?|$)/,
  /^\/token(\/|$)/,
  /^\/register(\/|$)/,
  /^\/mcp(\/|$)/,
  /^\/\.well-known\//,
  /^\/(sitemap\.xml|robots\.txt|feed\.xml|spelling-words\.json)$/,
];

// Modules that exist only behind a click or a route the Worker never renders.
// They are all reached through a dynamic import(), so the server build pulls
// them in as emitted chunks it can never execute — the export pipeline alone is
// 3.6 MB of docx/mammoth/html2pdf, and the editor another 550 kB, all of it
// uploaded to the edge to sit unused. Replacing them with a stub in the SSR
// build keeps the Worker to what it can actually run.
//
// Safe only because nothing static-imports them: src/lib/exports/load.js and
// the lazy routes in src/App.jsx both use import(), so there are no named
// bindings for the stub to fail to provide.
const SSR_UNREACHABLE = [
  "src/lib/exports/engine.js",
  // isomorphic-git + LightningFS, ~474 kB. It used to be unreachable from the
  // server graph for free, because only the editor asked for it and the editor
  // is stubbed below. The lesson page's History tab now asks for it too — also
  // through a dynamic import, and also only in a browser (it indexes a packfile
  // into IndexedDB), so it still cannot run here. Without this line the Worker
  // carries the whole git implementation to the edge to sit unused.
  "src/lib/git/engine.js",
  "src/pages/EditorPage.jsx",
  "src/pages/ModerationPage.jsx",
  "src/pages/LoginPage.jsx",
  "src/pages/OAuthAuthorizePage.jsx",
  // transformers.js + the translation fallback (Opus-MT / NLLB). Reached only
  // through the dynamic import() in core/browser/translator.ts, from a click
  // on Translate, and it downloads models of ~110 MB to ~600 MB into browser
  // storage. Nothing about it can run in the Worker, and bundling it would be
  // the export pipeline story again, several times over.
  "../../packages/core/src/browser/fallbackTranslator.ts",
  // The summarisation fallback (LFM2.5 via transformers.js), same story:
  // reached only through the dynamic import() in core/browser/summarizer.ts,
  // from a click on Summarise, and its model download is ~760 MB on WebGPU.
  "../../packages/core/src/browser/fallbackSummarizer.ts",
  // The on-device model behind Import from text (LFM2 Extract, fine-tuned),
  // same story: reached only through the dynamic import() in
  // core/browser/documentModel.ts, from a click in the import dialog, and its
  // model download is ~640 MB on WebGPU.
  "../../packages/core/src/browser/documentModelEngine.ts",
  // Kokoro read-aloud (transformers.js plus Spellophone's espeak-ng wasm),
  // same story: reached only through the dynamic import() in
  // core/browser/readAloud.ts, and its model download is 92 MB or more.
  "../../packages/core/src/browser/readAloudEngine.ts",
  // Formulas (MathJax, its font and the speech rule engine), same story:
  // reached only through the dynamic import() in core/browser/formulas.ts,
  // and the server shows a formula as its source.
  "../../packages/core/src/browser/formulaBrowser.ts",
  "../../packages/core/src/browser/formulaEngine.ts",
  "../../packages/core/src/browser/formulaSpeech.ts",
  // The ALTCHA widget (a custom element with its solver workers inlined),
  // reached only through the dynamic import() in src/lib/aiChallenge.jsx, from
  // an open AI dialog on an instance that uses ALTCHA.
  "src/lib/altchaWidget.js",
];

function stubUnreachableOnServer() {
  const targets = new Set(
    SSR_UNREACHABLE.map((p) => path.resolve(__dirname, p)),
  );
  const STUB_ID = "\0ssr-unreachable";
  return {
    name: "stub-unreachable-on-server",
    // Ahead of vite:resolve — a normal-phase plugin never gets asked, because
    // the built-in resolver has already returned an id by then.
    enforce: "pre",
    async resolveId(source, importer, options) {
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      return resolved && targets.has(resolved.id) ? STUB_ID : null;
    },
    load(id) {
      if (id !== STUB_ID) return null;
      // Reaching this means the route table and this list disagree.
      return `export default function SsrUnreachable() {
  throw new Error("This module was stubbed out of the server build (vite.config.js).");
}\n`;
    },
  };
}

// onnxruntime-web (inside the lazy translation fallback chunk) references its .wasm
// binaries with `new URL(..., import.meta.url)`, which the bundler dutifully
// resolves and emits into dist/assets: 25.6 MB that Cloudflare Workers refuses
// to deploy (its per-asset cap is 25 MiB). The copies are also never fetched:
// transformers.js points the runtime at the version-pinned jsdelivr copy of the
// exact same files whenever `env.backends.onnx.wasm.wasmPaths` is unset (see
// its src/backends/onnx.js), so the wasm arrives from the CDN alongside the
// models, which come from huggingface.co anyway. This drops the dead files from
// the bundle rather than shipping what nothing requests.
function dropOnnxWasmAssets() {
  return {
    name: "drop-onnx-wasm-assets",
    generateBundle(_options, bundle) {
      for (const [name, entry] of Object.entries(bundle)) {
        if (entry.type === "asset" && /ort-.*\.(wasm|mjs)$/.test(name)) {
          delete bundle[name];
        }
      }
    },
  };
}

const TURNSTILE_SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

// Load Turnstile from somewhere other than Cloudflare when
// VITE_TURNSTILE_SCRIPT_URL is set. Only `pnpm dev:web:stub` sets it (in
// .env.stub, or portlessStub below), to load the stub API's stand-in widget, so
// the AI features work locally with no Cloudflare account. Unset, index.html is
// left as it is.
function turnstileScriptOverride() {
  let url;
  return {
    name: "turnstile-script-override",
    configResolved(config) {
      url = config.env.VITE_TURNSTILE_SCRIPT_URL;
    },
    transformIndexHtml(html) {
      if (!url) return html;
      if (!html.includes(TURNSTILE_SCRIPT)) {
        throw new Error(
          "VITE_TURNSTILE_SCRIPT_URL is set, but index.html no longer loads Turnstile from the expected address.",
        );
      }
      return html.replace(TURNSTILE_SCRIPT, url);
    },
  };
}

// `pnpm dev:web:stub` under portless (https://github.com/vercel-labs/portless),
// which serves the app at a named https://*.localhost URL. Does two things:
//
// - Points the app at the stub API's portless URL instead of .env.stub's
//   localhost:8787, which is only for running without portless. This runs in
//   the `config` hook because that is before Vite reads the .env files, and
//   Vite never lets a .env file override a variable already in the environment.
// - Gives the stub API's /split page its second origin. /split shows the app
//   twice, from two origins so each pane keeps its own session (see
//   apps/stub-api/src/split.js). Portless names this server once, so the second
//   is an alias to the same port, added once Vite is listening.
//
// The names and lookups are shared with the stub, in scripts/portless.mjs.
function portlessStub(mode) {
  if (mode !== "stub" || !underPortless()) return null;
  let alias;
  return {
    name: "portless-stub",
    apply: "serve",
    async config() {
      const [api, peer] = await Promise.all([
        portlessUrl(STUB.api),
        aliasName(STUB.peer),
      ]);
      alias = peer;
      process.env.VITE_API_URL = api;
      process.env.VITE_SUPABASE_URL = api;
      process.env.VITE_TURNSTILE_SCRIPT_URL = `${api}/turnstile/v0/api.js`;
    },
    configureServer(server) {
      const http = server.httpServer;
      if (!http) return;
      // The alias is a static route that portless never cleans up by itself,
      // so it goes when this process does, however that happens. Signals
      // that would end Vite without an "exit" event exit properly instead.
      // Only a SIGKILL leaves it behind, pointing at a dead port until the
      // next start replaces it.
      const remove = () => removeAliasSync(alias);
      const signals = {
        SIGINT: () => process.exit(130),
        SIGHUP: () => process.exit(129),
        SIGTERM: () => process.exit(143),
      };
      let closed = false;
      http.once("listening", async () => {
        try {
          await addAlias(alias, http.address().port);
        } catch (err) {
          server.config.logger.warn(
            `Could not add the portless alias ${alias}, so /split's right pane won't load: ${err.message}`,
          );
          return;
        }
        // Closed (by a restart) while the alias was being added.
        if (closed) return remove();
        process.once("exit", remove);
        for (const [signal, fn] of Object.entries(signals))
          process.once(signal, fn);
      });
      // A restart (after a config change) closes this server and calls
      // configureServer again for the next one.
      http.once("close", () => {
        closed = true;
        process.off("exit", remove);
        for (const [signal, fn] of Object.entries(signals))
          process.off(signal, fn);
        remove();
      });
    },
  };
}

// `VITE_`-prefixed env vars from apps/web/.env are exposed to client code as
// `import.meta.env.VITE_*` natively — no config needed. src/main.jsx is the
// only place in the app that reads them (see packages/core/src/config.ts).
export default defineConfig(({ isSsrBuild, mode }) => ({
  plugins: [
    isSsrBuild && stubUnreachableOnServer(),
    portlessStub(mode),
    turnstileScriptOverride(),
    dropOnnxWasmAssets(),
    react(),
    // The React Compiler runs as a Babel pass. This used to pass
    // `target: "18"`, which makes it emit imports from the `react-compiler-runtime`
    // shim; on React 19 the memoisation hooks it needs are exported by React
    // itself as `react/compiler-runtime`, so the target matches the installed
    // React and the shim package is gone.
    babel({ presets: [reactCompilerPreset({ target: "19" })] }),
    tailwindcss(),
    // Progressive web app: the installable manifest plus a Workbox service
    // worker that precaches the built shell. The editor already keeps lessons
    // in IndexedDB (LightningFS + the image store), so precaching the shell is
    // what makes it genuinely usable with no network — see the docs at
    // apps/docs/docs/developers/web-app/pwa-and-offline.md.
    VitePWA({
      // "prompt", not "autoUpdate": this app is an editor, and swapping the
      // running build out from under someone mid-lesson is not something to do
      // silently. src/lib/pwa.jsx turns this into a toast with a Reload action.
      registerType: "prompt",
      // No auto-injected registration snippet: src/lib/pwa.jsx registers the
      // worker itself so it can own the update UI. The <link rel="manifest">
      // is still injected into index.html either way; the icon and theme-color
      // tags the plugin doesn't own are written by hand there.
      injectRegister: null,
      manifest: {
        // Explicit id so the install identity survives any future change to
        // start_url (browsers otherwise derive it from start_url).
        id: "/",
        name: "Spelling Lesson Maker",
        short_name: "Spelling",
        description:
          "Create and print Spelling lessons with sections, text, and images.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        lang: "en",
        dir: "ltr",
        categories: ["education", "productivity"],
        // Light values from src/styles/globals.css, since a manifest can't
        // vary by theme: theme_color is --card, the header at the top of every
        // screen, so the OS chrome runs on from it, and background_color is
        // --background, so the splash screen matches the page that replaces
        // it. In the browser, index.html's theme-color tags and
        // ColorSchemeProvider take over and follow the dark theme too.
        theme_color: "#ffffff",
        background_color: "#f4f3ef",
        icons: [
          // "any" icons are drawn as-is (they carry their own rounded corners);
          // the maskable one is a full-bleed square the platform crops to its
          // own shape. All of them are written by scripts/icons.mjs from the
          // logo's shapes in src/lib/logo.js.
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
          {
            src: "/icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        shortcuts: [
          { name: "New lesson", short_name: "Editor", url: "/editor" },
          { name: "Lesson hub", short_name: "Hub", url: "/hub" },
        ],
      },
      workbox: {
        // The built shell: entry HTML, JS/CSS chunks, the self-hosted Fontsource
        // woff2 files and the icons. Deliberately not the homepage's feature
        // screenshots (public/home/*.jpg, ~490 KB) — marketing images aren't
        // worth an install-time download; the runtime rule below picks them up
        // the first time someone actually sees the homepage.
        globPatterns: ["**/*.{html,js,css,woff2,svg,png,ico}"],
        // dist/docs is the VitePress site, copied in by `pnpm build:docs` after
        // this build. It has its own hashed assets and its own pages; nothing
        // there belongs in the app's precache. (Vite empties dist first, so this
        // normally matches nothing. It's a guard for when it doesn't: a
        // Turborepo cache hit restores dist over what is already there.)
        //
        // The ALTCHA widget (src/lib/altchaWidget.js) is left out too. Only an
        // instance whose AI check is ALTCHA ever loads it, so precaching it would
        // cost every other install a download it never uses, and it is only
        // needed for an AI request, which can't happen offline anyway.
        globIgnores: ["docs/**", "**/altchaWidget-*.js"],
        // The vendor chunk is over Workbox's 2 MiB default on its own.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // Client-side routes are served the precached shell; App.jsx then
        // renders the right page. See WORKER_PATHS above for the exceptions.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: WORKER_PATHS,
        runtimeCaching: [
          {
            // Lesson images are addressed by the SHA-256 of their bytes
            // (packages/core/src/browser/imageRef.ts), so a given URL can never
            // change content — cache-first, and never revalidate. Matched by a
            // callback rather than a RegExp because VITE_API_URL may point at a
            // different origin, and Workbox only applies a RegExp route
            // cross-origin when it matches from the very start of the URL.
            urlPattern: ({ url }) =>
              /^\/images\/[0-9a-f]{64}$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "lesson-images",
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
              // 200 only — deliberately *not* 0. An opaque response carries no
              // status, so a cross-origin 404 or 502 is indistinguishable from
              // a hit, and CacheFirst would then serve that error from the
              // cache for the full 30 days without ever retrying: one blip
              // while an image is still uploading breaks it permanently.
              // (Opaque entries are also quota-padded to megabytes apiece,
              // which 300 of would blow the origin's storage budget.)
              //
              // Nothing is lost in the deployed app: the Worker serves the SPA
              // and /images from the same origin (apps/api/wrangler.jsonc), so
              // these responses are `basic` with a real status. A self-host
              // that points VITE_API_URL at another origin just doesn't get
              // offline images — the browser's own HTTP cache still applies —
              // which is the right way round from poisoning the cache.
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Everything else same-origin and image-shaped: today that's the
            // homepage's feature screenshots in public/home.
            urlPattern: ({ request, sameOrigin }) =>
              sameOrigin && request.destination === "image",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "static-images",
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      // The service worker is a production concern; leaving it off in dev keeps
      // the usual Vite HMR behaviour (and no stale-cache confusion). Flip
      // `enabled` to true temporarily to debug the SW itself.
      devOptions: { enabled: false },
    }),
  ],
  // Stub mode with PORTLESS=0. The stub builds links and /split's two origins
  // (localhost and 127.0.0.1) from this address, so it is pinned rather than
  // left to drift to another port, and kept off 5173 so it never collides with
  // an ordinary dev server. Under portless, the --port, --strictPort and
  // --host it passes take precedence over all three.
  server:
    mode === "stub" && !underPortless()
      ? { host: "127.0.0.1", port: 5180, strictPort: true }
      : undefined,
  resolve: {
    // "@/..." mirrors shadcn/ui's default alias convention. New shadcn-sourced
    // code uses it; pre-existing app code keeps its relative imports. Kept in
    // sync with jsconfig.json so editors resolve it too.
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  optimizeDeps: {
    // transformers.js resolves its ONNX runtime's .wasm/.mjs files relative to
    // its own module URL; esbuild pre-bundling rewrites those URLs into the
    // dep-cache and the runtime then 404s in dev. Leaving it un-optimised keeps
    // the files where the library expects them. Production builds are
    // unaffected either way (the library is only in the lazy fallback chunk).
    exclude: ["@huggingface/transformers"],
  },
  define: {
    // html2pdf.js / mammoth reference a Node-ish `global`; map it to globalThis
    // so the browser build resolves it.
    global: "globalThis",
  },
  // The server build (`pnpm build:ssr` -> dist-ssr/entry-server.js) that the
  // Worker imports. `target: "webworker"` and the `react-dom/server.browser`
  // entry below are what keep it inside the Web-standard surface workerd
  // provides: no node:stream, no Node globals.
  //
  // Nothing is externalised — the Worker has no node_modules to resolve at
  // runtime, so React and every component have to be in the bundle.
  ssr: {
    target: "webworker",
    noExternal: true,
    resolve: {
      conditions: ["workerd", "worker", "browser", "module", "import"],
    },
  },

  build: {
    rolldownOptions: {
      output: {
        // Rolldown puts everything reachable from the entry into one chunk;
        // Rsbuild used to split vendors out by default. Without this, editing
        // any app file invalidates the whole ~3.4 MB bundle for returning
        // visitors instead of just the app chunk. Dependencies that change on
        // their own cadence get their own long-lived chunks.
        //
        // `tags: ["$initial"]` confines both groups to the statically-reachable
        // graph. Without it the vendor group also swallows dependencies that are
        // only reached through a dynamic import — isomorphic-git and LightningFS
        // (~185 KB the editor loads on demand via src/lib/git/load.js) and the
        // tsparticles shapes — putting them back in the bundle every homepage
        // visitor downloads.
        codeSplitting: {
          groups: [
            {
              name: "react",
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/,
              tags: ["$initial"],
              priority: 20,
            },
            {
              name: "vendor",
              test: /[\\/]node_modules[\\/]/,
              tags: ["$initial"],
              priority: 10,
            },
          ],
        },
      },
    },
  },
  // No `build.target` override. Vite 8 defaults to `baseline-widely-available`
  // (chrome111, edge111, firefox114, safari16.4, ios16.4), which is *wider*
  // than the `["defaults", "not IE 11"]` browserslist this app used to compile
  // against — that query now resolves to a floor of chrome 109, edge 146,
  // firefox 140, safari 26.3. Chrome 109-110 is the only coverage given up.
}));
