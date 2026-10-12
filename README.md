# Spelling Creator (monorepo)

A pnpm monorepo containing the Spelling Lesson Maker web app and its Cloudflare
Worker API.

| Path            | Package                      | Description                                                                                                                                   |
| --------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`      | `@spelling-creator/web`      | Vite + React frontend (shadcn/ui + Tailwind, Supabase, react-router), installable as a PWA. Built into `apps/web/dist`, served by the Worker. |
| `apps/api`      | `@spelling-creator/api`      | Cloudflare Worker backend (multi-provider AI suggestions, profanity filter, KV rate limiting, R2 lesson images).                              |
| `apps/mcp`      | `@spelling-creator/mcp`      | MCP server that lets an AI assistant author and publish lessons to the hub.                                                                   |
| `apps/cli`      | `@spelling-creator/cli`      | Command line tool that checks, fixes and converts lesson files (`.json`, `.docx`, text) offline.                                              |
| `apps/stub-api` | `@spelling-creator/stub-api` | A local stand-in for the Worker API with a populated hub and made-up people, for demos and UI work without a backend.                         |
| `apps/docs`     | `@spelling-creator/docs`     | The VitePress documentation site published at `/docs/`.                                                                                       |
| `packages/core` | `@spelling-creator/core`     | Framework-agnostic lesson domain logic shared by the apps above.                                                                              |

## See it in action

Short screen recordings of the app, embedded in the docs and kept in
[`apps/docs/docs/public/videos`](apps/docs/docs/public/videos):

| Video                                                                                                                    | File                                                                 |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| [Building a lesson](https://spellingcreator.org/docs/guide/overview#see-it-in-action)                                    | [MP4](apps/docs/docs/public/videos/editor-build-a-lesson.mp4)        |
| [Working in a finished lesson](https://spellingcreator.org/docs/guide/overview#see-it-in-action)                         | [MP4](apps/docs/docs/public/videos/editor-fork-and-export.mp4)       |
| [Importing a lesson from text](https://spellingcreator.org/docs/guide/import-from-text#see-it-in-action)                 | [MP4](apps/docs/docs/public/videos/editor-import-from-text.mp4)      |
| [Adding a VAKT activity](https://spellingcreator.org/docs/guide/vakt-activities)                                         | [MP4](apps/docs/docs/public/videos/editor-vakt-activity.mp4)         |
| [Trying changes in a variation](https://spellingcreator.org/docs/guide/variations#see-it-in-action)                      | [MP4](apps/docs/docs/public/videos/editor-variations.mp4)            |
| [Writing a lesson with AI help](https://spellingcreator.org/docs/guide/ai-writing-help#see-it-in-action)                 | [MP4](apps/docs/docs/public/videos/editor-ai-writing-help.mp4)       |
| [Checking a lesson and fixing problems with AI](https://spellingcreator.org/docs/guide/ai-lesson-fixes#see-it-in-action) | [MP4](apps/docs/docs/public/videos/editor-check-and-fix-with-ai.mp4) |
| [Checking a lesson's facts](https://spellingcreator.org/docs/guide/fact-checking#see-it-in-action)                       | [MP4](apps/docs/docs/public/videos/editor-fact-check.mp4)            |
| [Working through a lesson](https://spellingcreator.org/docs/guide/interactive-mode#see-it-in-action)                     | [MP4](apps/docs/docs/public/videos/hub-practice-a-lesson.mp4)        |
| [Finding a lesson and joining the discussion](https://spellingcreator.org/docs/guide/hub-and-accounts#see-it-in-action)  | [MP4](apps/docs/docs/public/videos/hub-browse-and-discuss.mp4)       |
| [Publishing a draft](https://spellingcreator.org/docs/guide/hub-and-accounts#see-it-in-action)                           | [MP4](apps/docs/docs/public/videos/hub-publish-a-draft.mp4)          |
| [Following someone, then merging a proposal](https://spellingcreator.org/docs/guide/pull-requests#see-it-in-action)      | [MP4](apps/docs/docs/public/videos/hub-follow-and-merge.mp4)         |
| [Two practitioners editing one lesson](https://spellingcreator.org/docs/guide/live-collaboration#see-it-in-action)       | [MP4](apps/docs/docs/public/videos/live-collaboration.mp4)           |

## Documentation

Full documentation lives on the docs site: **https://spellingcreator.org/docs/**

- **[What is Spelling Creator?](https://spellingcreator.org/docs/intro)**: who
  it is for, and why "Spelling" covers several different, unstandardized
  practices (S2C is one of them, not a synonym).
- **[User guide](https://spellingcreator.org/docs/guide/overview)**: writing,
  checking, running and sharing lessons, and
  [connecting an AI assistant](https://spellingcreator.org/docs/guide/ai-assistants/overview).
- **[Developers](https://spellingcreator.org/docs/developers/overview)**:
  workspace layout, getting started, the stub API, self-hosting, storage and
  version history, the web app's internals, and the
  [MCP server](https://spellingcreator.org/docs/developers/mcp-server/overview).

The docs source is in `apps/docs/docs` (`guide/` for users, `developers/` for
everyone working on the code).

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

See **[Getting started](https://spellingcreator.org/docs/developers/getting-started)**
for the full set of commands and per-app environment files.
