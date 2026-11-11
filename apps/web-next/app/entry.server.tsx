// The server entry: one request in, one document out.
//
// This runs wherever the server build runs: React Router's dev server, the
// Cloudflare Worker (apps/api/src/routes/next.js) and the self-hosted Node
// server. The hosts drive the build through its own runtime: the re-exports
// at the bottom are what the Worker calls, so it never imports React Router
// itself and there is exactly one copy of React and the router in play.

import { StrictMode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { isbot } from "isbot";
import {
  ServerRouter,
  type EntryContext,
  type HandleErrorFunction,
  type RouterContextProvider,
} from "react-router";
import { createServerI18n } from "@/lib/i18n";

// The hosts' side of the seam (see lib/host.ts and lib/routes.ts), reached
// as build.entry.module.<name>.
export { createRequestHandler, RouterContextProvider } from "react-router";
export { hostContext } from "@/lib/host";
export { isNextPath } from "@/lib/routes";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider,
) {
  let shellRendered = false;
  const userAgent = request.headers.get("user-agent");

  const body = await renderToReadableStream(
    <StrictMode>
      {/* One i18next instance per render: module scope on the server is
          shared by concurrent requests, so a shared instance would let one
          request's language settings affect another's. */}
      <I18nextProvider i18n={createServerI18n()}>
        <ServerRouter context={routerContext} url={request.url} />
      </I18nextProvider>
    </StrictMode>,
    {
      signal: request.signal,
      onError(error: unknown) {
        responseStatusCode = 500;
        // Errors from inside the shell are logged here. One thrown while the
        // shell itself renders rejects the stream and is logged by the
        // request handler instead.
        if (shellRendered) {
          console.error(error);
        }
      },
    },
  );
  shellRendered = true;

  // A crawler gets the whole document at once: it reads what it is given
  // and runs no script to fill in a suspended part later.
  if (userAgent && isbot(userAgent)) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html; charset=utf-8");
  // Not cached at the edge: a lesson or a profile that has just been edited
  // should not be served stale to the next visitor, and the render is
  // milliseconds of CPU. The X-Rendered header is the quickest way to tell,
  // from a browser, which app answered a page while the two share the site.
  responseHeaders.set("Cache-Control", "no-cache");
  responseHeaders.set("X-Rendered", "next");
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}

// A loader or render error that React Router caught on its way to an error
// boundary. A request the browser gave up on is not worth a line.
export const handleError: HandleErrorFunction = (error, { request }) => {
  if (!request.signal.aborted) {
    console.error(error);
  }
};
