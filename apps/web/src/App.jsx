// App shell — defines the client-side routes.
//
// Every page of the app renders inside one layout route, `AppShell`, which is
// what makes the chrome identical everywhere: the same header, with the same
// navigation, on the homepage and the editor and everything between. Pages
// describe only their own body, and use PageBody for its column so the columns
// line up too.
//
// There is exactly one exception, and it is deliberate rather than left over:
//
//   /oauth/authorize  — the MCP consent screen, reached by redirect from a
//                       third-party client (apps/api/src/routes/oauth.js). App
//                       navigation on a grant screen is an invitation to wander
//                       off in the middle of one, so it renders bare.
//
// Which routes are lazy is a deliberate split, not a blanket policy:
//
//   Eager — "/", "/hub", "/users/:id" and "/hub/:id" with all its tabs but
//   History. The lesson, hub and profile routes are server-rendered
//   (apps/api/src/routes/ssr.js), so their components have to be in the bundle
//   the client hydrates with; deferring them would trade a smaller download for
//   a hydration round-trip on exactly the pages where first paint matters most.
//   "/" is the landing page — the most common entry point, and not worth a
//   chunk request.
//
//   Lazy — "/hub/:id/history", "/editor", "/library", "/moderation",
//   "/settings", "/login" and "/oauth/authorize". None is server-rendered and none is reachable
//   without a deliberate click. History is the only reader-facing page that needs
//   isomorphic-git and LightningFS (~200 KB). The editor is the one that really
//   matters: ~6,000 lines and the only owner of Yjs, lib0 and the collaboration
//   client, none of which anyone reading a lesson should be downloading —
//   EditorShell exists to hold that chunk boundary.
//
// Tiptap/ProseMirror stays in the eager graph on purpose — CommentsSection uses
// RichTextInput on the public lesson page, so it is not editor-only.

import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AppShell from "./components/layout/AppShell.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";
import { SectionsSkeleton } from "./components/Skeletons.jsx";
import HomePage from "./pages/HomePage.jsx";
import HubPage from "./pages/HubPage.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";
import LessonLayout from "./pages/lesson/LessonLayout.jsx";
import LessonOverview from "./pages/lesson/LessonOverview.jsx";
import LessonDiscussion from "./pages/lesson/LessonDiscussion.jsx";
import LessonProposals from "./pages/lesson/LessonProposals.jsx";
import LessonProposal from "./pages/lesson/LessonProposal.jsx";
import LessonPractice from "./pages/lesson/LessonPractice.jsx";

const LessonHistory = lazy(() => import("./pages/lesson/LessonHistory.jsx"));
const EditorShell = lazy(() => import("./components/layout/EditorShell.jsx"));
const LibraryPage = lazy(() => import("./pages/LibraryPage.jsx"));
const LoginPage = lazy(() => import("./pages/LoginPage.jsx"));
const ModerationPage = lazy(() => import("./pages/ModerationPage.jsx"));
const SettingsPage = lazy(() => import("./pages/SettingsPage.jsx"));
const OAuthAuthorizePage = lazy(() => import("./pages/OAuthAuthorizePage.jsx"));

// Shown while a lazy route's chunk is in flight. A skeleton, not a spinner, per
// the project's UI convention.
//
// This one renders no chrome: this Suspense boundary sits above the layout
// route, so React unwinds past AppShell to reach it, taking the header with
// it. In practice it is almost never seen — AppShell has a boundary of its
// own, so a lazy page inside the shell keeps the header on screen and only its
// body is replaced.
function RouteFallback() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-16">
      <SectionsSkeleton />
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/hub" element={<HubPage />} />
          {/* The lesson's tabs. LessonLayout owns the fetch and the repo-style
              header; each child renders one tab's body into its <Outlet/>.
              apps/api/src/routes/ssr.js server-renders all of them. */}
          <Route path="/hub/:id" element={<LessonLayout />}>
            <Route index element={<LessonOverview />} />
            <Route path="practice" element={<LessonPractice />} />
            <Route path="discussion" element={<LessonDiscussion />} />
            <Route path="proposals" element={<LessonProposals />} />
            <Route path="proposals/:prId" element={<LessonProposal />} />
            <Route path="history" element={<LessonHistory />} />
          </Route>
          <Route path="/users/:id" element={<ProfilePage />} />
          <Route path="/moderation" element={<ModerationPage />} />
          {/* Deliberately not gated on a session: three of its four sections are
              this-browser preferences that work signed out. */}
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/login" element={<LoginPage />} />
          {/* The lessons this browser is holding. Not /lessons, which is the
              API's on the same origin (apps/api/src/app.js). */}
          <Route path="/library" element={<LibraryPage />} />
          {/* Where the library used to be, as a dialog over the editor. Kept so
              old links and bookmarks still land somewhere useful. It is more
              specific than /editor/*, so it wins. */}
          <Route
            path="/editor/lessons"
            element={<Navigate to="/library" replace />}
          />
          {/* Trailing * so EditorShell can own the routes below it. */}
          <Route path="/editor/*" element={<EditorShell />} />
          {/* An unknown path is a 404, not a detour to the homepage — and the
              host says so too: apps/api/src/routes/spa.js holds the same route
              table and serves this shell with a 404 status for anything not in
              it. Keep the two in step (as ssr.js and vite.config.js's
              WORKER_PATHS already are); a route missing there still renders,
              it just carries the wrong status. */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>

        {/* Outside the shell — see the note at the top of this file. */}
        <Route path="/oauth/authorize" element={<OAuthAuthorizePage />} />
      </Routes>
    </Suspense>
  );
}
