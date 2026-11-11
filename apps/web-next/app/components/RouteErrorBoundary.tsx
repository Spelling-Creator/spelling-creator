// What every route exports as its ErrorBoundary: the not-found page for a
// 404 (a route's loader throws one for a lesson or a profile that doesn't
// exist, and the catch-all route for a path that isn't one), and the error
// page for anything else. A route's own boundary renders in its outlet, so
// the shell around it stays.

import { isRouteErrorResponse } from "react-router";
import ErrorPage from "@/components/ErrorPage";
import NotFoundPage from "@/components/NotFoundPage";

export default function RouteErrorBoundary({ error }: { error: unknown }) {
  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFoundPage />;
  }
  return <ErrorPage error={error} />;
}
