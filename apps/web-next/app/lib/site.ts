// The site's origin, as the root route's loader worked it out (root.tsx):
// what the host says it is, or the request's own. Safe to call during a
// server render, which is what canonical links and JSON-LD need it for.

import { useRouteLoaderData } from "react-router";

interface RootData {
  origin?: string;
}

/** The origin, from inside a component. */
export function useSiteOrigin(): string {
  const root = useRouteLoaderData("root") as RootData | undefined;
  return root?.origin ?? "";
}

/**
 * The origin, from a route's `meta` function, which gets the matched routes
 * rather than a hook. The root route is always the first match.
 */
export function siteOriginOf(
  matches: ReadonlyArray<{ loaderData?: unknown } | undefined>,
): string {
  const root = matches[0]?.loaderData as RootData | undefined;
  return root?.origin ?? "";
}
