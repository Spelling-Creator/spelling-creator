// The catch-all route, with two jobs while the two apps share the site.
//
// On a document request it is the 404: the loader throws the status and the
// error boundary renders the not-found page inside the shell. The Worker
// only sends this app the paths it serves (lib/routes.ts), so in production
// that is a path that is nobody's.
//
// On a client-side navigation it is the hand-off. A link in this app to a
// page the old app still serves (/editor, /login, the home page) matches
// here, and React Router would render the 404 without ever asking the
// server. The clientLoader asks the browser to load the document instead,
// and never resolves: the page is leaving. When the last route moves here,
// the clientLoader goes and this is a plain 404.

import { data } from "react-router";
import type { Route } from "./+types/not-found";
import { i18n } from "@/lib/i18n";
import { jsonLd, pageMeta } from "@/lib/seo";
import { siteOriginOf } from "@/lib/site";
import RouteErrorBoundary from "@/components/RouteErrorBoundary";

export function loader() {
  throw data(null, { status: 404 });
}

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  window.location.assign(request.url);
  await new Promise<never>(() => {});
}

export const meta: Route.MetaFunction = ({ location, matches }) => [
  // No preview image: the default is a live screenshot of the current page,
  // and a screenshot of an error is not worth rendering a browser for.
  ...pageMeta({
    origin: siteOriginOf(matches),
    pathname: location.pathname,
    title: i18n.t("notFound.title"),
    image: null,
    noindex: true,
  }),
  ...jsonLd(null),
];

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteErrorBoundary error={error} />;
}

// Never rendered: the loader always throws. React Router wants a component
// for a route all the same.
export default function NotFound() {
  return null;
}
