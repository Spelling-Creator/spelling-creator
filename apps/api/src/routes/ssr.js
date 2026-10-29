// Server-side rendering for the app's public read-only routes.
//
// /hub, /hub/:id and /users/:id are the pages whose primary content is a public
// JSON fetch, so the Worker can fetch it and render the real React tree before
// the browser has run a line of JavaScript. Everyone gets the rendered HTML —
// not just crawlers, which is what separates this from the Chromium prerender
// in render.js (that one still covers the routes listed below as not renderable).
//
// What this deliberately does NOT do is render anything personalised. The
// Supabase session lives in localStorage behind PKCE and is invisible to a
// server, so the render is always anonymous and the signed-in parts of the page
// fill in when the client hydrates. That is the property that makes SSR
// tractable here at all: every route worth rendering is a public read.
//
// Failure at request time is soft: a failed data fetch or a render error falls
// through to the static SPA shell, which is exactly what the app served before
// this route existed. The one exception is the API answering 404, which means
// the page doesn't exist; that comes back as a real 404 still carrying the
// shell (see serverRender). A *missing* server bundle is not a runtime case at
// all — the import below is static, so the Worker fails to bundle, which is why
// every script that reaches wrangler builds it first.

import { fetchComments } from "@spelling-creator/core/comments";
import { configureCore } from "@spelling-creator/core/config";
import {
  fetchLesson,
  fetchPublishedLessons,
} from "@spelling-creator/core/lessons";
import { fetchUserProfile } from "@spelling-creator/core/users";

// The app compiled for workerd — see apps/web/vite.config.js and
// src/entry-server.jsx. This is a build artifact, so apps/web's `build:ssr` has
// to have run before the Worker is tested, run or bundled; turbo.json makes
// those tasks depend on it.
import { render } from "../../../web/dist-ssr/entry-server.js";

// The three public read routes, taken from the app's route table in routes/spa.js
// rather than restated here — one description of what a lesson URL looks like,
// shared by the code that renders one and the code that decides it is a page at
// all.
//
// Matching a lesson's *tabs* is not optional. The service worker's
// navigateFallback denylist excludes the whole of /hub/* from the precached shell
// (WORKER_PATHS in apps/web/vite.config.js), on the grounds that the Worker
// answers those paths itself. If LESSON_PATH stopped at /hub/:id, a tab would be
// excluded from the shell *and* unmatched here: online it would fall through to
// the SPA shell and still work, but offline — where there is no Worker to fall
// through to — it would fail outright. The two lists have to agree.
import { HUB_PATH, LESSON_PATH, PROFILE_PATH } from "./spa.js";

/**
 * Which page (if any) this request should be server-rendered as. `load`
 * resolves to the whole bootstrap data object, keyed the way the pages read it
 * back through useServerData.
 * @returns {{load: () => Promise<object>}|null}
 */
function matchRoute(url) {
  if (HUB_PATH.test(url.pathname)) {
    return { load: async () => ({ lessons: await fetchPublishedLessons() }) };
  }
  const lesson = url.pathname.match(LESSON_PATH);
  if (lesson) {
    // No access token: a private draft 404s here and the author sees it after
    // hydration, when their own authenticated fetch runs.
    return {
      load: async () => {
        const id = decodeURIComponent(lesson[1]);
        // The comments ride along for the page's structured data (the comment
        // markup in buildLessonSchema). Their failure must not cost the
        // render, so it degrades to markup without them; the lesson's own
        // failure keeps its meaning (a 404 stays a 404).
        const [full, comments] = await Promise.all([
          fetchLesson(id),
          fetchComments(id).catch(() => null),
        ]);
        return comments ? { lesson: full, comments } : { lesson: full };
      },
    };
  }
  const profile = url.pathname.match(PROFILE_PATH);
  if (profile) {
    return {
      load: async () => ({
        profile: await fetchUserProfile(decodeURIComponent(profile[1])),
      }),
    };
  }
  return null;
}

/**
 * True for requests this route should try to render: a GET navigation to one of
 * the three public read routes.
 */
export function shouldServerRender(request, url) {
  if (request.method !== "GET") return false;
  // The prerender browser sets this when it loads a page; leave it the plain
  // shell so a snapshot of an already-rendered page can't nest.
  if (url.searchParams.has("__prerender")) return false;
  const accept = request.headers.get("accept") || "";
  if (!accept.includes("text/html")) return false;
  return matchRoute(url) !== null;
}

// The build-time configuration the browser passes to core from import.meta.env
// (see apps/web/src/main.jsx); here it comes from the Worker's own bindings so
// that core's fetches resolve and `hasSupabase()` agrees with what the client
// will compute — a page that renders signed-out chrome on the server and
// signed-out chrome on the client's first pass is a page that hydrates cleanly.
function coreConfig(env, url) {
  return {
    // This Worker *is* the API, so the origin serving the page is always the
    // right one to fetch from — no configuration, and it follows the request
    // into local dev and any preview deployment.
    apiUrl: url.origin,
    supabaseUrl: env.SUPABASE_URL,
    supabaseAnonKey: env.SUPABASE_ANON_KEY,
    googleClientId: "",
    turnstileSiteKey: "",
    // Set for the same reason as the two below: configureCore merges, so a
    // value left out would carry over from whatever set it last.
    aiChallenge: env.AI_CHALLENGE || "turnstile",
    // The two settings a self-hosted instance changes about sign-in. Nothing
    // rendered here reads them today — the login page is not one of the public
    // read routes, and a server render is always signed out — but the SPA is
    // configured with them and this is the same core module, so leaving them
    // out would mean the server quietly holding a different configuration from
    // the client it hydrates into. `configureCore` merges, so an unset value
    // here would also persist between requests. Both default the same way core
    // does when the host doesn't set them.
    authMode: env.AUTH_MODE || "magic-link",
    usernameDomain: env.USERNAME_DOMAIN || "",
  };
}

// The built index.html, which carries the hashed script/style tags, the PWA
// manifest link and the pre-paint theme script. Rendering into it rather than
// reproducing it keeps this route out of the business of knowing asset names.
async function shell(env, url) {
  const res = await env.ASSETS.fetch(new Request(`${url.origin}/index.html`));
  if (!res.ok) throw new Error(`Could not read the app shell (${res.status}).`);
  return res.text();
}

// index.html carries site-wide social defaults for the pages that aren't
// rendered here. On a rendered page they are duplicates of what <DocumentMeta>
// just produced, and a scraper reading the *first* og:title it finds would get
// the generic one — so the generic set comes out and the page's own goes in.
// Everything else in <head> (viewport, theme-color, icons, feeds, scripts) is
// untouched.
//
// The defaults are recognized by their data-seo-default marker, not by tag
// names: the crawler prerenderer (routes/render.js) removes the same set from
// a live DOM where the page's own title and og tags are already present, and
// matching by name there would take the page's tags with it. One marker, two
// removal sites, same meaning.
function stripDefaultMetadata(html) {
  return html
    .replace(/<title\s+data-seo-default[^>]*>[\s\S]*?<\/title>\s*/i, "")
    .replace(/<meta\s+data-seo-default[^>]*>\s*/gi, "");
}

// Serialise the page's data for the client to hydrate against. The escape is
// the one that matters in an inline <script>: a "</script>" occurring inside
// any string value would otherwise close the block early.
function bootstrapScript(path, data) {
  const json = JSON.stringify({ path, data }).replace(/</g, "\\u003c");
  return `<script>window.__SSR__=${json}</script>`;
}

/**
 * Render the page, or return null to let the caller fall back to the shell.
 */
export async function serverRender(request, env, ctx, url) {
  const route = matchRoute(url);
  if (!route) return null;

  const config = coreConfig(env, url);
  configureCore(config);

  let data;
  let html;
  try {
    // A request back to this same app, answered in-process by selfFetch (see
    // lib/selfFetch.js, installed by both entries), through the very same core
    // module the browser calls — no server-specific client, which is what
    // keeps the two paths from drifting.
    data = await route.load();
    html = await shell(env, url);
  } catch (err) {
    // A 404 from the API is an answer, not a breakdown: this lesson or profile
    // does not exist, or is a private draft, which the API reports the same
    // way on purpose. Repeat it as a real 404 carrying the shell, so a deleted
    // page stops telling crawlers it exists (a "soft 404"), while a draft's
    // author still reaches it after hydration through their own authenticated
    // fetch, since the SPA never reads the status. Every other failure stays a
    // soft fall-through to the 200 shell: a timeout and a deletion must not be
    // confused, and core's errors carry the status so they can't be. (The API
    // keeps its side of that: a profile lookup that failed is a 502, not a 404;
    // see routes/users.js.)
    if (err?.status === 404) {
      try {
        return new Response(await shell(env, url), {
          status: 404,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache",
            "X-Rendered": "ssr-404",
          },
        });
      } catch (shellErr) {
        console.error("SSR shell failed", url.pathname, shellErr);
        return null;
      }
    }
    console.error("SSR data/shell failed", url.pathname, err);
    return null;
  }

  let head;
  let body;
  try {
    ({ head, body } = await render({
      url: url.toString(),
      config,
      data,
      signal: request.signal,
    }));
  } catch (err) {
    console.error("SSR render failed", url.pathname, err);
    return null;
  }

  // Function replacements, not strings. In a *string* replacement `$&`, `` $` ``,
  // `$'`, `$$` and `$1` are substitution syntax — and everything being spliced
  // in here carries user text (a lesson title, an author name, a profile bio).
  // A lesson titled `$'` would otherwise re-insert everything after the match,
  // duplicating the rest of the shell into the response. A function replacement
  // is taken literally.
  const page = stripDefaultMetadata(html)
    .replace("</head>", () => `${head}</head>`)
    .replace('<div id="root"></div>', () => `<div id="root">${body}</div>`)
    .replace("</body>", () => `${bootstrapScript(url.pathname, data)}</body>`);

  return new Response(page, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Deliberately not cached at the edge. The render is milliseconds of
      // CPU (unlike the Chromium prerender this replaces), and a lesson or a
      // profile that has just been edited should not be served stale to the
      // next visitor.
      "Cache-Control": "no-cache",
      "X-Rendered": "ssr",
    },
  });
}
