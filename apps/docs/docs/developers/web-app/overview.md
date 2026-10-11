---
title: Web app overview
---

# Web app overview

For what the editor does from a user's point of view, see the
[user guide overview](../../guide/overview.md).

The web app (`apps/web`) is the lesson editor, the lesson hub and everything
around them. It is a single-page app with server rendering for public pages,
and most of its logic lives in the shared `@spelling-creator/core` package
(`packages/core`) so the MCP server and the Worker can use the same code.

## Stack

- **React 19 + Vite 8**, with the React Compiler, React Router 7 and
  `vite-plugin-pwa` for the [installable, offline app](./pwa-and-offline.md).
- **shadcn/ui on Radix, with Tailwind CSS 4** for the UI (see
  [Design system](./design-system.md)).
- **tiptap 3** for lesson text blocks and for comments and bios (see
  [Formatting, footnotes & sources](./formatting-and-footnotes.md) and
  [Rich text](./rich-text.md)).
- **isomorphic-git on LightningFS** for [version history](../version-history.md):
  every lesson is a real git repository in the browser, one file per content
  block, committed automatically as you pause.
- **Yjs** for the [live collaboration](./live-collaboration.md) document, synced
  through a Cloudflare Durable Object room with one WebSocket per participant.
- **i18next / react-i18next** for every user-facing string (see
  [Internationalization](./internationalization.md)). Only English ships today.
- **[`docx`](https://docx.js.org)** to build Word documents, and
  **[`mammoth`](https://github.com/mwilliamson/mammoth.js)** plus
  **[`html2pdf.js`](https://github.com/eKoopmans/html2pdf.js)** to turn that same
  document into a PDF, all in `@spelling-creator/core` and loaded on demand (see
  [Export pipeline](./export-pipeline.md)).
- **transformers.js** (`@huggingface/transformers`) for the models that run in
  the page: [lesson summaries](./lesson-summaries.md),
  [lesson translation](./lesson-translation.md), reading imported text with a
  model ([document import](./document-import.md)) and the natural read-aloud
  voice in [interactive mode](./interactive-mode.md).
- **Supabase** (`@supabase/supabase-js`) for passwordless magic-link sign-in (see
  [Hub & accounts](./hub-and-accounts.md)).
- The companion Worker in `apps/api` handles the hub, AI features, the Pixabay
  proxy and collaboration rooms. Set `VITE_API_URL` to point the app at it (see
  [Getting started](./getting-started.md)).

## How the main features are built

| Feature                    | How it works                                                                                                                                                                                                             | Page                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Saving and the lesson list | Each lesson is kept in IndexedDB, with images as binary blobs so a large draft isn't capped by `localStorage`'s ~5 MB quota. The editor holds a whole library of lessons, each with its own document and git repository. | [Lessons on this device](./local-lessons.md)                     |
| Preview and lesson page    | Both render the lesson model straight to React with `LessonView`, in the app's light or dark theme. No Word document is built to show a lesson.                                                                          | [Export pipeline](./export-pipeline.md)                          |
| Word, PDF and Google Docs  | One shared document builder makes the `.docx`; the PDF is that file converted to HTML with mammoth and rendered with html2pdf.js; Save to Google Docs uploads the same file to Drive with a Google OAuth2 token.         | [Export pipeline](./export-pipeline.md)                          |
| Question blocks            | The eight types, their colors, labels and Word styles are defined once in `packages/core/src/questions.js`.                                                                                                              | [Export pipeline](./export-pipeline.md)                          |
| VAKT activities            | A block type of its own, defined in `packages/core/src/vakt.js`.                                                                                                                                                         | [VAKT activities](./vakt-activities.md)                          |
| Text formatting            | Text blocks are stored as tiptap JSON once formatted, with footnotes and a lesson-level source list.                                                                                                                     | [Formatting, footnotes & sources](./formatting-and-footnotes.md) |
| Pictures                   | Pixabay goes through the Worker; Wikimedia Commons and Wikidata are called from the browser. Credits are stored apart from captions.                                                                                     | [Images](./images.md)                                            |
| Long lessons               | Sticky section headers, per-section question numbers, collapsible sections, the section outline and scroll anchoring.                                                                                                    | [Navigating large lessons](./navigating-large-lessons.md)        |
| Import from text           | A rule-based parser, with an optional on-device model for sections the rules can't read.                                                                                                                                 | [Document import](./document-import.md)                          |
| Comments and bios          | Sanitized HTML, enforced by the Worker's allow-list sanitizer and again at render time.                                                                                                                                  | [Rich text](./rich-text.md)                                      |
| Live collaboration         | A server-side room (a Cloudflare Durable Object), live cursors and an in-session chat. Invited people only start editing once the host adds them.                                                                        | [Live collaboration](./live-collaboration.md)                    |
| Version history and forks  | Forking clones a lesson's repository, and a fork can pull the original's changes in, merged block by block.                                                                                                              | [Version history](../version-history.md)                         |

The rest of this section covers [project structure](./project-structure.md),
[pages & routing](./pages-and-routing.md),
[server rendering](./server-rendering.md),
[mobile layout](./mobile-layout.md) and the other features one page each.
