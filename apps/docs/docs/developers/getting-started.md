---
title: Getting started
---

# Getting started

## Requirements

- **Node.js** 24 or newer. `apps/web` and `apps/docs` declare `>=24`: Vite 8
  and VitePress would run on 20.19 or 22.12, but [portless](#local-urls), which
  serves their dev servers, needs 24. CI and the deploy workflow run Node 26,
  and the Docker image uses Node 24.
- **pnpm**: the root `package.json` pins `"packageManager": "pnpm@12.4.1"`.
  `corepack enable` picks that version up for you.
- **Git LFS**, before you clone (see [below](#git-lfs)).

## Commands

```bash
pnpm install            # install all workspace deps

pnpm dev:web            # run the frontend (Vite)
pnpm dev:api            # build the web app, then run the Worker locally (wrangler dev)
pnpm dev:mcp            # run the MCP server over stdio
pnpm dev:docs           # run this documentation site (VitePress)
pnpm mcp:login          # sign the MCP server in and store a refresh token

pnpm dev:stub           # run the stub API instead of a real backend
pnpm dev:web:stub       # run the frontend against it

pnpm build              # build the frontend: apps/web/dist and apps/web/dist-ssr
pnpm build:docs         # build the whole site: the frontend, then the docs into apps/web/dist/docs
pnpm preview            # serve the built frontend (vite preview)
pnpm run deploy         # rebuild the whole site from scratch, then deploy the Worker (wrangler deploy)

pnpm test               # every workspace's test suite
pnpm fmt                # format everything (oxfmt)
pnpm lint               # check formatting, then lint (oxfmt --check + oxlint)
```

`deploy` needs `pnpm run`: a bare `pnpm deploy` is pnpm's own built-in command
for copying a workspace package to a directory, not this script.

### Local URLs

The dev and preview servers run through
[portless](https://github.com/vercel-labs/portless), so each one has a fixed
`https://*.localhost` name instead of a port number:

| Command                                        | URL                                                     |
| ---------------------------------------------- | ------------------------------------------------------- |
| `pnpm dev:web`                                 | `https://spelling-creator.localhost`                    |
| `pnpm dev:api`                                 | `https://api.spelling-creator.localhost`                |
| `pnpm dev:docs`                                | `https://docs.spelling-creator.localhost/docs/`         |
| `pnpm dev:stub`                                | `https://api.stub.spelling-creator.localhost`           |
| `pnpm dev:web:stub`                            | `https://stub.spelling-creator.localhost`               |
| `pnpm preview`                                 | `https://preview.spelling-creator.localhost`            |
| `pnpm --filter @spelling-creator/docs preview` | `https://preview.docs.spelling-creator.localhost/docs/` |

portless is a root dev dependency, so `pnpm install` brings it. The first
server you start also starts its proxy on port 443 and creates a local
certificate authority for the HTTPS, which asks for your password once to
trust it and bind the port. After that, `portless list` shows what is running
and `portless doctor` checks the setup.

Each server is given a free port in the `PORT` variable. portless adds the
matching `--port` and `--host` to Vite by itself; VitePress doesn't read
`PORT`, so its scripts pass it on in a small `sh -c`. In a git worktree, every
name gets the branch as a prefix (for example
`https://my-branch.spelling-creator.localhost`), so two checkouts can run at
once. A server that needs another's address asks `portless get <name>`, which
applies the same prefix. The stub API and the stub-mode app find each other
that way, through `scripts/portless.mjs`.

wrangler doesn't read `PORT` either, and runs through `apps/api/scripts/dev.sh`,
which also sorts out two things the proxy would otherwise get in the way of:

- The proxy talks plain http to wrangler, so the Worker would build `http://`
  links from its request URLs (the OAuth metadata among them). The script has
  wrangler rewrite them to the address portless serves it on.
- The Worker only answers cross-origin requests from `ALLOWED_HOSTNAMES`, which
  `wrangler.jsonc` sets to the production hostname. The script lets in
  `pnpm dev:web`'s hostname instead, so the dev app can use the local API: set
  `VITE_API_URL=https://api.spelling-creator.localhost` in `apps/web/.env`.

`PORTLESS=0` in front of a command skips portless and runs the server on its
usual port: Vite on 5173 (5180 in stub mode), wrangler and the stub on 8787,
the docs on 5173 (4173 for the preview).

Two things are tied to the address the app runs on, and so changed when these
URLs did:

- **What the browser keeps.** Local lessons, their histories and your settings
  live in the browser under the page's origin, and the old
  `http://localhost:5173` is a different origin. To bring a lesson over, open
  the old address with `PORTLESS=0 pnpm dev:web`, use **Export JSON**, then
  **Import JSON or OSLF** at the new one.
- **Sign-in redirects.** Magic links and the MCP server's OAuth sign-in send
  you back to the page's own origin, and Supabase only redirects to addresses
  on the project's list (**Authentication**, **URL Configuration**,
  **Redirect URLs**). Add `https://spelling-creator.localhost/**`, and
  `https://*.spelling-creator.localhost/**` for worktrees and the other
  servers, to the Supabase project you develop against.

### Turborepo

The build, test, deploy and `dev:api` scripts run their tasks through
[Turborepo](https://turborepo.dev), configured in `turbo.json` at the root.
It does two things for us:

- **It runs tasks in the right order.** The Worker imports the web app's SSR
  bundle and serves `apps/web/dist` as its assets, so the API's `test` and
  `bundle` tasks depend on the web build. The docs are copied into
  `apps/web/dist/docs` only after the web build, because Vite empties `dist`
  each time. Each package's scripts do one thing, and `turbo.json` holds the
  order between them.
- **It skips work that is already done.** A task whose inputs have not changed
  since its last run is replayed from `.turbo/cache` (gitignored): its log is
  printed again and its outputs are put back, in milliseconds. Run with
  `--force` to ignore the cache, for example
  `pnpm exec turbo run test --force`.

Most workspaces run from source and have no build of their own, so `turbo.json`
has a `transit` task with no script anywhere. Tasks depend on it so that a
change to a workspace dependency (usually `packages/core`) counts as a change
to them too. Without it, editing `packages/core` would leave the web build and
the API tests cached.

The web build tasks list the `VITE_*` variables and `apps/web/.env*` as inputs,
because Vite bakes them into the bundle. A build with different values is a
different build, not a cache hit.

A script run straight from a package (`pnpm --filter @spelling-creator/api test`,
or `pnpm test` inside `apps/api` or `apps/cli`) does not build what it depends
on first. Use the root scripts, or `pnpm exec turbo run <task>`, from a clean
checkout.

`wrangler dev` and `wrangler deploy` are not Turborepo tasks. Turborepo runs a
task without a terminal to prompt in, and wrangler can need one: to log you in,
or to ask which Cloudflare account to use. So `pnpm dev:api` and
`pnpm run deploy` build through Turborepo first, then run wrangler in your
terminal as usual.

A cache hit puts a task's outputs back over whatever is already there, without
emptying the folder first the way Vite does. After switching branches,
`apps/web/dist` can hold leftover files from another build. That does no harm
locally, but it must never ship, so `pnpm run deploy` builds with `--force`.

Turborepo hashes a Git LFS file by its pointer, so a checkout with pointers
and one with the real images look the same to it. That is the other reason
`pnpm run deploy` ignores the cache, and why the deploy workflow restores none
(see [Continuous integration](#continuous-integration)). If you ever build
without the LFS files pulled, run `pnpm build --force` after `git lfs pull` so
the cached build with broken images is replaced.

The two stub commands give you a working hub with no Supabase or Cloudflare
account; see [Stub API](./stub-api.md). To run the API as a plain Node process
instead of under wrangler, see [Self-hosting](./self-hosting.md)
(`pnpm --filter @spelling-creator/api start:node`).

### Git LFS

Images and videos (PNG, JPEG, GIF, WebP, AVIF, ICO, MP4, MOV, WebM, M4V) are
stored in [Git LFS](https://git-lfs.com), as set out in `.gitattributes`. SVGs
stay plain text. Install Git LFS before cloning, once per machine:

```bash
brew install git-lfs    # or your platform's package
git lfs install
```

A clone made without it has small text pointers where the images should be.
`git lfs pull` fetches the real files afterwards. The Docker build refuses to
run on pointers rather than ship broken images, and in CI only the deploy
workflow pulls the files, through a cache, since nothing else needs them.

### Environment files

Each app keeps its own environment file. All `.env` and `.env.*` files are
gitignored except the `.env.example` files and `apps/web/.env.stub`.

- `apps/web/.env`: `VITE_*` values that Vite substitutes into the client bundle
  at build time, read in `apps/web/src/main.jsx`: `VITE_API_URL`,
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY`,
  `VITE_AI_CHALLENGE`, `VITE_GOOGLE_CLIENT_ID`, `VITE_AUTH_MODE` and
  `VITE_USERNAME_DOMAIN`. The
  [web app's getting started page](./web-app/getting-started.md) explains each
  one. A self-hosted Node server supplies the same settings at runtime instead,
  and those win; see
  [How the browser gets its settings](./self-hosting.md#how-the-browser-gets-its-settings).
- `apps/web/.env.stub`: committed, because it holds nothing but local URLs. It
  points the app at the stub API for `pnpm dev:web:stub`, including the stub's
  stand-in Turnstile widget (`VITE_TURNSTILE_SCRIPT_URL`). Its URLs are the
  stub's `PORTLESS=0` address; under portless, `vite.config.js` swaps in the
  stub's portless URL.
- `apps/api/.env`: Worker secrets for `wrangler dev`, such as
  `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET_KEY`, `ALTCHA_HMAC_KEY`,
  `PIXABAY_API_KEY`, `ADMIN_MIGRATE_TOKEN` and the AI provider keys below. Plain
  settings (`ALLOWED_HOSTNAMES`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SPELLING_CREATOR_API_URL`) are `vars` in `apps/api/wrangler.jsonc`, and
  `AI_CHALLENGE` can be added there too (it defaults to `turnstile`; see
  [Self-hosting](./self-hosting.md#ai)).
- `apps/mcp/.env`: optional, copied from `apps/mcp/.env.example`. Most people
  set these in their MCP client's config instead; see
  [MCP server configuration](./mcp-server/configuration.md).
- `.env` at the root: only for the Docker Compose stack, generated from the
  root `.env.example` by `scripts/generate-env.sh` (which the image also carries
  as `generate-env`). See [Self-hosting](./self-hosting.md).

### AI providers

`generateWithFallback` (`apps/api/src/lib/ai/index.js`) tries each provider in
order, skipping any that isn't configured, and within a provider tries its models
in order. The default order is
`gemini, openai, anthropic, groq, novita, fireworks, openrouter, openai-compatible, workers-ai`.

`AI_PROVIDER_ORDER` replaces that list with your own comma-separated one. It is
a replacement, not a reordering: a provider you leave out is never tried, and an
unknown name is ignored.

The last two go last by default because neither needs a hosted API key, which
makes them fallbacks rather than competitors for priority with the better models.
Cloudflare Workers AI needs no key at all: it is wired up through the `AI`
binding in `wrangler.jsonc` and counts as configured whenever that binding
exists, so on the hosted instance it is the fallback if every other provider is
unset or fails.

Every provider takes an optional comma-separated model list that overrides its
built-in defaults, tried in order:

| Provider     | Key                  | Model list          | Default models                                                                      |
| ------------ | -------------------- | ------------------- | ----------------------------------------------------------------------------------- |
| `gemini`     | `GEMINI_API_KEY`     | `GEMINI_MODELS`     | `gemini-3.5-flash`, `gemini-3-flash`, `gemini-2.5-flash`                            |
| `openai`     | `OPENAI_API_KEY`     | `OPENAI_MODELS`     | `gpt-5.4-mini`, `gpt-5-mini`                                                        |
| `anthropic`  | `ANTHROPIC_API_KEY`  | `ANTHROPIC_MODELS`  | `claude-haiku-4-5-20251001`, `claude-sonnet-5`                                      |
| `groq`       | `GROQ_API_KEY`       | `GROQ_MODELS`       | `openai/gpt-oss-20b`, `openai/gpt-oss-120b`                                         |
| `novita`     | `NOVITA_API_KEY`     | `NOVITA_MODELS`     | `openai/gpt-oss-20b`, `openai/gpt-oss-120b`                                         |
| `fireworks`  | `FIREWORKS_API_KEY`  | `FIREWORKS_MODELS`  | `accounts/fireworks/models/gpt-oss-120b`, `accounts/fireworks/models/glm-5p3-flash` |
| `openrouter` | `OPENROUTER_API_KEY` | `OPENROUTER_MODELS` | `openai/gpt-oss-20b`, `openai/gpt-oss-120b`                                         |
| `workers-ai` | (the `AI` binding)   | `WORKERS_AI_MODELS` | `@cf/meta/llama-3.2-3b-instruct`, `@cf/openai/gpt-oss-20b`                          |

**`groq`**, **`novita`**, **`fireworks`** and **`openrouter`** are hosted
gateways that speak the OpenAI chat-completions shape, so each is a thin wrapper
over the same shared call (`providers/chatCompletions.js`).

Fireworks names models by their full `accounts/fireworks/models/...` path, and
only serves `gpt-oss-120b` serverless (the 20b needs a dedicated deployment),
which is why its defaults differ. The catalogs are at
[novita.ai/models/llm](https://novita.ai/models/llm),
[fireworks.ai/models](https://fireworks.ai/models) and
[openrouter.ai/models](https://openrouter.ai/models).

**`openai-compatible`** is the one an instance with no hosted keys and no
Cloudflare bindings can use. Ollama, llama.cpp's server, vLLM, LM Studio, LiteLLM
and most hosted gateways all expose the OpenAI chat-completions shape, so one
provider covers all of them, including a model running on the same machine as
the app. It has no default models, so it counts as configured only when both
required variables are set.

| Variable                    | Required | Meaning                                                  |
| --------------------------- | -------- | -------------------------------------------------------- |
| `OPENAI_COMPATIBLE_URL`     | yes      | Base URL, e.g. `http://ollama:11434/v1`. `/v1` optional. |
| `OPENAI_COMPATIBLE_MODELS`  | yes      | Comma-separated, tried in order.                         |
| `OPENAI_COMPATIBLE_API_KEY` | no       | Most local runtimes want no auth.                        |
| `OPENAI_COMPATIBLE_JSON`    | no       | `schema` if the server enforces JSON Schema.             |

Structured output defaults to the weaker `json_object` mode, with the shape
described in the prompt, the same thing the hosted gateway providers do, and
for the same reason: whether a server honors `json_schema` depends on which
runtime or model it is, and a wrong guess fails every question suggestion with a 400. Set `OPENAI_COMPATIBLE_JSON=schema` if you know yours enforces schemas.

A self-hosted instance that would rather use its local model _first_ (for
privacy, or because it has no hosted keys worth spending) puts it at the front of
`AI_PROVIDER_ORDER`, for example `openai-compatible,gemini`. Setting it to
`openai-compatible` alone means the local model is the only one ever asked.

## Documentation site

This site is [VitePress](https://vitepress.dev). Pages are plain Markdown under
`apps/docs/docs`, and the config is `apps/docs/docs/.vitepress/config.mts`. The
`.mts` extension matters, because `apps/docs/package.json` has no
`"type": "module"` and VitePress is ESM-only. The pages are split into a user
guide (`guide/`) and this developers section (`developers/`).

The dependency tracks the **2.0 alpha on purpose**: `vitepress@latest` is still
1.6.4 from August 2025, and it would drag in a second Vite major (5) alongside
the Vite 8 that `apps/web` builds on, where the 2.0 alpha shares the same Vite 8
install. The range is `^2.0.0-alpha.20`, so the lockfile decides the exact
version (today `2.0.0-alpha.20`), and a lockfile refresh can move it to a later
alpha or to 2.x once that ships. See
[Frontend migration](./frontend-migration.md) for the full reasoning.

- **The sidebar is explicit.** A new page does not appear until it is listed in
  `themeConfig.sidebar`. That order is also the order of the sections in
  `llms.txt`.
- **Links between pages are relative and keep their `.md` extension**
  (`./stub-api.md`), which is what lets VitePress rewrite them and fail the build
  on a dead one.
- **Moved pages keep working.** `REDIRECTS` in the config maps an old path to
  its new one, and the build writes a small forwarding page at each old URL.
  Add an entry whenever you move or rename a page.
- **`base` is `/docs/`** and the output goes to `apps/docs/doc_build`. The
  package's `copy-to-web` script then copies it into `apps/web/dist/docs`, which
  has to happen **after** the web build because Vite empties `apps/web/dist`
  each time. `pnpm build:docs` runs both halves of the web build, the docs build
  and the copy in that order through [Turborepo](#turborepo), and so do `pnpm run deploy`
  and the deploy workflow. A `pnpm build` on its own afterwards can still
  delete the docs again, so run `pnpm build:docs` last. `cleanUrls` is on, and
  Cloudflare's default `auto-trailing-slash` asset handling resolves
  `/docs/intro` to `intro.html`.
- **`llms.txt` and `llms-full.txt`** come from
  [`vitepress-plugin-llms`](https://github.com/okineadev/vitepress-plugin-llms),
  which also emits a Markdown twin of every page next to its HTML.
- **`/docs/sitemap.xml`** is VitePress's built-in sitemap, with `<lastmod>` taken
  from git. A build with no git history (inside a container, or from a source
  tarball) leaves the timestamps out rather than failing. The sitemap is separate
  from the Worker's dynamic `/sitemap.xml` (which covers the app's own pages and
  every published lesson); `robots.txt` advertises both.
- **Demo videos** are embedded with the `<DemoVideo>` component from
  `.vitepress/theme/`, and the video files live in `apps/docs/docs/public/` under
  Git LFS.
- **Diagrams are draw.io, not ASCII art.** Each one is a single
  `apps/docs/docs/diagrams/*.drawio.svg`: an SVG the page shows with a normal
  Markdown image, with the editable diagram embedded in it. Open one in
  [draw.io](https://www.drawio.com) or the
  [Draw.io Integration](https://marketplace.visualstudio.com/items?itemName=hediet.vscode-drawio)
  extension for VS Code, edit it, then run `pnpm --filter @spelling-creator/docs diagrams`
  (it needs the draw.io desktop app) to export it again like the rest. That
  strips the PNG copies draw.io adds of every label, which are most of the file
  and stay light in dark mode. Colors are `light-dark()` pairs taken from the
  VitePress theme, so a diagram follows the site's light and dark switch; reuse
  the styles of an existing diagram for a new one. Write alt text that says what
  the diagram shows, since it's also what `llms.txt` and screen readers get.

## Code quality

The repo uses the [Oxc](https://oxc.rs) toolchain: `oxfmt` for formatting and
`oxlint` for linting. They replaced Prettier and ESLint, so `eslint.config.js`,
`.prettierrc` and `.prettierignore` no longer exist. Run both before you commit:

```bash
pnpm run fmt && pnpm run lint
```

- **`.oxfmtrc.json`** (root): `printWidth` is pinned to `80` (Prettier's
  default, and what the existing code is wrapped to; oxfmt's own default is
  `100`), plus the ignore list that used to live in `.prettierignore`. It's the
  only one: every package, the API included, shares the same style.
- **`.editorconfig`** (root): the same settings for your editor, so it writes
  what `pnpm fmt` would (2 spaces, 80 columns). Shell scripts use tabs because
  their heredocs use `<<-`, which only strips leading tabs.
- **`.git-blame-ignore-revs`** (root): commits that only reformat code, so
  `git blame` skips them. GitHub reads it on its own; locally, run
  `git config blame.ignoreRevsFile .git-blame-ignore-revs` once per clone. Add
  a commit's full hash here whenever it does nothing but run `pnpm fmt`.
- **`.oxlintrc.json`** (root): the `eslint` and `react` plugins with the
  `correctness` category as errors, mirroring the old flat config's
  `js/recommended` + `eslint-plugin-react` + `eslint-plugin-react-hooks` setup.
  Per-path `overrides` supply the right globals for each runtime:
  - browser for `apps/web`, the MCP server's `views/` (which run in the host's
    iframe), and the docs theme's `.vue` files (plus `defineProps`);
  - worker + Node for `apps/api`, plus `WebSocketPair` and
    `WebSocketRequestResponsePair`, the Durable Objects' globals;
  - Node for `apps/mcp`, `apps/stub-api`, the repo's own scripts, and the
    TypeScript sources of `apps/cli`;
  - `worker` for `packages/core`, the narrowest environment, so that anything
    reaching for a browser-only global there fails the lint rather than breaking
    at runtime inside the Worker. Its tests may also use Node globals, and the
    modules that legitimately need the DOM are grouped under `src/browser/`,
    which is the only path opted back into `browser`. Core's type check makes
    the same split (see [Type checking](#type-checking)).

`eslint/no-undef` is enabled explicitly: it's part of ESLint's `js/recommended`
but not of oxlint's `correctness` category, and it's what makes those `globals`
and `env` blocks do anything. `eslint/no-unused-vars` is an error too, with names
starting `_` exempt.

Oxlint enables its `unicorn`, `oxc` and `typescript` plugins by default; the
config lists `plugins` explicitly to keep them off, so the rule set stays the one
this codebase was written against.

In `apps/web`, `react-hooks/rules-of-hooks` is an error and
`react-hooks/exhaustive-deps` is a warning, and `pnpm lint` does not pass
`--deny-warnings`, matching the previous ESLint behavior of not failing CI on it.
`react/set-state-in-effect` is switched off, as its ESLint counterpart was:
resetting local state when a dialog opens or a route param changes is a
deliberate pattern in this app. `react/prop-types` isn't implemented by oxlint, so
there is nothing to disable there.

## Type checking

`packages/core` and `apps/cli` are TypeScript, and neither has a compile step in
development. Vite, wrangler and vitest compile their `.ts` files themselves, and
Node runs them directly by stripping the types. None of those read the types, so
the check is a separate command:

```bash
pnpm typecheck      # turbo run typecheck: core and the CLI
```

Both use TypeScript 7 with `erasableSyntaxOnly`, so the source holds to what Node
can strip (no enums, namespaces or parameter properties), and relative imports
name the `.ts` file.

Core runs in three places, so `packages/core/tsconfig.json` points at three
projects, which `tsc -b` checks together:

- **`tsconfig.shared.json`**: everything outside `src/browser/`, with the
  `webworker` lib and no DOM, because the Worker and the MCP server import it
  too. A module there that uses `document` fails the check the way it fails the
  lint.
- **`tsconfig.browser.json`**: the `src/browser/` tier, with the DOM. Only Vite
  loads it, so its imports resolve the way Vite's do.
- **`tsconfig.test.json`**: the tests, with Node's types as well, since vitest
  runs them on Node.

An editor opens each file in the first of those projects that lists it, so a
shared module is held to the no-DOM rule there too.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on `main` after a
merge (and by hand through `workflow_dispatch`): install (with
`--frozen-lockfile`), `pnpm lint`, then one
`turbo run typecheck test build build:ssr bundle`. That covers the type checks,
every test suite, the web, docs and CLI builds, and the Worker's `bundle`, which
bundles it with
`wrangler deploy --dry-run`. The bundle is the only step that runs wrangler's
own module resolution, so it catches an import that bundles under Vite but not
for workerd. CI checks out Git LFS files as pointers, since no test reads them.

CI keeps the Turborepo cache between runs with `actions/cache`, saved under each
commit and restored from the newest earlier one, so a pull request that only
touches the docs replays every test suite instead of running it. Pull requests
can read the caches that runs on `main` saved. Two details keep that honest:

- **The cache key includes the Node version and a hash of `ci.yml`.** Turborepo
  does not hash the runtime, so without this a pull request that bumps Node or
  pnpm would replay the old passes without running a single suite on the new
  version.
- **Turborepo never evicts anything from its cache.** The run uses
  `--summarize`, and `scripts/prune-turbo-cache.mjs` then deletes every entry
  that run did not use before the cache is saved. Otherwise each commit's
  saved cache would be bigger than the last.

`apps/api`'s own suite runs **twice, in two runtimes**, because the API is meant
to run in two. The `workers` project runs everything inside workerd: the hosted
instance's runtime, and the only place the Durable Objects and the R2/KV adapters
can be exercised for real. The `node` project runs the portable subset under Node,
which is what a self-hosted instance runs on. Most files are in both, and that
overlap is the point: a module that behaves differently across the two is a
self-hosting bug, and the cheapest moment to find one is when it is introduced.
The configs are `apps/api/vitest.workers.config.js` and
`apps/api/vitest.node.config.js`.

`pnpm test` is `turbo run test`, which runs each workspace's own suite:
`packages/core` and `apps/api` under vitest (the API's workerd project through
`@cloudflare/vitest-plugin`, so its platform-adapter tests run against real
R2 and KV), `apps/web` and `apps/stub-api` under vitest too, and `apps/mcp`
and `apps/cli` under `node --test` (the CLI's tests are TypeScript, which Node
runs directly). `apps/docs` has no test script and is skipped.

`apps/web`'s tests run in Node by default. One that needs a DOM (to mount a hook
in a real React root, say) opts in with a `// @vitest-environment happy-dom`
comment on its first line; `src/lib/collab.test.js` is an example, driving the
live-collaboration hook against a stub WebSocket.

`apps/api`'s `test` task depends on `apps/web`'s `build:ssr` in `turbo.json`, as
its `bundle` task does, and `pnpm dev:api` and `pnpm run deploy` build it before
starting wrangler. That is not incidental:
`routes/ssr.js` imports the built bundle _statically_, deliberately, so that a
missing one is a build failure rather than a runtime surprise, and the Node
entry's tests reach it through `createHandler`. The dependency is what lets
`pnpm test` work from a clean checkout.

The CI build runs without the `VITE_*` secrets: they are injected only for the
real deploy, and a pull request from a fork could not read them anyway. It still
resolves every import and runs the full bundler, which is what catches a bad
module path or a broken chunk boundary.

`.github/workflows/deploy.yml` is separate and triggers only on a push to `main`
that touches the web app, the API, the MCP server, the docs, the lockfile, the
workspace config or `turbo.json` (or by hand). It runs in two jobs: `build`
pulls the Git LFS files, lints and builds, and hands `apps/web/dist` and
`apps/web/dist-ssr` on as an artifact; `deploy` is the only job that can read
the Cloudflare token, and runs `wrangler deploy`. By then the change has already
been merged; CI is what gates the merge.

The deploy workflow restores no Turborepo cache, on purpose. CI's cache was
built from LFS pointers, and Turborepo cannot tell those apart from the real
files (see [Turborepo](#turborepo)), so reusing it could ship a build with
broken images.

## Dependency updates

`.github/dependabot.yml` runs Dependabot every Monday against two ecosystems:

- **npm**: a single root entry covers all workspace packages, since Dependabot
  resolves pnpm workspaces from the root `pnpm-lock.yaml`.
- **github-actions**: the actions used by `.github/workflows/`, all grouped into
  one PR.

For npm, minor and patch bumps are grouped (dev tooling, React, Radix UI,
Cloudflare, then everything else split by production/development) so a routine
week lands as a handful of PRs; majors open individually because they need
review. Security updates are grouped into one PR of their own.

`@cfworker/json-schema`, `@modelcontextprotocol/client` and
`@modelcontextprotocol/server` are ignored: all three are patched via
`patchedDependencies` in `pnpm-workspace.yaml` (the latter two inline their own
copy of the first), so bumping any of them requires regenerating the matching
`patches/*.patch` by hand. See the note on the `agents` dependency in
[Remote mode](./mcp-server/remote-mode.md) for why the patches exist and how to
verify a regenerated one.

### Security overrides

Most Dependabot security alerts here name a package nobody depends on directly:
`undici` inside miniflare, `qs` inside the express that the MCP SDK pulls in,
`tmp` under `external-editor`. Dependabot cannot open a PR for those, because the
fix is not a range this repo controls.

`overrides` in `pnpm-workspace.yaml` is where they get pinned forward. Every
entry there is a transitive dependency held on a vulnerable version by a parent's
range, and each one is annotated with the advisory it answers and the path it
arrives by. Keep two rules when adding one:

- **Stay inside the parent's major**, or find evidence the parent already works
  with the newer version; the `sharp` and `esbuild` entries are justified by
  current Cloudflare tooling shipping exactly those versions.
- **Delete the entry once it is redundant.** An override outlives its advisory
  and then silently holds a package _back_. After a dependency bump, drop the
  entry, run `pnpm install`, and check whether the tree resolves to something
  already fixed.

Write them as ranges, not exact versions. An override is a floor ("no older
than the fixed version"), and `pnpm-lock.yaml` is what pins the exact one that
gets installed, so a re-resolution shows up as a lockfile diff to review rather
than something happening behind your back. Pinning in `overrides` instead would
freeze each package on a version that can pick up an advisory of its own later,
and it overrides direct dependants _downwards_ too: `apps/mcp` asks for esbuild
`^0.28.2`, so an exact `0.28.1` here would drag it below its own declared range.

`pnpm test`, `pnpm build` and the Worker's `bundle` task between them exercise every package the overrides touch, so an override that
breaks its parent fails locally rather than in a deploy.

`allowBuilds` in the same file lists which dependencies may run install scripts.
Anything not listed is not allowed to, and a few (such as `onnxruntime-node`,
whose native binaries the app never uses) are switched off explicitly.
