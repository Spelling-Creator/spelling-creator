// The scheme a request really arrived over, when a proxy terminated TLS for us.
//
// @hono/node-server builds each request's URL from the socket it came in on, so
// behind a reverse proxy that terminates TLS (the compose stack's Caddy gateway,
// nginx, a tunnel) every request reads as http:// even though the browser used
// https://. The API builds absolute URLs from that origin: the sitemap, the
// feed, robots.txt, and the canonical and og: links that server rendering puts
// in the page. They would all point people and crawlers at plain http.
//
// The proxy says what it received in `X-Forwarded-Proto`. Like
// `X-Forwarded-For`, it is only believed when a proxy is there to have written
// it: with `TRUSTED_PROXY_COUNT=0` the process is exposed directly and the
// caller could have set it to anything. Proxies set rather than append it, so
// where a chain has left a list, the last entry is the one the nearest proxy
// wrote.

import { trustedProxyHops } from "./platform.js";

/**
 * `request` with its URL's scheme set to the one the nearest trusted proxy
 * reports, or `request` itself when there is nothing to change.
 *
 * @param {Request} request
 * @param {Record<string, string | undefined>} env
 * @returns {Request}
 */
export function withForwardedScheme(request, env) {
  if (trustedProxyHops(env) === 0) return request;

  const header = request.headers.get("x-forwarded-proto") || "";
  const scheme = header.split(",").pop().trim().toLowerCase();
  if (scheme !== "https" && scheme !== "http") return request;

  const url = new URL(request.url);
  if (url.protocol === `${scheme}:`) return request;
  url.protocol = scheme;

  // Rebuilt field by field rather than with `new Request(url, request)`: Node
  // refuses a streamed body without `duplex: 'half'`, and an upload is exactly
  // the request that has one.
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    duplex: "half",
    redirect: request.redirect,
    signal: request.signal,
  });
}
