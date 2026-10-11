---
title: Development
---

# Development

```bash
pnpm --filter @spelling-creator/mcp start        # run the stdio server directly (or: pnpm dev:mcp)
pnpm --filter @spelling-creator/mcp test         # node --test over apps/mcp/test
pnpm --filter @spelling-creator/mcp build:views  # rebuild the interactive views after editing views/
```

The tests run on Node's built-in runner against a fake hub (`test/fake-hub.js`)
and cover the tool surface end to end (`smoke`), validation, fact checking,
images, forking and proposals, version history, live sessions, elicitation
(the confirm prompts) and the views. CI runs them with every other package's
tests (`pnpm -r test` in `.github/workflows/ci.yml`).

## Where things live

| File                 | Responsibility                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/stdio.js`       | Local entry point (the package's `bin`): loads config, builds the server, connects stdio.                                                       |
| `src/worker.js`      | Remote pieces the Worker composes: `buildMcpServer`, `grantAuth`, `durableSessionStore`. See [Remote mode](./remote-mode.md).                   |
| `src/tools.js`       | Tool definitions and handlers, transport-agnostic. Also exports `SERVER_INFO`.                                                                  |
| `src/collabTools.js` | The live-session tools. See [Live sessions](./live-sessions.md).                                                                                |
| `src/collab.js`      | The document arithmetic behind them: decoding the room's state and working out Yjs updates.                                                     |
| `src/standards.md`   | The authoring standard's prose half: the rules that need judgment.                                                                              |
| `src/standards.js`   | The seam that loads `standards.md` in both runtimes (with `standards.node.js` and `standards.workerd.js`).                                      |
| `src/validate.js`    | The write path's side of validation, over the checks in `@spelling-creator/core/lessonChecks`. See [Lesson validation](./lesson-validation.md). |
| `src/api.js`         | The hub client (the same Worker endpoints the web app uses).                                                                                    |
| `src/git.js`         | Version history: committing edits, forking, proposing, and reviewing or merging a proposal.                                                     |
| `src/wikimedia.js`   | Commons search and download for `search_images` and `add_image`, over `@spelling-creator/core/wikimedia`.                                       |
| `src/images.js`      | Content hashing for uploaded image bytes.                                                                                                       |
| `src/auth.js`        | Supabase token rotation for stdio, and the shared refresh call.                                                                                 |
| `src/config.js`      | Environment variables and the `.env` loader. See [Configuration](./configuration.md).                                                           |
| `src/login.js`       | The `login` helper.                                                                                                                             |
| `src/views.js`       | The `ui://` resources behind [interactive views](./interactive-views.md).                                                                       |
| `views/`             | Source for those views (markup and script), built into `src/views/*.html`.                                                                      |
| `scripts/pack.mjs`   | Builds the `.mcpb` bundle. See [Packaging the bundle](./packaging.md).                                                                          |

Most of the lesson logic the tools lean on lives in `packages/core`, so the web
editor, the Worker and this server build and patch lessons the same way:
`@spelling-creator/core/lessonBuild` builds the canonical editor document (and
throws on input it can't turn into one), `@spelling-creator/core/lessonPatch`
applies id-addressed edit operations to an existing document,
`@spelling-creator/core/lessonChecks` holds the checks, and the `git/*`
modules handle the lesson repositories.

`src/standards.md` is prose, so it is edited as a document rather than as an
escaped JavaScript string, and `src/standards.js` is only the seam that loads
it. Getting a markdown file into both runtimes takes a per-runtime resolution:
`#standards-md` (a subpath import declared in `apps/mcp/package.json`) points at
`standards.workerd.js` under the `workerd` condition, which imports the markdown
as a Text module; wrangler needs the `rules` entry in `apps/api/wrangler.jsonc`
(globs `**/*.md` and `**/*.html`) to load it that way, and that rule matches on
the import specifier, which is why the shim names the file by a literal relative
path. Everywhere else it points at `standards.node.js`, which reads the file off
disk (`src/` ships whole in the `.mcpb` bundle, so the path holds for an
installed server too). The built views reach both runtimes the same way, through
`#image-picker-html` and `#proposal-diff-html`.

A view is one self-contained HTML file, because the host renders it in a
sandboxed iframe that may fetch nothing at runtime. `pnpm build:views`
(`scripts/build-views.mjs`) bundles `views/<name>.js` with esbuild and inlines
it into `views/<name>.html`, writing the result to `src/views/`. That output is
**committed**: the server has no build step of its own (`dev:mcp` runs from
source, the `.mcpb` bundle copies `src/` wholesale, and wrangler reads the same
file as a Text module), so shipping the built HTML keeps all three paths
working. Rebuild and commit whenever you change anything under `views/`.

`test/validate.test.js` is built around one lesson written exactly to the
standard, which must produce no errors and no warnings; the other cases mutate
that fixture a rule at a time. Keep it that way: a false positive blocks an
author who did nothing wrong, so the clean-lesson case is the one that matters
most.

## Versions

`apps/mcp/package.json` and `apps/mcp/manifest.json` carry the same version,
and both are bumped whenever the MCP server changes (not for web-only or
core-only work). `SERVER_INFO.version` in `src/tools.js` is what the server
reports to clients during the MCP handshake.
