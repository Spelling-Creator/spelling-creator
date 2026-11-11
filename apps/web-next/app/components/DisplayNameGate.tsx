// Forces a signed-in user to pick a display name before using the app, so
// their email is never shown in place of a name. Renders the app as normal
// and overlays a non-dismissable DisplayNameDialog whenever the current user
// still needs to choose a name (see auth.needsDisplayName). New users hit
// this right after the magic-link sign-in completes.

import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import DisplayNameDialog from "@/components/DisplayNameDialog";

export default function DisplayNameGate({ children }: { children: ReactNode }) {
  const { needsDisplayName } = useAuth();
  return (
    <>
      {children}
      <DisplayNameDialog open={needsDisplayName} required />
    </>
  );
}
