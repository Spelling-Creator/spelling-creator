---
title: Overview
---

# Developer overview

This section is for people who work on Spelling Creator's code or run their own
copy of it. If you want to make and run lessons, the
[user guide](../guide/overview.md) is the place to start instead.

Spelling Creator is a pnpm monorepo: a React web app, the API it talks to, an
MCP server for AI assistants, a stand-in API for local work, this docs site, and
one shared package of lesson logic that all of them build on.

## Packages

The workspace is `apps/*` and `packages/*` (see `pnpm-workspace.yaml`).

| Path            | Package                      | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web`      | `@spelling-creator/web`      | The lesson editor and hub. Vite + React 19, shadcn/ui on Tailwind 4, TipTap for rich text, react-router, i18next, installable as a PWA. `pnpm build` produces the SPA in `apps/web/dist` and a server-rendering bundle in `apps/web/dist-ssr`.                                                                                                                                                                                                                                                                                                                                                               |
| `apps/api`      | `@spelling-creator/api`      | The backend, a Hono app with two entry points: a Cloudflare Worker (`src/index.js`) for the hosted instance and a plain Node server (`src/node/server.js`) for self-hosting. It serves the built SPA and docs, server-renders the public pages, and handles the hub, images, version history, proposals, moderation, notifications, profiles, feeds, and the AI features (Gemini, OpenAI, Anthropic, Groq, Novita, Fireworks, OpenRouter, any OpenAI-compatible server, or Workers AI). On Cloudflare it also hosts live collaboration, letterboard sessions and the remote MCP endpoint as Durable Objects. |
| `apps/mcp`      | `@spelling-creator/mcp`      | The MCP server that lets an AI assistant write, check and publish lessons on the hub. It runs locally over stdio, and the Worker imports it to serve the same tools remotely.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/cli`      | `@spelling-creator/cli`      | The `spelling-creator` command line tool: runs the lesson checks and quick fixes on a `.json`, `.docx` or text file and converts documents to lesson files, with no account or network. TypeScript, bundled with rolldown for npm and run straight from source in development. See [Command line tool](./cli.md).                                                                                                                                                                                                                                                                                            |
| `apps/stub-api` | `@spelling-creator/stub-api` | A local stand-in for the API with a populated hub and made-up people, for demos, screenshots and UI work without a backend. See [Stub API](./stub-api.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/docs`     | `@spelling-creator/docs`     | This VitePress site. Built into `apps/web/dist/docs` and served at `/docs/`. See [Getting started](./getting-started.md#documentation-site).                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `packages/core` | `@spelling-creator/core`     | Lesson logic that isn't tied to React or to one runtime: question types and the spelling block, the lesson file format and its import/export, lesson checks and fixes, hub search, the Yjs document and collaboration frames, the portable half of version history, image sources (Wikimedia Commons, Wikidata, Pixabay), and more. A separate browser tier holds the parts that need a DOM, such as IndexedDB storage, Word and PDF export, and the on-device models.                                                                                                                                       |

## How the pieces fit

- **The web app** does most of its work in the browser. Lessons live in
  IndexedDB, each one with its own git history, and the API is needed for the
  hub, accounts, uploaded images and the AI features.
- **The API** is the only thing that talks to the database and object storage.
  On the hosted instance that is Supabase (Postgres and Auth) plus R2 and KV; a
  self-hosted instance uses Postgres, PostgREST, GoTrue and any S3-compatible
  store instead. The [platform seam](./platform-seam.md) is what lets the same
  route code run on both.
- **The MCP server** talks to the hub through the same API endpoints the web app
  uses, signed in as the person using it.
- **The stub API** answers the same routes as the real API from memory, so the
  web app can run against it with no accounts or cloud services at all.

## Shared code

`packages/core` holds the parts of the lesson model that aren't tied to React, to
the browser, or to the Worker runtime, so the same rules apply whether a lesson
is edited in the web app, validated by the API, or written over MCP. The web app,
the API, the MCP server and the stub API all depend on it.

It has no build step and no barrel entry point: each module is its own subpath
export (`@spelling-creator/core/questions`, `/spelling`, `/jsonImport`, and so
on), the same convention `@spelling-creator/mcp` uses for its own exports. That
keeps browser-only modules out of the Worker's import graph: importing
`/questions` never drags in a module that touches `document`.

The modules that genuinely need a DOM (IndexedDB, `<canvas>`, `FileReader`, a
download link) live under `src/browser/` and are exported as
`@spelling-creator/core/browser/*`. Everything outside that directory is linted
against the `worker` environment, so a module there that reaches for a
browser-only global fails `pnpm lint` instead of breaking inside the Worker. See
[Code quality](./getting-started.md#code-quality).

Sharing a module does not mean collapsing two callers into one function. Where
the apps genuinely differ (the Commons integration returns a different result
shape to the image dialog than to an MCP tool, and pages results only in the
browser), core holds the common plumbing and each app keeps a thin adapter over
it. That keeps each app's public contract and error wording its own.

That split is also what a change of frontend framework would have rested on. The
[frontend migration](./frontend-migration.md) record weighed the options and
settled on staying with React and adding server rendering.

## Storage, and the platform seam

The API's storage on Cloudflare (lesson images and packed histories in R2,
rate-limit buckets and the AI answer cache in KV, cached responses in
`caches.default`) sits behind three small interfaces in `apps/api/src/platform/`
rather than being called as bindings from each route. See
[the platform seam](./platform-seam.md) for the interfaces, the executable
conformance suite that defines them, and what it takes to add a host.

## Where to go next

- [Getting started](./getting-started.md): install, run, test, and the repo's
  tooling.
- [Stub API](./stub-api.md): run the whole hub locally with no backend.
- [Self-hosting](./self-hosting.md): run your own instance on Node with Docker.
- [The platform seam](./platform-seam.md): how the API stays portable between
  Cloudflare and other hosts.
- [Web app](./web-app/overview.md): the editor's stack and how each feature is
  built.
- [MCP server](./mcp-server/overview.md): connecting AI assistants to the hub.
- [Lesson images](./lesson-images.md) and
  [version history](./version-history.md): how images and lesson histories are
  stored and synced.
