// The chrome every page of the app sits inside: one slim sticky header, the
// routed page below it.
//
// This is a React Router *layout route* (see App.jsx) rather than something each
// page renders for itself, and that is the point of it. Every page used to open
// with its own copy of the chrome over `mx-auto max-w-*`, which is why they all
// looked alike; with the shell hoisted into the route table a page only has to
// describe its own body.
//
// The shell has been through three shapes, and the history is why this one is
// so small. First a heavy --primary header restating the whole nav on every
// page; then a collapsible sidebar (AppSidebar.jsx) that absorbed the nav and
// shrank the top bar to a breadcrumb — which fixed the header and created a
// 16rem column of mostly-empty chrome beside every content page. The app has
// five destinations; they fit in one row. So: one header (AppHeader.jsx), no
// sidebar, and every page gets the full width of the viewport.
//
// One route stays outside the shell: /oauth/authorize. It is a consent screen
// reached by redirect from a third-party MCP client, and app navigation on it
// would be an invitation to wander off mid-grant.

import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import { SectionsSkeleton } from "../Skeletons.jsx";
import AppHeader from "./AppHeader.jsx";
import PageBody from "./PageBody.jsx";

export default function AppShell() {
  return (
    // min-h-svh + flex-1 on <main> so a short page's background still reaches
    // the bottom of the viewport.
    <div className="flex min-h-svh flex-col">
      <AppHeader />
      {/* The page column. @container/page is kept from the sidebar era on
          purpose: the editor's panes and the lesson's side rail size themselves
          against the space the page column actually has (`@min-[...]/page:`),
          not the viewport. With no sidebar the two currently agree, but the
          panes' layout keys stay written against the container so the next
          thing that narrows the column — a future rail, a split view — costs
          nothing. */}
      <main className="@container/page flex-1 bg-background">
        {/* A Suspense boundary of its own, inside the shell. App.jsx has one
            too, but it sits *above* the layout routes: a lazy page suspending
            there unwinds past this shell, so the header disappears for as long
            as the chunk is in flight. Catching it here keeps the chrome on
            screen and replaces only the body. */}
        <Suspense
          fallback={
            <PageBody>
              <SectionsSkeleton />
            </PageBody>
          }
        >
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
