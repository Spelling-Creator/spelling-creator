// Which paths this app answers, while the old app still answers the rest.
//
// The two apps share one site during the rewrite, and the Worker
// (apps/api/src/routes/next.js) decides per request which one serves it.
// This list is that decision, kept with the app so that adding a route here
// and adding it there is one edit: the Worker reads it through the server
// build (entry.server.tsx re-exports it).
//
// Inside the app the same split is handled without a list. A link to a path
// that is not here matches the catch-all route (routes/not-found.tsx), whose
// clientLoader hands the navigation to the browser as a full document load,
// so the Worker gets to answer it. When the last route moves, this file goes
// and the Worker sends every page here.

const NEXT_PATHS: RegExp[] = [/^\/hub\/?$/, /^\/users\/[^/]+\/?$/];

/** True when this app serves the page at `pathname`. */
export function isNextPath(pathname: string): boolean {
  return NEXT_PATHS.some((pattern) => pattern.test(pathname));
}
