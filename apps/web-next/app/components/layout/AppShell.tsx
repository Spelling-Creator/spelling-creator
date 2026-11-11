// The chrome every page of the app sits inside: one slim sticky header, the
// page below it.
//
// The route table's layout route (routes/shell.tsx) renders this around its
// outlet, which is what makes the chrome identical everywhere: the same
// header, with the same navigation, on the homepage and the editor and
// everything between. Pages describe only their own body, and use PageBody
// for its column so the columns line up too. The layout route's error
// boundary renders it too, so a missing page keeps the header.
//
// One route stays outside it: /oauth/authorize. It is a consent screen
// reached by redirect from a third-party MCP client, and app navigation on
// it would be an invitation to wander off mid-grant.

import type { ReactNode } from "react";
import AppHeader from "./AppHeader";

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    // min-h-svh and flex-1 on <main> so a short page's background still
    // reaches the bottom of the viewport.
    <div className="flex min-h-svh flex-col">
      <AppHeader />
      {/* The page column. @container/page: the editor's panes and the
          lesson's side rail size themselves against the space the page
          column actually has (`@min-[...]/page:`), not the viewport. */}
      <main className="@container/page flex-1 bg-background">{children}</main>
    </div>
  );
}
