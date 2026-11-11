// The new web app (apps/web-next), served through its own build.
//
// The app is being rewritten a route at a time (see
// apps/docs/docs/developers/web-app/rewrite.md). The paths that have moved
// are answered here, by React Router's request handler running the app's
// server build; every other path still goes where it always did, the old
// app's server render or its shell (routes/ssr.js, routes/spa.js). Both
// hosts call this first: the Worker's handleFrontend (routes/render.js) and
// the Node entry's frontend (node/server.js).
//
// The build is driven through its own runtime. entry.server.tsx re-exports
// React Router's createRequestHandler and RouterContextProvider, the key the
// app reads its host's settings under, and the list of paths it serves, so
// this file imports nothing of React Router itself and the Worker carries
// one copy of React and the router, the build's. The import is static, like
// ssr.js's, so a missing build is a bundling failure rather than a runtime
// surprise; turbo.json builds the app before anything that imports this.
//
// What the app needs from its host is small: which settings to configure
// core with, and the origin to build absolute URLs from. The settings are
// laid over the build's own (the app merges the two the same way on the
// server and in the browser), so a host passes only the keys it knows about
// and a value baked in at build time survives a host that has no say in it.

import * as build from "../../../web-next/build/server/index.js";

const { createRequestHandler, RouterContextProvider, hostContext, isNextPath } =
  build.entry.module;

const handle = createRequestHandler(build, "production");

// A client-side navigation asks for a page's data under the page's path with
// a `.data` suffix (React Router's single fetch). It is the same route, so it
// goes to the same app.
const DATA_SUFFIX = /\.data$/;

/**
 * True for a request the new app answers: a page it serves, or the data
 * request for one. Any method: a route may take a form submission.
 * @param {Request} request
 * @param {URL} url
 */
export function shouldServeNext(request, url) {
  if (request.method === "OPTIONS") return false;
  // The crawler prerender loads a page with this flag to get the plain shell
  // (routes/render.js); nothing here is prerendered that way, but a page
  // asked for with it would be rendered again inside the snapshot.
  if (url.searchParams.has("__prerender")) return false;
  return isNextPath(url.pathname.replace(DATA_SUFFIX, "") || "/");
}

/**
 * The settings the Worker's bindings can supply the app with, in the shape
 * configureCore takes. The Worker is the API, so the origin serving the page
 * is always the right one to fetch from. Only what is set: a key left out
 * keeps the build's value (the Turnstile site key and the Google client id
 * are baked in by the deploy and unknown here).
 * @param {object} env
 * @param {URL} url
 */
export function workerSettings(env, url) {
  return defined({
    apiUrl: url.origin,
    supabaseUrl: env.SUPABASE_URL,
    supabaseAnonKey: env.SUPABASE_ANON_KEY,
    aiChallenge: env.AI_CHALLENGE,
    authMode: env.AUTH_MODE,
    usernameDomain: env.USERNAME_DOMAIN,
  });
}

/** `settings` without the keys that are unset or empty. */
export function defined(settings) {
  return Object.fromEntries(
    Object.entries(settings).filter(([, value]) => Boolean(value)),
  );
}

/**
 * Answer the request with the new app.
 *
 * @param {Request} request
 * @param {object} settings  What the host knows, over the build's values
 *   (see workerSettings, and node/server.js for the other host's).
 * @param {URL} url
 * @returns {Promise<Response>}
 */
export function serveNext(request, settings, url) {
  const context = new RouterContextProvider();
  context.set(hostContext, { config: settings, origin: url.origin });
  return handle(request, context);
}
