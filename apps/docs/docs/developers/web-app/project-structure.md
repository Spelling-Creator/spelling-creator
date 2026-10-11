---
title: Project structure
---

# Project structure

This page maps the web app's source (`apps/web/src`) and the shared package it
leans on (`packages/core`), then covers two conventions that live in shared
components rather than in any one page: auto-growing text fields and the focus
ring.

## The web app's source tree

```
src/
  App.jsx                 route table; the editor, library, settings, moderation, login, OAuth and lesson History routes are lazy (see pages-and-routing.md)
  main.jsx                browser entry: configureCore, then ColorSchemeProvider + TooltipProvider + BrowserRouter + SsrProvider + AuthProvider + DisplayNameGate + Toaster + ServiceWorkerPrompt; hydrates a server-rendered page, mounts a plain one
  entry-server.jsx        the same tree built for the Worker (see server-rendering.md), kept structurally in step with main.jsx
  styles/globals.css      Tailwind v4 + shadcn/ui design tokens (light/dark palettes, opaque surfaces, the radius scale, chrome heights), the focus ring, plus the `--safe-*` inset tokens and `*-safe` utilities (see design-system.md and mobile-layout.md)
  locales/en/*.json       one JSON file per i18next namespace (see internationalization.md)
  pages/
    HomePage.jsx          marketing splash (signed out) or dashboard (signed in)
    EditorPage.jsx        the lesson builder (toolbar, section list, + button, publish, collaborate), and the owner of which of this device's lessons is open
    HubPage.jsx           public gallery of published lessons + client-side search
    ProfilePage.jsx       a user's public profile: bio + their published lessons
    LibraryPage.jsx       the lessons this device holds (/library): open, copy, rename, delete, start another (see local-lessons.md)
    LoginPage.jsx         sign-in (magic link or emailed code, or username and password) / account status
    ModerationPage.jsx    moderator/admin queue for reported content
    SettingsPage.jsx      appearance, language, read-aloud, This device (install, lessons, downloaded AI models), account
    NotFoundPage.jsx      the 404 page for a path that isn't a route
    OAuthAuthorizePage.jsx  the MCP consent screen, the one route outside AppShell
    lesson/               one lesson (/hub/:id) and its tabs (see pages-and-routing.md)
      LessonLayout.jsx    owns the fetch, the identity header and every whole-lesson action; tabs read it via useLesson()
      LessonTabs.jsx      the tab bar: NavLinks to real routes, not a Tabs widget
      LessonOverview.jsx  the document itself + the "About" rail (author, ages, fork lineage, Print PDF / Download Word / Fork)
      LessonPractice.jsx  interactive mode, given a URL
      LessonDiscussion.jsx  comments + the star rating
      LessonProposals.jsx / LessonProposal.jsx  proposals from other people's forks; the detail view shows the diff and hands merging (or trying it in a variation) to the editor
      LessonHistory.jsx   the published commit timeline, read out of the lesson's packfile (lazy: it loads the git engine)
  components/
    layout/
      AppShell.jsx        the one layout route every page sits in: AppHeader + the page. Takes no configuration. Publishes @container/page
      AppHeader.jsx       the app's chrome: nav links (a sheet below md), New lesson, and the install/theme/settings/notification/account cluster
      PageBar.jsx         the contextual bar pinned under the header on lesson pages and in the editor: breadcrumb + the page's own actions
      PageBody.jsx        the content column, in two documented widths (wide / reading). Exports PAGE_WIDTHS for the tab bar, which needs the width but can't be the column, and PAGE_GUTTER, the safe-area-aware side padding for every content column
      EditorShell.jsx     the editor's single splat route behind one lazy import; mounts no chrome of its own
    editor/
      SectionOutline.jsx  the editor's left-hand section list (52rem+ of page column): jump to a section, collapse them all, see where checks found problems; `readOnly` reuses it beside the preview
      LessonPreview.jsx   what the editor's document column holds while Preview is on: the eyebrow, the narrow-screen exit, and LessonView in a panel frame
      LessonTextInput.jsx a text block's tiptap editor: bold/italic/underline and footnotes, committed like LiveField (see formatting-and-footnotes.md)
      LessonTextToolbar.jsx its toolbar and the footnote form (cite a source, add a note, or both; add a new source on the spot)
      SourcesPanel.jsx    the lesson's Sources card at the end of the editor, with how often each source is cited
      LessonChecksSheet.jsx  the "Check lesson" panel: findings grouped by section, each a link to its block (see lesson-checks.md)
      FactCheckSection.jsx   the Check panel's fact check (see fact-checking.md)
      AiFixDialog.jsx     ask AI to fix one check finding and preview the fix (see ai-lesson-fixes.md)
      checkGroups.js      groups the Check panel's items by section, shared by the checks and the fact check
      DocumentImportDialog.jsx  Import from text: paste or drop a .txt, .md or hand-written .docx and see what was found before importing (see document-import.md)
    InstallAppButton.jsx  the "Install app" control, in the header's utility cluster and on the settings page; renders nothing unless the app is installable (see pwa-and-offline.md)
    NotificationBell.jsx  header bell that polls for and shows the user's notifications
    DisplayNameGate.jsx   makes a signed-in user pick a display name before using the app
    DisplayNameDialog.jsx pick / change your public display name
    EmailCodeForm.jsx     the "code from the email" sign-in, shared by /login and the MCP consent screen (see pwa-and-offline.md)
    BioDialog.jsx         edit your public profile bio (rich text)
    FollowListDialog.jsx  a profile's followers and following, in two tabs
    FirstLessonWizard.jsx dismissable step-by-step welcome guide for newcomers
    FloatingWords.jsx     the homepage hero's drifting spelling words (tsParticles)
    Skeletons.jsx         shared loading skeletons, used instead of spinners
    CommentsSection.jsx   lesson comments list + post/reply/edit boxes, incl. the 1-5 star rating input
    RichTextInput.jsx     the tiptap-based editor used for comments + bios (formatting and links; no media)
    RichTextToolbar.jsx   its shadcn ToggleGroup toolbar (bold/italic/underline/lists/link/etc.)
    RichText.jsx          renders a stored comment/bio: sanitized HTML, or plain text for pre-rich-text values
    LiveField.jsx         debounced LiveInput/LiveTextarea (commit about 200ms after typing pauses, hold off remote updates while focused)
    TextRuns.jsx          draws a text block's formatted runs and a footnote's or source's citation as React elements (no innerHTML)
    LessonView.jsx        read-only renderer for the lesson page and the editor's preview mode (blocks straight to React, lazy images, drawn in the app's theme)
    LessonTranslation.jsx the published lesson's on-device Translate action (see lesson-translation.md)
    LessonSummary.jsx     on-device AI summary card on the lesson page (hidden unless the device can run an engine)
    InteractiveLesson.jsx full-screen step-by-step walkthrough of a lesson, with a field per question, autosaved progress you can come back to, and optional read-aloud (see interactive-mode.md)
    SpeechVoiceSelect.jsx the read-aloud voice picker (natural voices, then the browser's), shared by the walkthrough's popover and the settings page
    MyLessonAnswers.jsx   the reader's own saved answers on the lesson page, private to them
    SectionCard.jsx       a named section with its content blocks + add buttons; measures the pointer against its own rows during a block drag, but the drag itself is owned by EditorPage (blocks can move between sections)
    ContentBlock.jsx      a single text, spelling, image, VAKT or question block; owns BLOCK_LAYOUT, the responsive content/controls split (see mobile-layout.md)
    IconActionButton.jsx  the icon + tooltip button behind every block/section control; the tooltip doubles as its aria-label
    AiTextDialog.jsx       Turnstile-verified "Suggest text with AI" dialog
    AiQuestionDialog.jsx   Turnstile-verified "suggest a question with AI" dialog
    AiLessonIdeaDialog.jsx Turnstile-verified "suggest a whole lesson outline with AI" dialog
    ImageSearchDialog.jsx  the "Search images" dialog: Pixabay (Turnstile-verified, through the Worker) and Wikimedia Commons (see images.md)
    CollaborateDialog.jsx  live-collaboration control panel (host/join, roster, trusted collaborators)
    CollabCursors.jsx      floating colored carets showing collaborators' selections
    CollabChat.jsx         in-session chat: a floating corner panel on desktop, a bottom sheet on mobile
    HistoryDialog.jsx      the lesson's version timeline: what each commit changed, per block, + restore
    ChangeSummary.jsx      renders what a set of block operations changed, the same way wherever it's shown
    VariationsDialog.jsx   a lesson's variations: the branches of its repository, as an author sees them (see variations.md)
    MergeDialog.jsx        settle a merge: a fork's original, or a pull request being reviewed (mine / theirs / keep both)
    ProposeChangesDialog.jsx  open a pull request against the lesson this fork came from (see pull-requests.md)
    PullRequestsSection.jsx   proposed changes on a lesson's page, with review/merge and close for whoever may
    ui/                    shadcn/ui primitives (Button, Dialog, DropdownMenu, Select, Sheet, Tooltip, Sonner Toaster, Skeleton, etc.): Radix underneath, styled from the tokens in styles/globals.css
    ui/textarea.jsx        Textarea, which grows to fit its text (see "Auto-growing text fields" below); hence `resize-none`, and never a scrollbar
  lib/
    i18n.js                react-i18next setup: registers every namespace's resources, fallback/supported languages; exports baseConfig for the server render
    languages.js           LANGUAGES registry backing the settings page's language switcher (English only today)
    colorScheme.jsx        ColorSchemeProvider + useColorScheme (light/dark/system, persisted, applied as data-theme on <html>)
    useLiveField.js        shared debounce/commit buffering behind LiveField.jsx
    lessonSources.jsx      LessonSourcesProvider: hands text block editors the lesson's sources and their footnote numbering
    footnoteExtension.js   the tiptap footnote node (an inline atom numbered by a CSS counter)
    lessonChecks.js        the lesson checks as the editor shows them (the checks themselves are in core)
    factCheck.js           fact checking as the editor shows it
    collab.js              useCollaboration hook (one WebSocket to the CollabRoom Durable Object; doc sync, cursors, chat)
    useSelectionBroadcast.js broadcasts the local editor selection to peers
    useDragAutoScroll.js   scrolls the page while a block drag hovers near a window edge (the browser only auto-scrolls a native drag while the pointer keeps moving)
    useScrollAnchor.js     keeps a section/block still on screen while the move buttons reorder it, plus scrollToElement/idSelector (see navigating-large-lessons.md)
    git/                   what has to stay in the app; the rest is in core (see below)
      engine.js, load.js   the git engine, behind one dynamic import (keeps isomorphic-git off the main bundle)
      useLessonGit.js      the editor's controller: setup, periodic commits, history, restore
    exports/
      engine.js, load.js   the docx/PDF/import pipeline, behind one dynamic import (keeps docx, mammoth and html2pdf.js off every page that never exports; preview doesn't need it)
    useImageSrc.js         resolves an image ref to a displayable src
    speechPrefs.js         the read-aloud preferences (on/off, voice, pace) and the voice lists (the browser's, and the natural voices this device can run), shared by interactive mode and the settings page
    useSpeech.js           text-to-speech for interactive mode: the browser's voices over the Web Speech API, or a natural voice (Kokoro) played through Web Audio, with the browser's as the fallback
    auth.jsx               AuthProvider + useAuth (session, magic link, emailed code, password sign-in, sign out)
    seo.jsx                <DocumentMeta> / <JsonLd>: React 19 hoists these into <head>, which is what makes them work under SSR
    ssr.jsx                the client/server handoff: SsrProvider, useServerData, useSiteOrigin
    pwa.jsx                registers the service worker; toasts when a new build is waiting
    useInstallPrompt.js    captures beforeinstallprompt (or detects iOS Safari) behind the install button
    utils.js               cn(): clsx + tailwind-merge
```

### Outside `src/`

`public/icons/` holds the PWA icons and the two SVGs they're rasterized from,
and `public/home/` the homepage's feature screenshots. The `VitePWA` block in
`vite.config.js` holds the manifest and service-worker configuration (see
[Installable app & offline use](./pwa-and-offline.md)), and the same file holds
`SSR_UNREACHABLE`, the modules stubbed out of the server build (see
[Server rendering](./server-rendering.md#build-order)).

## Shared lesson logic

The parts of the lesson model that don't depend on React live in
`packages/core` (`@spelling-creator/core`), so the Worker and the MCP server can
apply the same rules. Each module is its own subpath export (listed in
`packages/core/package.json`); a few, noted below, are internal and reached
only through another module.

**Runtime-neutral**: safe to import from the browser, Node or the Worker:

```
@spelling-creator/core/
  config                the seam the host app passes its configuration through
  questions             question type definitions, colors, block factories
  spelling              helpers for the explicit "spelling words" block
  vakt                  shared definitions for the VAKT block (an activity, not a question)
  ageRanges             the age ranges a lesson can be pitched at
  lessonText            a text block's content: formatted paragraphs with footnotes
  sources               a lesson's sources (doc.sources) and how text blocks cite them
  lessonSearch          fully client-side hub search (Fuse.js)
  lessonFile            the .json lesson-file envelope (shared with the importer + MCP)
  jsonImport            parse + validate a .json lesson file back into the lesson model
  documentImport        import from text that was never a lesson file (pasted, .txt, hand-written Word)
  documentImportModel   the prompt and reply handling for the on-device model behind Import from text
  lessonBuild           build the editor's doc from the MCP server's LLM-friendly lesson input
  lessonPatch           apply a small list of edit operations to a doc (the MCP server's patch_lesson)
  lessonChecks          the lesson checks, shared by the editor and the MCP server
  lessonFixes           quick fixes for check findings that need no judgment
  lessonAiFixes         AI fixes for the findings that do
  factCheck             checking a lesson's facts against Wikidata, the Smithsonian GVP and Wikipedia
  wikidata, wikipedia   the plumbing those sources share (smithsonian and factText are internal)
  wikidataMedia         the pictures Wikidata lists for a topic
  image                 image sizing: selectable sizes, scale, fit-within
  imageCredit           an image's caption and its license credit, kept apart
  lessonLayout          the presentation constant every lesson render shares (DOCX_MAX_IMAGE_WIDTH), outside browser/ so the viewer and the server render can use it without pulling in docx + mammoth
  interactive           turning a lesson into the ordered walkthrough interactive mode steps through
  lessonResponses       saved answers from interactive mode, via the Worker
  lessonTranslation     what on-device translation covers in a lesson, and its lookup keys
  id                    id generation
  username              usernames as login identifiers, for an instance with no mail server
  wikimedia             Commons action-API round trip + attribution metadata
  lessons               list / fetch / publish hub lessons (+ the feed URL)
  comments              list / post / edit lesson comments
  pulls                 pull requests (proposed changes), via the Worker
  users                 other users' public profiles, follows, activity
  profile               your own profile (display name, bio)
  notifications         the notification feed
  moderation            the moderation queue
  pixabay               search + fetch Pixabay images via the Worker
  aiSuggest             AI text / questions / lesson ideas via the Worker
  spellingWords         the aggregated published-lesson word list
  mcpOAuth              the MCP OAuth approval handshake
  imagesClient          upload a lesson's images to the Worker (R2) on publish
  richText              rich-text policy: allow-list, link schemes, HTML to text
  translationLanguages  the languages comment translation covers: BCP-47 <-> FLORES-200
  opusMtModels          the per-pair Opus-MT models the translation fallback prefers (into English)
  collabFrames          the live-collaboration wire protocol, shared by the room, the browser and the MCP server
  ydoc                  the Yjs lesson document: Y.Doc <-> doc model, remote apply, reconcile
  git/remote            the /git/:lessonId endpoints (pack in R2)
  git/doc               pure doc helpers: canonical JSON, manifest, block map (no git)
  git/ops               diff two docs into block operations; render commit messages (no git)
  git/merge             three-way merge by block id, field-level (no git)
  git/refs              the names a lesson's branches may have (no git)
  git/layout            document <-> git tree (lesson.json manifest + blocks/<blockId>.json)
  git/repo              commit, history, diff two commits, restore (bare repo, pure plumbing)
  git/pack              pack for upload; clone/fetch from a pack; find the merge base
  git/memfs             an in-memory filesystem for the git engine, for hosts with no other
```

**Browser tier**: framework-agnostic, but needs a DOM (IndexedDB, `<canvas>`,
`FileReader`, an `<a>` to download). Behind a separate subpath so the Worker and
the MCP server cannot reach it by accident:

```
@spelling-creator/core/browser/
  imageStore            the IndexedDB stores themselves: the lesson library, its documents, image blobs, editor flags
  imageRef              binary image-ref model (a block references its bytes)
  imageFile             read a File to bytes, measure it, opportunistically re-encode to WEBP
  storage               the lesson library: every lesson this device holds, which one is open, and the two migrations into it
  interactiveProgress   the unfinished interactive run-through this device is holding (localStorage): resume, expiry, pruning
  modelCache            the on-device models transformers.js has downloaded (Cache Storage): their size, and deleting them
  docxExport            build the .docx (text, images, questions)
  docxImport            best-effort import of an exported .docx back into the lesson model
  documentText          the text of a file someone wants to import from (Word via mammoth, else plain text)
  documentModel         whether the device can run the Import from text model, and the door to its engine
  documentModelEngine   (internal) the engine itself, a lazy chunk only the import dialog loads
  pdfExport             docx -> html (mammoth) -> pdf (html2pdf.js), the only non-Word use of the Word pipeline
  jsonExport            download a lesson as .json (the envelope itself is in lessonFile)
  feeds                 read the hub / user Atom feeds (DOMParser)
  supabase              the Supabase browser client (auth only), built on first use
  turnstile             the Cloudflare Turnstile widget loader
  googleDrive           OAuth2 + upload the docx to Drive as a Google Doc
  sanitizeRichText      the render-time DOMPurify pass (policy comes from ../richText)
  commonsImages         search Wikimedia Commons + download an image (no key, no proxy)
  presence              per-collaborator color + selection presence helpers
  summarizer            on-device summaries: browser Summarizer API with an in-page fallback (fails closed when neither can run)
  fallbackSummarizer    (internal) the fallback itself: LFM2.5 via transformers.js on WebGPU, a lazy chunk only a click ever loads
  translator            on-device translation: browser Translator API with an in-page fallback
  fallbackTranslator    (internal) the fallback itself: Opus-MT / NLLB-200 via transformers.js, a lazy chunk only a click ever loads
  deviceCheck           (internal) the checks the in-page models share: the WebGPU adapter (asked for once a page), the large-model limits, a metered connection
  readAloud             the natural read-aloud voice (Kokoro): the device check, whether it's already downloaded, and the door to its engine
  readAloudEngine       (internal) the engine itself: text cleanup, espeak-ng phonemes (Spellophone), Kokoro via transformers.js on WebGPU, a lazy chunk only speaking ever loads
  readAloudVoices       (internal) the Kokoro model (id and pinned revision) and the voices on offer, readable without the engine
  downloadProgress      (internal) shared by the transformers.js engines: per-file download events summed into the one 0-1 fraction the UI shows
  git/fs                LightningFS, the IndexedDB filesystem the repos live on
  git/sync              fork (= clone the repo), merge-with-original and proposal-review flows
```

`.oxlintrc.json` enforces the split: `packages/core` is linted against the
`worker` env, and only `src/browser/**` is opted into `browser`. A module outside
that directory that reaches for `document` fails the lint rather than breaking
inside the Worker.

### The config seam

Core modules must not read `import.meta.env`: it is bundler-specific, substituted
at build time, and absent in Node, in the Worker and under any other bundler. A
module that reads it at import time can only ever be used by the web app, which is
what previously pinned the whole image/export tier inside `apps/web`.

So the host passes its configuration in once, before anything uses it:

```js
// apps/web/src/main.jsx: the only place in the app that touches import.meta.env
configureCore({
  apiUrl: import.meta.env.VITE_API_URL,
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
  turnstileSiteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
  authMode: import.meta.env.VITE_AUTH_MODE,
  usernameDomain: import.meta.env.VITE_USERNAME_DOMAIN,
});
```

The server render passes the same keys from the server's own bindings (see
`coreConfig` in `apps/api/src/routes/ssr.js`), so the page it renders and the
client it hydrates into agree.

Readers resolve **lazily** (`apiUrl()`, not a captured constant), which matters:
ES imports are hoisted, so `configureCore` runs after every module in the graph has
already been evaluated. Anything capturing the value at import time would capture
`""`. `packages/core/src/config.test.js` pins that behavior.

The same reasoning is why `browser/supabase` builds its client inside
`getSupabase()` rather than at module scope, memoizing it so the SDK's session and
refresh timer exist exactly once. It is also why the old `supabaseEnabled`,
`googleDriveEnabled`, `lessonHubEnabled`, `notificationsEnabled`, `profilesEnabled`
and `gitRemoteEnabled` constants are gone: every one was computed at module scope,
so under a lazily resolved config all of them would have read as `false`. They are
now predicates: `hasSupabase()`, `hasGoogleDrive()` and `hasApi()` (the last
replacing four names for one predicate), joined since by `hasTurnstile()`,
`hasPasswordAuth()` and `hasMagicLinkAuth()`.

### Why version history splits the way it does

`git/repo` and friends never open a filesystem themselves: every function takes
a `{ fs, gitdir }` context, which is why they port unchanged (LightningFS in the
browser, `git/memfs` where there is nothing else). What stays in the web app is
`lib/git/engine.js` and `lib/git/load.js` (the dynamic-import boundary and the
`Buffer` polyfill browsers need) plus `useLessonGit`, the editor's own
controller. `fs` (LightningFS over IndexedDB) and `sync` sit in core's browser
tier, and `remote` is runtime-neutral now that it reads its base URL through
[the config seam](#the-config-seam) rather than `import.meta.env`.

That boundary is load-bearing for bundle size: isomorphic-git stays behind
`load.js`'s dynamic import, in its own async chunk (about 200 KB), rather than in
the bundle every homepage visitor downloads. The `tags: ["$initial"]` on the
`vendor` code-splitting group in `vite.config.js` is what keeps the vendor chunk
from swallowing it back.

`wikimedia` holds only the parts of the Commons integration that are genuinely
common to both clients: the endpoint, the query/unwrap call, and the
license/author handling. The web app and the MCP server keep their own search and
download functions on top of it, because their result shapes, paging and error
wording are part of their respective contracts and are not interchangeable.

For how the other apps fit around this package, see the
[developer overview](../overview.md).

## Conventions in shared components

### Auto-growing text fields

Every `Textarea` sizes itself to its content, so a lesson paragraph or a long
question prompt is read in full inside its content block rather than scrolled
through a two-line slot. `ui/textarea.jsx` measures it: on each `input`, on any
change to a controlled `value` (a lesson loading, a collaborator's edit, an AI
suggestion landing in a block), and, via a `ResizeObserver` on the field, on
any change to its _width_, since re-wrapping the text changes how tall it needs
to be. That last one also covers a field going from zero width to a real one,
which is how a block inside a collapsed section gets measured when the section
is opened.

This was `field-sizing: content`, a single CSS declaration that does the same
job. It's deliberately gone: where a browser doesn't honor it there is no
symptom to debug, only a field stuck at its min-height showing a scrollbar and
a resize grabber, which is the exact state it existed to prevent. Measuring in
JS behaves identically everywhere, so it's the only path rather than a fallback
behind a feature test. Two class names ride along with it: `resize-none` (a
hand-dragged height would be overwritten by the next keystroke) and
`overflow-hidden` (the field is always exactly as tall as its text, so there is
nothing to scroll).

### Focus rings

`globals.css` gives `:focus-visible` the app's own ring (2px of `--ring`, offset
by 2px) in the base layer. shadcn's primitives are unaffected: they pair
`outline-none` with a `focus-visible:ring-*` of their own, and utilities beat
base. The rule is there for everything else, and the app has a lot of it: the
header's links and icon buttons, the editor's toolbar buttons, the star rating.
None of those had a focus style, so they fell through to the browser's default
ring, which Chrome draws as a dark outline banded with white: stray chrome
rather than part of the app, and on the old indigo header bar the white band
was the only part of it you could see.

It's a base rule rather than a class each control opts into because the
controls that were missing it are exactly the ones nobody thought about; this
way a new hand-rolled button gets it without anyone remembering.

One surface overrides the color, because `--ring` _is_ `--primary` and would
disappear into it: **HomePage's hero**, a fixed gradient that doesn't follow the
theme, so its two call-to-action links carry `focus-visible:outline-white`
themselves.

There used to be a second: `header :focus-visible` switched the ring to
`--primary-foreground`, because the app bar was a block of `--primary` and the
ordinary ring vanished into it. The header and `PageBar` now draw on `--card`,
so the ordinary ring is correct again, and the override had become actively
wrong, a near-white ring on a light surface. It is gone.
