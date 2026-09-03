// The client-side route table, and the frontend fall-through that uses it.
//
// The app is a single-page app: /hub/abc is not a file on disk, it is a route in
// apps/web/src/App.jsx that the browser resolves once index.html has loaded. So
// the host has to answer such a path with index.html — "the shell" — or a deep
// link would fail before the router ever ran.
//
// The cheap way to do that is to serve the shell for *every* path with no file
// behind it, which is what Cloudflare's `not_found_handling:
// "single-page-application"` did. It costs a real bug: /nonsense and
// /.well-known/ai-catalog.json both answered `200` with an HTML document. To a
// person that reads as the homepage (App.jsx used to redirect there); to a
// crawler it is a soft 404 — a page insisting it exists, which is what gets an
// infinite supply of junk URLs indexed; and to a machine client probing a
// well-known URI it is a successful response containing entirely the wrong
// media type.
//
// So the shell is served for the paths this file recognises as routes, and
// everything else gets a real 404. That puts this table under the same standing
// obligation ssr.js's LESSON_PATH and vite.config.js's WORKER_PATHS already
// carry: it has to agree with App.jsx, and all three say so in a comment.
//
// The failure mode is mild by construction. A route added to App.jsx and
// forgotten here is still *served* the shell — the 404 body is the same
// document, so React Router mounts and renders the page normally. What it gets
// wrong is the status code, which nobody but a crawler reads. That asymmetry is
// deliberate: the alternative (serving an error page for anything unlisted)
// turns a one-line omission into a broken route.

import { textResponse } from '../lib/http.js';

const HOME_PATH = /^\/$/;
const HUB_PATH = /^\/hub\/?$/;

// A lesson and its tabs: /hub/:id, /hub/:id/history, /hub/:id/proposals/:prId,
// and so on. They are all views of one lesson, and one fetch serves every one of
// them — the tab decides what to draw with it. Exported because routes/ssr.js
// renders exactly these paths and needs the captured id.
//
// The tabs are named rather than matched as "any extra segment", so this and
// App.jsx's route table agree about what a lesson URL is. A wildcard would let
// /hub/:id/anything through, which costs a lesson fetch and a full render to
// produce a page React Router immediately treats as unmatched — and would make a
// typo indistinguishable from a route while reading either file. Adding a tab
// means editing this list; that is the intended amount of friction.
// `proposals` is the only tab with a child of its own (/proposals/:prId).
const LESSON_TABS = 'practice|discussion|history|proposals(?:/[^/]+)?';
const LESSON_PATH = new RegExp(`^/hub/([^/]+)(?:/(?:${LESSON_TABS}))?/?$`);
const PROFILE_PATH = /^\/users\/([^/]+)\/?$/;

const MODERATION_PATH = /^\/moderation\/?$/;
const LOGIN_PATH = /^\/login\/?$/;
// `<Route path="/editor/*">` — EditorShell owns everything below it, and treats a
// panel name it doesn't recognise as "no panel open" rather than as a 404. That
// is a deliberate choice about stale links (see the docs), so the wildcard is
// matched here too: /editor/whatever is a page, not a missing one.
const EDITOR_PATH = /^\/editor(\/|$)/;
// The MCP consent screen — the one route outside AppShell.
const OAUTH_AUTHORIZE_PATH = /^\/oauth\/authorize\/?$/;

const APP_PATHS = [HOME_PATH, HUB_PATH, LESSON_PATH, PROFILE_PATH, MODERATION_PATH, LOGIN_PATH, EDITOR_PATH, OAUTH_AUTHORIZE_PATH];

export { HUB_PATH, LESSON_PATH, PROFILE_PATH };

/**
 * True if this path is a page in App.jsx — i.e. one the shell can render.
 * @param {string} pathname
 */
export function isAppRoute(pathname) {
	return APP_PATHS.some((re) => re.test(pathname));
}

// Anything ending in an extension is asking for a file, not a page.
const FILE_PATH = /\.[a-z0-9]+$/i;

// The VitePress docs site, built into the SPA's dist as a subdirectory (see the
// `build` script in apps/docs/package.json). It is a separate static site that
// happens to share this origin, and it ships a 404 page of its own.
const DOCS_PATH = /^\/docs(\/|$)/;

/**
 * One of the built HTML documents, under whichever status the caller decided
 * this path deserves. Null if the build doesn't contain it.
 *
 * Fetched through ASSETS rather than reproduced here for the same reason ssr.js
 * does it: these documents carry hashed script/style tags, and nothing outside
 * the build should be in the business of knowing their names.
 */
async function document(request, env, href, status) {
	// HEAD is passed through so the asset layer can answer it with headers and no
	// body; everything else wants the document, including the GET behind a HEAD-less
	// client.
	const method = request.method === 'HEAD' ? 'HEAD' : 'GET';
	const res = await env.ASSETS.fetch(new Request(href, { method }));
	if (!res.ok) return null;
	// Same bytes and headers, the caller's status. `Content-Length` still describes
	// the body, because it is the same body.
	return new Response(res.body, { status, headers: res.headers });
}

/**
 * Serve the built frontend: the asset if there is one, the shell if the path is
 * a client-side route, and a 404 if it is neither.
 *
 * Both hosts end their frontend fall-through here — the Worker's `handleFrontend`
 * (routes/render.js) and the Node entry's (node/server.js) — so a path answers
 * the same way whoever is serving it. `env.ASSETS` is a plain static file server
 * on both: it 404s what it hasn't got and never substitutes the shell, which is
 * the whole reason this decision can live in one place.
 */
export async function serveApp(request, env, url) {
	const asset = await env.ASSETS.fetch(request);
	if (asset.status !== 404) return asset;

	const shell = (status) => document(request, env, `${url.origin}/index.html`, status);

	if (isAppRoute(url.pathname)) return (await shell(200)) || textResponse('Not found.', 404);

	// A missing file gets a plain 404 rather than a document. Handing HTML to a
	// broken script tag surfaces as a baffling syntax error instead of a missing
	// file — and handing it to a client that asked for /.well-known/something.json
	// is how this whole route came to be wrong. Checked before the docs branch
	// below, which is about pages: /docs/assets/app-abc123.js is a file.
	if (FILE_PATH.test(url.pathname)) return textResponse('Not found.', 404);

	// A missing docs page gets the docs site's own 404 rather than the app's. The
	// two are different sites sharing an origin, and being dropped into the React
	// app because a documentation link went stale is disorienting — VitePress
	// builds a 404 carrying the docs' own nav, so use that when it is there.
	if (DOCS_PATH.test(url.pathname)) {
		const docs = await document(request, env, `${url.origin}/docs/404.html`, 404);
		if (docs) return docs;
	}

	// An unknown page. The shell, so the app can render its own not-found page,
	// with the status that says so.
	return (await shell(404)) || textResponse('Not found.', 404);
}
