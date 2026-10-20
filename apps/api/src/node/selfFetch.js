// Requests this process makes to itself, answered in-process.
//
// Server rendering loads a page's data the way the browser would, through core's
// own client, from the origin the page is being served at (see coreConfig in
// routes/ssr.js). On the Worker that is one subrequest back into the same
// Worker. On this host it is an HTTP request to the public address, which from
// inside a container is usually unreachable: behind the compose stack's gateway
// the request arrives for localhost:8080, and inside the container nothing
// listens there. Rendering then fails, falls back to the bare shell, and logs
// "Could not reach the lesson hub".
//
// So `fetch` is wrapped. While a request is being handled, its origin and the
// app's handler are kept in an AsyncLocalStorage, and any fetch to that same
// origin goes straight to the handler instead of onto the network, which is
// what the Worker's subrequest amounts to anyway. Everything else (PostgREST,
// GoTrue, object storage, AI providers) goes through the real `fetch`.
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
 * A `fetch` that answers requests to the origin currently being served with the
 * app's own handler, apart from PostgREST's and GoTrue's paths, and passes every
 * other request to `baseFetch`.
 *
 * @param {typeof fetch} baseFetch
 * @returns {typeof fetch}
 */
export function createSelfFetch(baseFetch) {
  const selfFetch = (input, init) => {
    const current = serving.getStore();
    const url = current && urlOf(input);
    if (
      url &&
      url.origin === current.origin &&
      !UPSTREAM_PATH.test(url.pathname)
    ) {
      // Only a request to ourselves is rebuilt as a Request, so every other
      // call reaches the real fetch exactly as it was made.
      return current.handle(new Request(input, init));
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
