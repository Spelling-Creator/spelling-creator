---
title: Packaging the bundle
---

# Packaging the bundle

For how a user installs the bundle, see
[Connect an AI assistant](../../guide/ai-assistants/connect.md).

The stdio server also ships as an [MCPB bundle](https://github.com/anthropics/mcpb):
a single `.mcpb` file Claude Desktop installs by opening it, with no terminal
and no JSON to edit. The install dialog asks for the user's **Supabase refresh
token** (stored in the OS keychain) and, optionally, the **Hub API URL**; the
account also needs a display name set in the web app, or publishing is rejected.

```bash
pnpm --filter @spelling-creator/mcp validate   # check manifest.json against the MCPB schema
pnpm --filter @spelling-creator/mcp run pack   # build dist/spelling-creator-hub.mcpb
```

`run` is not optional for the second command: pnpm has a built-in `pack` that
would shadow the script and produce an npm tarball instead of the bundle.

`pack` (`scripts/pack.mjs`) stages a clean copy of the runtime files
(`manifest.json`, `package.json`, `README.md`, `icon.png` and `src/`) in
`build/bundle`, and vendors **production** dependencies with a flat
`npm install --omit=dev` before zipping. That's necessary because this is a pnpm
workspace whose `node_modules` are symlinks that wouldn't zip into a working
bundle. The manifest (`manifest.json`) declares the Node entry point
(`src/stdio.js`), the `user_config` fields Claude Desktop collects
(`supabase_refresh_token`, marked `sensitive` so it's kept in the keychain, and
`api_url`), and how they're injected as the `SUPABASE_REFRESH_TOKEN` and
`SPELLING_CREATOR_API_URL` env vars the server already reads (see
[Configuration](./configuration.md)). Bundle artifacts (`build/`, `dist/`,
`*.mcpb`) are gitignored, and `.mcpbignore` is a backstop for packing the folder
directly.

## Getting a refresh token for the install dialog

Run `pnpm --filter @spelling-creator/mcp login` (it prints where the session is
saved; the `refresh_token` is in that file), or copy `refresh_token` from the
web app's `sb-…-auth-token` localStorage entry. The token only seeds the
connection: Supabase rotates it on first use and the server keeps the rotated
one in its session file (see [Configuration](./configuration.md)).

## The workspace dependency

`@spelling-creator/core` needs handling that npm can't provide. npm doesn't
understand the `workspace:` protocol and fails the whole install on it, and a
`file:` dependency would be symlinked, the exact thing that doesn't survive the
zip. So `pack` copies the core modules the server actually imports into the
staged `node_modules` as real files, with a trimmed `package.json` exporting
just those subpaths, and removes the dependency from the staged manifest before
npm sees it.

That only works if those modules are dependency-free, since anything they
import from npm would be missing from the bundle. `pack` doesn't assume that
silently: it walks the imports out from each core subpath the server uses and
**fails the build** if any of them reaches a real package, naming the package
and the file, for example:

```
Vendoring @spelling-creator/core assumes the modules this server imports are
dependency-free, but they now reach real packages:
  yjs (from src/ydoc.js)
```

If that fires, either keep the module dependency-free or add the package to
`apps/mcp/package.json`'s dependencies so npm vendors it into the bundle.

::: warning Currently failing
The server now imports far more of core than when this was written
(`ydoc`, the `git/*` modules, `lessonChecks`, `factCheck` and others), and those
reach `yjs` and `isomorphic-git`. The guard reports any bare import it finds,
even one that is already in `apps/mcp/package.json` (as `yjs` is), and its regex
also picks up a few strings from comments, so `run pack` stops at this check
until the script or the imports change.
:::

## Publishing a release

Releases are cut by hand. There is no CI workflow for this: an
`mcpb-release.yml` existed once and was removed as broken, so the tag-push
trigger some older notes describe does nothing. No bundle has been published as
a GitHub Release yet.

1. Bump the version in **both** `apps/mcp/manifest.json` and
   `apps/mcp/package.json`. They must match (`test/version.test.js` checks);
   the release tag and asset name are derived from the manifest, and the
   version the server reports comes from `package.json`.

2. Validate and build:

   ```bash
   pnpm --filter @spelling-creator/mcp validate
   pnpm --filter @spelling-creator/mcp run pack
   ```

3. Give the asset a versioned, self-describing name:

   ```bash
   version=$(node -p "require('./apps/mcp/manifest.json').version")
   cp apps/mcp/dist/spelling-creator-hub.mcpb \
      "apps/mcp/dist/spelling-creator-hub-$version.mcpb"
   ```

4. Create the GitHub Release and attach it:

   ```bash
   gh release create "mcp-v$version" \
     --title "Spelling Creator Hub MCPB $version" \
     --notes "Install by opening the attached \`.mcpb\` file with Claude Desktop." \
     "apps/mcp/dist/spelling-creator-hub-$version.mcpb"
   ```

Users install the bundle by opening the downloaded `.mcpb` file with Claude
Desktop.
