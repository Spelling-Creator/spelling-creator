# Spelling Creator (monorepo)

A pnpm monorepo containing the Spelling Lesson Maker web app and its Cloudflare
Worker API.

| Path            | Package                      | Description                                                                                                                                   |
| --------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`      | `@spelling-creator/web`      | Vite + React frontend (shadcn/ui + Tailwind, Supabase, react-router), installable as a PWA. Built into `apps/web/dist`, served by the Worker. |
| `apps/api`      | `@spelling-creator/api`      | Cloudflare Worker backend (multi-provider AI suggestions, profanity filter, KV rate limiting, R2 lesson images).                              |
| `apps/mcp`      | `@spelling-creator/mcp`      | MCP server that lets an AI assistant author and publish lessons to the hub.                                                                   |
| `apps/stub-api` | `@spelling-creator/stub-api` | A local stand-in for the Worker API with a populated hub and made-up people, for demos and UI work without a backend.                         |
| `apps/docs`     | `@spelling-creator/docs`     | The VitePress documentation site published at `/docs/`.                                                                                       |
| `packages/core` | `@spelling-creator/core`     | Framework-agnostic lesson domain logic shared by the apps above.                                                                              |

## See it in action

Short screen recordings of the app, embedded in the docs and kept in
[`apps/docs/docs/public/videos`](apps/docs/docs/public/videos):

| Video                                                                                                                            | File                                                           |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [Building a lesson](https://spellingcreator.org/docs/web-app/overview#see-it-in-action)                                          | [MP4](apps/docs/docs/public/videos/editor-build-a-lesson.mp4)  |
| [Working in a finished lesson](https://spellingcreator.org/docs/web-app/overview#see-it-in-action)                               | [MP4](apps/docs/docs/public/videos/editor-fork-and-export.mp4) |
| [Finding a lesson and joining the discussion](https://spellingcreator.org/docs/web-app/lesson-hub-and-accounts#see-it-in-action) | [MP4](apps/docs/docs/public/videos/hub-browse-and-discuss.mp4) |
| [Publishing a draft](https://spellingcreator.org/docs/web-app/lesson-hub-and-accounts#see-it-in-action)                          | [MP4](apps/docs/docs/public/videos/hub-publish-a-draft.mp4)    |
| [Following someone, then merging a proposal](https://spellingcreator.org/docs/web-app/pull-requests#see-it-in-action)            | [MP4](apps/docs/docs/public/videos/hub-follow-and-merge.mp4)   |
| [Two practitioners editing one lesson](https://spellingcreator.org/docs/web-app/live-collaboration#see-it-in-action)             | [MP4](apps/docs/docs/public/videos/live-collaboration.mp4)     |

## Documentation

Full documentation lives on the docs site: **https://spellingcreator.org/docs/**

- **[Monorepo](https://spellingcreator.org/docs/monorepo/overview)**: workspace
  layout, getting started, the stub API, and lesson image storage (R2 +
  IndexedDB).
- **[Web App](https://spellingcreator.org/docs/web-app/overview)**: the Spelling
  Lesson Maker, with its features, routing, AI helpers, image search, Google
  Docs export, live collaboration, the lesson hub, the export pipeline, and
  [installing it as an offline-capable app](https://spellingcreator.org/docs/web-app/pwa-and-offline).
- **[MCP Server](https://spellingcreator.org/docs/mcp-server/overview)**: connect
  an AI assistant to author and publish lessons to the hub.

The docs source is in `apps/docs/docs`.

## Quick start

Images and videos are stored in [Git LFS](https://git-lfs.com), so install it
(`git lfs install`) before cloning, or run `git lfs pull` afterwards.

```bash
pnpm install            # install all workspace deps
pnpm dev:web            # run the frontend (Vite)
pnpm dev:api            # run the Worker locally (wrangler dev)

pnpm dev:stub           # or: run a stub backend with a populated hub...
pnpm dev:web:stub       # ...and the frontend against it (sign in as "maya")
```

See **[Getting started](https://spellingcreator.org/docs/monorepo/getting-started)**
for the full set of commands and per-app environment files.
