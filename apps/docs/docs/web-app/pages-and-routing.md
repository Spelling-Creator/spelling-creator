---
title: Pages & routing
---

# Pages & routing

The app is a single-page app with real-path client-side routes (served by
`BrowserRouter`, not hash routes). Every page has a genuine URL like `/hub/:id`,
which is what lets the Worker recognise a route it can [render server-side](./server-rendering.md),
and serve `index.html` for it so a deep link resolves before the router has run.

## One shell

The route table in `src/App.jsx` puts every page inside a single layout route,
`AppShell`, and that is the whole of the app's chrome: one slim sticky header
(`AppHeader`) with the page below it.

The header carries the app's five destinations as inline links (behind a menu
button and a sheet below `md`), the **New lesson** action, and a right-hand
cluster of utilities: install, the light/dark toggle, settings, notifications,
and the account menu. Pages that are _inside_ something (a lesson under the
hub, a document in the editor) pin a second, contextual bar (`PageBar`)
directly beneath it, carrying a breadcrumb trail and that page's actions. Plain
pages don't render one; their title lives in their body.

The shell has been through three shapes, and the history is why this one is so
small. Pages first rendered their own heavy `--primary` header over their own
`mx-auto max-w-*` column, restating the whole nav on every page. Then a
collapsible sidebar absorbed the nav and shrank the top bar to a breadcrumb,
which fixed the header and created a 16rem column of mostly-empty chrome beside
every content page, since five destinations don't fill a sidebar. They fit in
one row, so now there is one header, no sidebar, and every page gets the full
width of the viewport (which the homepage hero and the editor, in particular,
put to use).

Pages that need more room ask the **container**, not the shell; see
[Laying out against the container](#laying-out-against-the-container).

There is exactly one route outside the shell, and it is deliberate rather than
left over:

- `/oauth/authorize`: the MCP consent screen, reached by redirect from a
  third-party client (`apps/api/src/routes/oauth.js`). App navigation on a grant
  screen is an invitation to wander off in the middle of one.

`/` is inside it like everything else, both signed in (a dashboard) and signed
out (the marketing splash). The splash briefly had a header of its own, on the
grounds that a first-time visitor doesn't need navigation; that was a defensible
thing to say about the splash and the wrong thing to do to the app, because it
meant one URL rendered two different chromes depending on who you were.

## The content column

`components/layout/PageBody.jsx` is the column every page renders into, and it
exists for the same reason `AppShell` does: "the content column" had drifted
into five different things across the pages, at three different top paddings and
three different bottom ones, none of which meant anything.

There are two widths:

| Width            | Value       | For                                                                            |
| ---------------- | ----------- | ------------------------------------------------------------------------------ |
| `wide` (default) | `max-w-5xl` | Listings, dashboards, the lesson and its side rail.                            |
| `reading`        | `max-w-3xl` | Prose people read or write: comments, a proposal's description, a commit list. |

The `reading` width is why the page getting wider did **not** make lesson text
wider: a line of text set to the full width of a desktop screen is harder to
read, not easier. The lesson's sticky tab bar needs the column's width but
can't be the column, so it imports `PAGE_WIDTHS` rather than restating the
number. Both Suspense fallbacks (AppShell's and the route-level one in
`App.jsx`) simply render a `PageBody`.

Two places opt out and say so where they do: the marketing hero (a full-bleed
gradient) and the editor's panes. They still use `PageBody`'s side padding,
`PAGE_GUTTER`, which adds the safe-area insets on a phone turned sideways; see
[Mobile layout](./mobile-layout.md#the-utilities).

## Laying out against the container

`AppShell`'s `<main>`, the page column, is a named container
(`@container/page`), and anything that lays itself out against available space
keys off that rather than off a `lg:`/`xl:` viewport breakpoint. The editor's
outline pane appears once the page column passes 52rem; the lesson's "About"
rail moves alongside the lesson at the same 52rem.

The distinction dates from the sidebar era, when the page column was 13rem
narrower or wider depending on a collapse toggle and a viewport breakpoint had
no way to know which. With the sidebar gone the column and the viewport
currently agree, but the keys stay written against the container, so the next
thing that narrows the column (a future rail, a split view) costs nothing in
these layouts.

## The routes

| Route                      | Page                    | What it does                                                                                                                                                                                                        |
| -------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                        | **Home**                | Landing page. Signed out: a marketing splash (animated floating words + feature blurbs). Signed in: a dashboard (your lessons, latest-lessons feed, your activity, activity from people you follow, notifications). |
| `/editor`                  | **Editor**              | The lesson builder. Two panes (section outline and document), the outline appearing once the page column has room for it. **Preview** toggles the document pane for the reader's view of the lesson.                |
| `/editor/lessons`          | (redirect)              | Where the library used to be, as a dialog over the editor. Redirects to `/library`.                                                                                                                                 |
| `/editor/history`          | **Editor**              | The version-history panel, over the editor.                                                                                                                                                                         |
| `/editor/variations`       | **Editor**              | The [variations](./lesson-variations.md) panel, over the editor.                                                                                                                                                    |
| `/editor/collaborate`      | **Editor**              | The [live-collaboration](./live-collaboration.md) panel, over the editor.                                                                                                                                           |
| `/editor/check`            | **Editor**              | The [lesson checks](./lesson-checks.md) panel, beside the editor.                                                                                                                                                   |
| `/hub`                     | **Lesson hub**          | Public gallery of published lessons (plus your own drafts), with search.                                                                                                                                            |
| `/hub/:id`                 | **Lesson**              | The lesson itself, with an "About" rail: author, ages, section count, fork lineage, and the print / Word / fork actions.                                                                                            |
| `/hub/:id/practice`        | **Lesson (Practice)**   | [Interactive mode](./interactive-mode.md), full screen over the page.                                                                                                                                               |
| `/hub/:id/discussion`      | **Lesson (Discussion)** | Comments and the star rating.                                                                                                                                                                                       |
| `/hub/:id/proposals`       | **Lesson (Proposals)**  | [Changes proposed](./pull-requests.md) from other people's forks.                                                                                                                                                   |
| `/hub/:id/proposals/:prId` | **Lesson (Proposals)**  | One proposal, read-only. **Review & merge** hands off to the editor; see below.                                                                                                                                     |
| `/hub/:id/history`         | **Lesson (History)**    | The lesson's published commit timeline, read out of its packfile.                                                                                                                                                   |
| `/users/:id`               | **User profile**        | A user's public profile: bio, follower/following counts, a Follow button, and published lessons.                                                                                                                    |
| `/library`                 | **On this device**      | The [lessons this device holds](./local-lessons.md): open one, copy, rename or delete one, or start another. Works signed out.                                                                                      |
| `/login`                   | **Sign in**             | Magic-link sign-in / account status.                                                                                                                                                                                |
| `/moderation`              | **Moderation**          | Moderator/admin queue for reviewing reported content (gated to mods/admins).                                                                                                                                        |
| `/settings`                | **Settings**            | Appearance (light/dark/system), display language, [read-aloud](./interactive-mode.md) preferences, this device's lessons, and the account's display name and bio. Works signed out.                                 |

### Unknown paths

An unknown path is a **404**, status and page both. `NotFoundPage` renders in
the usual chrome and offers the home page and the hub; it replaced a
`<Navigate to="/">` that quietly turned every dead link into the homepage,
telling nobody anything had gone wrong.

The status matters as much as the page, and it is the host's to send. The
Worker's `apps/api/src/routes/spa.js` holds **the same route table** and decides
what a path gets:

| Path                             | Answer                               |
| :------------------------------- | :----------------------------------- |
| A file in the build              | The file                             |
| A route in the table             | `index.html`, `200`                  |
| Anything else, no extension      | `index.html`, `404` (`NotFoundPage`) |
| Anything else, with an extension | `text/plain`, `404`                  |
| A missing `/docs/…` page         | VitePress's own 404 page, `404`      |

Before this, the host answered every unmatched path with `index.html` and a
`200` (Cloudflare's `not_found_handling: "single-page-application"`). That is a
**soft 404**, a page insisting it exists, which is how a crawler ends up
indexing an unlimited supply of junk URLs, and it also meant a client probing
`/.well-known/anything.json` got a successful response containing an HTML
document. `not_found_handling` is now `"none"`, and the decision is made in code
that knows the routes.

So **the table in `spa.js` has to stay in step with `App.jsx`**, the same
standing obligation `ssr.js` and `WORKER_PATHS` already carry. The failure mode
is deliberately mild: a route added to `App.jsx` and forgotten there is still
served the shell and still renders correctly, it just carries a `404` status.

One caveat when you go looking for that status in a browser: a returning visitor
with the [service worker](./pwa-and-offline.md) installed is answered from the
precached shell (a `200`) without the Worker being asked at all. The page is
the same; only the status differs, and the audience the status is for (crawlers)
does not run service workers. Test it with a hard reload or a private window.

Two things are deliberately **not** 404s:

- **An unknown `/editor/<something>`.** The editor treats a panel name it
  doesn't recognise as "no panel open", so a stale link shows the editor rather
  than bouncing you out of it. `/editor/*` is a wildcard in both route tables.
- **A lesson that doesn't exist.** `/hub/<deleted-id>` _is_ a route, so it is
  served `200` and the app reports the miss once it has tried to fetch;
  see [Server rendering](./server-rendering.md).

`EditorShell` mounts no chrome (`AppShell` is already above it) and exists
only to hold the chunk boundary and the editor's own nested routes.

### A lesson's tabs

`src/pages/lesson/` holds one file per tab plus `LessonLayout.jsx`, which owns
the fetch, the identity header (title, author, rating) and every action on the
lesson as a whole. Tabs read the lesson through `useLesson()`, the layout's
outlet context, and never fetch it again.

They are real routes rather than a `<Tabs>` widget because that is what makes
them shareable, back-button-correct and [server-renderable](./server-rendering.md).

Two things deliberately did **not** become tabs:

- **Merging a proposal.** It is a genuine three-way merge against the lesson's
  git history, and that history lives in the editor's browser-side repository.
  `/hub/:id/proposals/:prId` is read-only and its **Review & merge** button
  navigates to `/editor?pull=<id>&lesson=<lessonId>`, exactly as the old stacked
  list did. See [Proposed changes](./pull-requests.md).
- **The editor's own history panel.** It reads _your_ repository, the one your
  edits are committed to. The lesson page's History tab is a different thing
  built on the published packfile (`GET /git/:lessonId/pack`); it loads the git
  engine on demand, so isomorphic-git stays out of the bundle a reader
  downloads.

## Query-string deep links

Four query strings deep-link into the editor rather than being routes of their
own:

| Link                           | What it does                                                                                                                                                                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `?join=<code>`                 | Opens the [live-collaboration](./live-collaboration.md) panel on that invite.                                                                                                                                                                |
| `?pull=<id>&lesson=<lessonId>` | Opens a [proposed change](./pull-requests.md) for review once the lesson it names has loaded; the lesson id is part of the link precisely so the review waits for the right one, rather than acting on whatever the editor already had open. |
| `?local=<id>`                  | Switches to one of the [lessons on this device](./local-lessons.md).                                                                                                                                                                         |
| `?new=1`                       | Starts a new lesson: what the header's **New lesson** button links to, since plain `/editor` resumes whichever lesson you last had open.                                                                                                     |

The first two are consumed once and then simply sit in the URL; the last two are
stripped from it as they are read, because they are instructions rather than
state and a reload should not carry them out twice. Opening an editor panel
preserves the query string, so navigating to `/editor/collaborate` never drops
the invite that sent you there.

## Offline and the service worker

Once the PWA service worker is installed it resolves these routes itself, from
the precached `index.html`, which is what lets a deep link open with no network.
The paths the Worker answers instead (the server-rendered routes, `/docs`,
`/images/…`, the SEO and MCP OAuth endpoints) are excluded by name; see
[Installable app & offline use](./pwa-and-offline.md#navigation-fallback-and-the-paths-it-must-not-touch).

That exclusion covers the whole of `/hub/*`, lesson tabs included, so those
paths **must** stay matched by the server renderer. A path excluded from the
shell and unmatched by the Worker works online (it falls through to the SPA
shell) and fails offline. `WORKER_PATHS` in `apps/web/vite.config.js` and
`LESSON_PATH` in `apps/api/src/routes/ssr.js` have to agree; both carry a
comment saying so.

Routing is set up in `src/main.jsx` (`BrowserRouter` + `SsrProvider` +
`AuthProvider`, wrapped in a `DisplayNameGate`) and the route table is in
`src/App.jsx`.

## Which routes are lazy

`src/App.jsx` splits the route table deliberately rather than lazy-loading
everything:

- **Eager**: `/`, `/hub`, `/users/:id`, and `/hub/:id` with all its tabs except
  History. The server-rendered routes have to be in the bundle the client
  hydrates with; deferring them would trade a smaller download for a round trip
  on the pages where first paint matters most. `/` is the commonest entry point.
- **Lazy**: `/hub/:id/history`, `/editor`, `/moderation`, `/login`,
  `/oauth/authorize`. History is lazy because it is the only reader-facing page
  that needs isomorphic-git and LightningFS (~200 KB). The editor matters most:
  ~6,000 lines, and the only owner of Yjs, `lib0` and the collaboration client,
  none of which a reader of a lesson should download. `EditorShell` is lazy for
  that reason too; importing it eagerly from `App.jsx` would pull the editor
  straight back into the main bundle.

`AppShell` mounts a `Suspense` boundary of its own around its `<Outlet/>`. The
one in `App.jsx` sits _above_ the layout routes, so a lazy page suspending there
unwinds past the shell and takes the header with it. The inner boundary keeps
the chrome on screen and replaces only the body.

Tiptap/ProseMirror stays eager on purpose: `CommentsSection` uses
`RichTextInput` on the public lesson page, so it isn't editor-only.

## Home page

The home page (`src/pages/HomePage.jsx`) has two faces, chosen from the auth
state. Both render inside the app's shell, under the same header as everywhere
else; only the body differs:

- **Signed out**: a hero whose backdrop is real spelling words drifting upward
  (built with [tsParticles](https://particles.js.org); see
  `src/components/FloatingWords.jsx`), followed by alternating feature blurbs.
  The words come from the Worker's `GET /spelling-words.json`, an aggregate of
  every spelling word taught across the published hub lessons, rebuilt at most
  once every two days and cached in KV (`apps/api/src/routes/spelling-words.js`).
  A spelling row can hold a phrase rather than a single word ("ice cream"), and
  those animate badly (the shape scales text by character count, so a phrase
  renders tiny and stretched), so `@spelling-creator/core/spellingWords` drops any entry
  containing whitespace and only single words reach the animation.
  If that fetch fails, a small built-in word list is used instead. Feature
  illustrations live under `apps/web/public/home/` (a missing file degrades to a
  labelled placeholder; see [Feature screenshots](#feature-screenshots) below).
- **Signed in**: a dashboard showing the user's own lessons (drafts included,
  from `GET /mine`; this list used to be a sidebar group, and a panel of your
  work is a better home for it than global chrome), the hub's latest-lessons
  Atom feed and the user's own activity feed (both parsed client-side from Atom
  with `DOMParser`, reusing the same `feed.xml` / `profiles/:id/feed.xml`
  endpoints the "RSS" links point at), a **"From people you follow"** feed
  (from the Worker's `GET /following/activity`; see
  [Following](./profiles-and-display-names.md#following)), plus a roomier list
  of the user's notifications.

### Feature screenshots

Each signed-out feature row shows a screenshot from `apps/web/public/home/`. The
row draws it at 16:10 with `object-cover`, so anything in another shape gets
cropped. Take new shots at 16:10 to avoid that.

| File                 | Shows                                                                    |
| -------------------- | ------------------------------------------------------------------------ |
| `feature-editor.jpg` | The editor with a full lesson loaded: header, sections sidebar, a block  |
| `feature-ai.jpg`     | The "Suggest text with AI" dialog (Generate with AI, then Text)          |
| `feature-images.jpg` | The "Search images" dialog with Wikimedia Commons results for "Penguin"  |
| `feature-hub.jpg`    | The top of the lesson hub list                                           |
| `feature-collab.jpg` | The "Collaborate on this lesson" dialog                                  |
| `feature-export.jpg` | Page one of a lesson's "Print PDF" export, on the app's background color |

The docs site's home page uses one more, `apps/docs/docs/public/img/screenshot.jpg`:
the editor's main column only (the title card and the first section), without
the header or sidebar. The docs hero draws it at about 260px wide, so a
whole-app view would be too small to read.

To retake them:

1. Use the live site, signed out, in light mode, at a device scale factor of 2.
   A 1120px-wide viewport fits the editor without crowding it.
2. For the editor shots, use a real hub lesson. Fetch its JSON from
   `GET /lessons/:id`, save the `doc` field to a `.json` file, and load it with
   the editor's **Import JSON** button. That keeps the lesson in the browser
   only. The current set uses "Penguins".
3. For the AI dialog, only open it. Don't press Generate. Pixabay search needs
   Turnstile, but Wikimedia Commons doesn't, so search there for the image
   dialog. Signed out, the Collaborate dialog shows a sign-in notice and
   disables its controls, so before taking that shot, edit the page in DevTools
   to look signed in: remove the notice and the `disabled` attribute from the
   Start button, the join-code input and the Join button. Those are the only
   differences signing in makes (see `renderLanding` in
   `CollaborateDialog.jsx`).
4. Crop the dialogs to 672x420 CSS pixels around the dialog, the editor to
   1120x700 from the top of the page, and the docs shot to about 870x625 around
   the main column.
5. Save the homepage shots as JPEG at 1008x630 (quality around 75) and the docs
   shot at 1100 wide. That's sharp at the size the row draws them (about 490px
   wide on desktop) and keeps the six homepage files around 500 KB in total.
