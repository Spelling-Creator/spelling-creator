// The layout route every page sits in: the app's chrome around the page.
//
// Its error boundary renders the same chrome, so a page that fails (or a
// path that isn't one) still has the header and its navigation.

import { Outlet } from "react-router";
import type { Route } from "./+types/shell";
import AppShell from "@/components/layout/AppShell";
import RouteErrorBoundary from "@/components/RouteErrorBoundary";

export default function Shell() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return (
    <AppShell>
      <RouteErrorBoundary error={error} />
    </AppShell>
  );
}
