// Requests this app makes to itself, answered in-process on both hosts.
//
// Server rendering loads a page's data the way the browser would, through core's
// own client, from the origin the page is being served at (see coreConfig in
// routes/ssr.js). That is an HTTP request to the app's own public address, and
// on neither host does such a request actually come back here:
//
// - On the Cloudflare Worker, a fetch to the Worker's own hostname is not
//   routed back into the Worker (that is how Cloudflare prevents loops); it is
//   sent on to the zone's origin server. This site has no origin server behind
//   the Worker, so the request times out and Cloudflare answers it with a 522.
// - On the Node host, the public address is often unreachable from inside the
//   process: behind the compose stack's gateway the request arrives for
//   localhost:8080, and inside the container nothing listens there.
//
// Either way, rendering then fails, falls back to the bare shell, and logs
// "SSR data/shell failed". The remote MCP server's tools, which call back into
// the API at SPELLING_CREATOR_API_URL (routes/mcp.js), fail the same way on the
// Worker.
//
// So `fetch` is wrapped. While a request is being handled, its origin and the
// app's handler are kept in an AsyncLocalStorage, and any fetch to that same
// origin goes straight to the handler instead of onto the network. Everything
// else (PostgREST, GoTrue, object storage, AI providers) goes through the real
// `fetch`.
//
// A fetch made outside any request's context has no serving origin to match,
// and that is not only the Worker's queue handler. The MCP tools run in the
// HubMcp Durable Object, which the Worker reaches by relaying messages to it,
// so the Worker request's context never extends to them. For those callers
// there are standing routes (`serveSelfAt`): an origin the app always answers
// in-process, whatever context the fetch was made in. A request's own origin
// still wins when one is being served.
//
// No configuration, and it works whatever is in front of the process: a proxy
// on another port, a domain, TLS, or nothing at all.
//
// One exception. The same origin can also serve PostgREST and GoTrue, under
// /rest/v1 and /auth/v1: that is the layout the compose stack's gateway gives
// them, and a reverse proxy elsewhere may do the same with SUPABASE_URL set to
// the public address. Those paths belong to the upstreams, never to this app
// (app.js has no route under either), so a fetch to them always goes over the
// network, even when its origin is ours.

import { AsyncLocalStorage } from "node:async_hooks";

const serving = new AsyncLocalStorage();

// Origins the app answers in-process even outside a request's context, keyed by
// origin (see serveSelfAt).
const standing = new Map();

// Marks the wrapper so installing it twice (a test building several handlers)
// doesn't wrap the wrapper.
const WRAPPED = Symbol.for("spelling-creator.selfFetch");

// PostgREST's and GoTrue's paths, where they share an origin with the app.
const UPSTREAM_PATH = /^\/(rest|auth)\/v1(\/|$)/;

/** The URL a fetch is for, however it was called. Null if it isn't a URL. */
function urlOf(input) {
  try {
    return new URL(input instanceof Request ? input.url : String(input));
  } catch {
    return null;
  }
}

/**
 * A `fetch` that answers requests to the origin currently being served, or to a
 * standing route, with the app's own handler, apart from PostgREST's and
 * GoTrue's paths, and passes every other request to `baseFetch`.
 *
 * @param {typeof fetch} baseFetch
 * @returns {typeof fetch}
 */
export function createSelfFetch(baseFetch) {
  const selfFetch = (input, init) => {
    const current = serving.getStore();
    if (current || standing.size > 0) {
      const url = urlOf(input);
      if (url && !UPSTREAM_PATH.test(url.pathname)) {
        const handle =
          current && url.origin === current.origin
            ? current.handle
            : standing.get(url.origin);
        // Only a request to ourselves is rebuilt as a Request, so every other
        // call reaches the real fetch exactly as it was made.
        if (handle) return handle(new Request(input, init));
      }
    }
    return baseFetch(input, init);
  };
  selfFetch[WRAPPED] = true;
  return selfFetch;
}

/** Wrap the global `fetch`, once. */
// The global, rather than a fetch handed to each caller, because the callers are
// core's API client and the route code, which all use the global fetch, exactly
// as they do on the Worker. Passing one in would mean threading it through every
// module that makes a request.
export function installSelfFetch() {
  if (!globalThis.fetch[WRAPPED])
    globalThis.fetch = createSelfFetch(globalThis.fetch);
}

/**
 * Wrap a request handler so that, while it runs, fetches to the request's own
 * origin are answered by the handler itself.
 *
 * @param {(request: Request) => Promise<Response>} handle
 * @returns {(request: Request) => Promise<Response>}
 */
export function servingSelf(handle) {
  // Self-requests go to `serve`, the wrapped handler, not to `handle`, so that
  // a self-request is itself served with the same context and can make
  // self-requests of its own. That is not a loop: each self-request passes
  // through here once on its way to `handle`, as each subrequest does on the
  // Worker.
  const serve = (request) =>
    serving.run({ origin: new URL(request.url).origin, handle: serve }, () =>
      handle(request),
    );
  return serve;
}

/**
 * Answer every fetch to `origin` in-process with `handle`, in any context, until
 * the returned function is called. For callers that run outside a request's
 * context, like the MCP tools in the HubMcp Durable Object (routes/mcp.js). The
 * handler is wrapped with servingSelf, so the requests it serves can make
 * self-requests of their own. Registering the same origin again replaces it.
 *
 * @param {string} origin  An origin, such as "https://spellingcreator.org".
 * @param {(request: Request) => Promise<Response>} handle
 * @returns {() => void}  Removes the route.
 */
export function serveSelfAt(origin, handle) {
  const serve = servingSelf(handle);
  standing.set(origin, serve);
  return () => {
    if (standing.get(origin) === serve) standing.delete(origin);
  };
}
