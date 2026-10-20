// The SPA's configuration, read from this process's environment when the shell
// is served rather than baked into the bundle when it is built.
//
// On the Worker, the browser's settings (where the identity service is, which
// sign-in modes to offer, the Turnstile site key) are `VITE_*` values that Vite
// substitutes into the bundle at build time. That suits a deployment that builds
// its own bundle. It does not suit a published image: every instance has
// different values, so every instance would need its own build, which means a
// clone with Git LFS, a full workspace install and several minutes of Vite.
//
// So this host writes them into index.html as it serves it, from the same
// environment the API already reads, and apps/web/src/main.jsx prefers them to
// whatever the build baked in. One image then runs anywhere, and settings the
// SPA and the server both need (AUTH_MODE, USERNAME_DOMAIN) come from one
// variable each and cannot disagree.
//
// Two files are rewritten, both on their way out of the asset server, so every
// path to them sees the same result: a navigation, the SPA fall-through in
// routes/spa.js, the SSR template in routes/ssr.js, and the service worker's own
// precache request.
//
//   index.html  gains <script>window.__CONFIG__={...}</script> before </head>.
//   sw.js       has the shell's precache revision suffixed with a hash of that
//               script.
//
// The second is what makes a configuration change reach a browser that already
// has the app. The service worker answers navigations from its precached copy
// of index.html, and Workbox only fetches that copy again when its revision
// changes. The build computed the revision from the file on disk, which doesn't
// change when the configuration does. Suffixing it changes sw.js's bytes, so the
// browser installs the new worker, and changes the shell's revision, so that
// worker fetches the new shell. The app's usual "a new version is available"
// prompt then appears, exactly as for a new build.

import { createHash } from "node:crypto";

import { aiChallengeMode } from "../lib/aiChallenge.js";

/**
 * The browser settings, by the name main.jsx passes to configureCore, and the
 * environment variable each is read from.
 *
 * An allowlist, deliberately: everything here ends up in a page anyone can
 * read, and this process's environment also holds the service-role key.
 *
 * There is no API URL. This process *is* the API and serves the page, so the
 * page's own origin is always right (main.jsx uses it, as routes/ssr.js does).
 */
const BROWSER_SETTINGS = {
  // Where the browser reaches PostgREST and GoTrue. Unset, main.jsx uses the
  // page's origin, which is the layout the compose stack's gateway gives them.
  // Not SUPABASE_URL: that is the address *this process* uses, which in the
  // compose stack is a service name no browser can resolve.
  supabaseUrl: "PUBLIC_SUPABASE_URL",
  // Public by design. The server already reads it under this name.
  supabaseAnonKey: "SUPABASE_ANON_KEY",
  googleClientId: "GOOGLE_CLIENT_ID",
  turnstileSiteKey: "TURNSTILE_SITE_KEY",
  // Which check the AI dialogs show. The server reads it too, so the widget
  // the browser shows is always the one the server expects.
  aiChallenge: "AI_CHALLENGE",
  authMode: "AUTH_MODE",
  usernameDomain: "USERNAME_DOMAIN",
};

/**
 * The browser settings this environment sets. Unset and empty variables are
 * left out rather than sent as "", so a value the build did bake in survives.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, string>}
 */
export function browserConfig(env) {
  const config = {};
  for (const [key, name] of Object.entries(BROWSER_SETTINGS)) {
    const value = (env[name] || "").trim();
    if (value) config[key] = value;
  }
  return config;
}

/**
 * The inline script that carries `config`. `<` is escaped for the reason
 * routes/ssr.js's bootstrap script escapes it: a "</script>" inside a value
 * would otherwise end the block early.
 */
export function configScript(config) {
  return `<script>window.__CONFIG__=${JSON.stringify(config).replace(/</g, "\\u003c")}</script>`;
}

// The shell's precache entry, in either key order. Workbox writes `url` first
// today, but nothing promises that.
const SHELL_ENTRIES = [
  /(\{\s*"?url"?\s*:\s*"index\.html"\s*,\s*"?revision"?\s*:\s*")([^"]*)(")/,
  /(\{\s*"?revision"?\s*:\s*")([^"]*)("\s*,\s*"?url"?\s*:\s*"index\.html"\s*\})/,
];

/**
 * `sw.js` with the shell's precache revision suffixed, or null if the entry
 * isn't there to find.
 */
export function reviseShell(sw, suffix) {
  for (const pattern of SHELL_ENTRIES) {
    if (pattern.test(sw)) {
      return sw.replace(
        pattern,
        (_, before, revision, after) =>
          `${before}${revision}-${suffix}${after}`,
      );
    }
  }
  return null;
}

// The <script> index.html loads Turnstile with, attributes in any order.
const TURNSTILE_SCRIPT_TAG =
  /<script\b[^>]*\bsrc="https:\/\/challenges\.cloudflare\.com\/turnstile\/[^"]*"[^>]*>\s*<\/script>\s*/;

const SHELL_PATH = /^\/(index\.html)?$/;
const SERVICE_WORKER_PATH = "/sw.js";

/**
 * Wrap an `env.ASSETS`-shaped server so it serves index.html with `env`'s
 * browser settings in it, and sw.js with a shell revision that follows them.
 *
 * @param {{ fetch: (request: Request) => Promise<Response> }} assets
 * @param {Record<string, string | undefined>} env
 */
export function withBrowserConfig(assets, env) {
  const config = browserConfig(env);
  const script = configScript(config);
  // The suffix follows the script, and the script carries aiChallenge, so
  // dropping the Turnstile tag below also changes the shell's revision.
  const suffix = createHash("sha256").update(script).digest("hex").slice(0, 12);
  // index.html loads Cloudflare's Turnstile script on every page, because the
  // hosted instance's AI check is Turnstile. An instance that has chosen ALTCHA
  // or none at runtime will never use it, and loading it anyway would hand
  // every visitor's address to Cloudflare for nothing (and, on a network
  // without internet access, fail on every page). Only when the setting is
  // here: without it, the browser uses whatever the build chose.
  const withoutTurnstile =
    Boolean(config.aiChallenge) && aiChallengeMode(env) !== "turnstile";
  const warned = new Set();
  const warnOnce = (message) => {
    if (warned.has(message)) return;
    warned.add(message);
    console.warn(message);
  };

  const rewrites = {
    shell(html) {
      // A built index.html always has one. Without it there is nowhere safe to
      // put a script (before the doctype would put the page in quirks mode),
      // so the shell goes out as built and the baked-in values apply.
      if (!html.includes("</head>")) {
        warnOnce(
          "index.html has no </head>, so it is served without the runtime configuration.",
        );
        return html;
      }
      const page = withoutTurnstile
        ? html.replace(TURNSTILE_SCRIPT_TAG, "")
        : html;
      return page.replace("</head>", () => `${script}</head>`);
    },
    serviceWorker(sw) {
      const revised = reviseShell(sw, suffix);
      if (revised !== null) return revised;
      // Still served: the app works, only a configuration change now waits for
      // the next build to reach browsers that already have the shell.
      warnOnce(
        "sw.js has no precache entry for index.html, so a configuration change will not reach browsers that already have the app until the next build.",
      );
      return sw;
    },
  };

  return {
    async fetch(request) {
      const { pathname } = new URL(request.url);
      const rewrite = SHELL_PATH.test(pathname)
        ? rewrites.shell
        : pathname === SERVICE_WORKER_PATH
          ? rewrites.serviceWorker
          : null;
      if (!rewrite) return assets.fetch(request);

      // The file as it is on disk, whatever the browser sent: a plain GET even
      // for HEAD, because its length is what the rewrite changes, and without
      // the caller's conditional or encoding headers, because the asset server
      // would answer those about the file rather than about the page served
      // from it (a 304 with no body to rewrite, or compressed bytes).
      const res = await assets.fetch(
        new Request(request.url, {
          headers: { "Accept-Encoding": "identity" },
        }),
      );
      if (!res.ok) return res;
      const body = rewrite(await res.text());

      // Anything that describes the bytes on disk is wrong for the rewritten
      // page, so it goes rather than travels along. An ETag from the file would
      // stay the same when only the configuration changed, letting a cache in
      // front keep serving the old settings. The page carries Cache-Control:
      // no-cache, so dropping validators costs a full response, never a stale one.
      const headers = new Headers(res.headers);
      for (const name of [
        "ETag",
        "Last-Modified",
        "Content-Encoding",
        "Content-MD5",
        "Digest",
      ]) {
        headers.delete(name);
      }
      headers.set("Content-Length", String(Buffer.byteLength(body)));
      return new Response(request.method === "HEAD" ? null : body, {
        status: res.status,
        headers,
      });
    },
  };
}
