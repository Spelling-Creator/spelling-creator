# Spelling Creator

## Overview

This is a React + `shadcn` project for making Spelling lessons.

It also has an MCP server; and its `package.json` and `manifest.json` version should be bumped on changes.

## Verifying in a Browser

If you have it installed, use the Playwright MCP for this. If not, use the Playwright CLI instead (see `playwright-cli --help`).

## Searching the Codebase

Use fast, modern tools instead of the slow defaults:

- [`rg`](https://github.com/BurntSushi/ripgrep) (ripgrep) for text search, not `grep`. It respects `.gitignore` and skips `node_modules` for you.
- [`fd`](https://github.com/sharkdp/fd) for finding files by name, not `find`.
- [`ast-grep`](https://ast-grep.github.io) for structural searches and rewrites, like finding every call to a function or every component that uses a certain prop. Call it as `ast-grep`. The `sg` alias is deprecated, so don't use it.
- `jq` for reading and querying JSON.

If your harness has dedicated search or file tools that already wrap these, those are fine too.

## Code Quality

Always lint and format:

```bash
pnpm run fmt && pnpm run lint
```

Formatting is [oxfmt](https://oxc.rs/docs/guide/usage/formatter.md) (`.oxfmtrc.json`)
and linting is [oxlint](https://oxc.rs/docs/guide/usage/linter.md) (`.oxlintrc.json`).
Both replaced Prettier and ESLint, so there is no `eslint.config.js`,
`.prettierrc` or `.prettierignore` any more.

Don't skip this. If you must, use `pnpm exec` or `pnpm dlx`, not `npx`.

## Docs (IMPORTANT!!!)

Always update the docs if necessary when changing or adding code. If the docs already contain outdated information, expand your scope to cover that info too.

## Outdated packages

PLEASE, PLEASE do not use a package that is old or deprecated. EVEN IF IT IS "INDUSTRY STANDARD" THAT DOES NOT MEAN IT IS GOOD!!! USE THE BEST PACKAGE AND LATEST VERSION LIKE A NORMAL PERSON WOULD!

## Try to avoid spinners

When applicable, try to use `shadcn` skeletons instead of spinners.

## Keep things human

Do no use em dashes or other special symbols not normally found in writing. Do not word things in a weird way. Keep it looking human. If you need to use, for example, an arrow icon, use an SVG instead.

Replacing an em dash with a hyphen is NOT a fix. A spaced hyphen doing an em dash's job ("the limit - 4 bytes", "fast - but wrong") is the same tic with a different character. Reword the sentence instead: use a comma, a colon, parentheses, or the actual word ("minus", "to", "through"). Plain hyphens in compound words and numeric ranges like 0-1 are fine.
