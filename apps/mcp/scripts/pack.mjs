// Build the distributable .mcpb bundle.
//
// `mcpb pack` zips a folder *as-is*, but this package lives in a pnpm workspace
// whose node_modules are symlinks into a shared store — those don't zip into a
// working bundle. So we stage a clean copy of just the runtime files and vendor
// production dependencies with a flat `npm install --omit=dev` (real files, no
// symlinks), then pack that. Output: dist/spelling-creator-hub.mcpb
//
// The workspace sibling `@spelling-creator/core` needs its own handling. npm has
// never understood the `workspace:` protocol and fails the whole install on it,
// and even if it resolved, a `file:` dependency is symlinked — the exact thing
// that doesn't survive the zip. So the modules the server actually imports are
// copied in as real files and the dependency is taken out of the staged manifest
// before npm ever sees it.
//
// Most of core's dependency list (docx, mammoth, supabase, transformers…) is
// for its browser modules and has no business in this bundle, so core's own
// dependencies are not installed. The few packages the copied modules do import
// (yjs, isomorphic-git) have to be in this package's dependencies instead, where
// npm installs them. That is checked below, and the build fails loudly if a
// copied module reaches a package npm won't install: better than shipping a
// bundle that throws MODULE_NOT_FOUND on someone's machine.
//
// Core is TypeScript, and the copies can't stay that way: Node strips types
// only outside node_modules, and the bundle may run on a Node too old to strip
// them at all. So each module is compiled to plain JavaScript on the way in
// (esbuild, one file at a time, nothing bundled), and its imports are pointed at
// the .js files that come out.
//
// Run with: pnpm --filter @spelling-creator/mcp run pack
// (`run` is not optional: pnpm has a built-in `pack` command that would shadow
// this script and produce an npm tarball instead of the .mcpb bundle.)

import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { transformSync } from "esbuild";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const staging = join(pkgRoot, "build", "bundle");
const distDir = join(pkgRoot, "dist");
const outFile = join(distDir, "spelling-creator-hub.mcpb");

const WORKSPACE_PROTOCOL = "workspace:";
const CORE_NAME = "@spelling-creator/core";
const coreRoot = join(pkgRoot, "..", "..", "packages", "core");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

// Only the files the installed server actually needs at runtime.
const INCLUDE = [
  "manifest.json",
  "package.json",
  "README.md",
  "icon.png",
  "src",
];

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

// Every module specifier a file imports, static or dynamic. Deliberately a regex
// rather than a parser: this only ever reads our own source, where imports are
// plain top-of-file statements. It is run over esbuild's output, which has no
// comments left, so an `import x from "y"` inside a comment is not counted.
function importSpecifiers(source) {
  const pattern = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;
  return [...source.matchAll(pattern)].map((m) => m[1]);
}

// A core module as it will run in the bundle: plain JavaScript, with a
// TypeScript module's types stripped. verbatimModuleSyntax matches core's
// tsconfig, so an import is dropped only when it says `import type`, exactly as
// Node would drop it. That is also what keeps a type-only import of a package
// from counting as a dependency below.
function runtimeSource(file) {
  return transformSync(readFileSync(file, "utf8"), {
    loader: file.endsWith(".ts") ? "ts" : "js",
    sourcefile: file,
    tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
  }).code.replace(
    /((?:\bfrom|\bimport)\s*\(?\s*["']\.\.?\/[^"']+)\.ts(["'])/g,
    "$1.js$2",
  );
}

const toJs = (path) => path.replace(/\.ts$/, ".js");

// The package a bare specifier names: "yjs" for "yjs", "@scope/pkg" for
// "@scope/pkg/deep/path.js".
function packageName(spec) {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function jsFilesIn(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".js"))
    .map((e) => join(e.parentPath ?? e.path, e.name));
}

const coreSubpath = (spec) =>
  spec === CORE_NAME || spec.startsWith(`${CORE_NAME}/`)
    ? `.${spec.slice(CORE_NAME.length)}`
    : null;

// Walk out from the core subpaths the server imports, following relative
// imports and core's imports of itself by name, and report every file reached
// plus any package found along the way that npm won't install for this server.
function collectCoreModules() {
  const exportsMap = readJson(join(coreRoot, "package.json")).exports || {};
  const installed = new Set(
    Object.keys(readJson(join(pkgRoot, "package.json")).dependencies || {}),
  );

  const subpaths = new Set();
  const queue = [];
  const enqueueSubpath = (subpath, from) => {
    if (subpaths.has(subpath)) return;
    const target = exportsMap[subpath];
    if (!target) {
      throw new Error(
        `${CORE_NAME} has no "${subpath}" export, but ${from} imports it. ` +
          "Add it to packages/core/package.json's exports map.",
      );
    }
    subpaths.add(subpath);
    queue.push(resolve(coreRoot, target));
  };

  for (const file of jsFilesIn(join(pkgRoot, "src"))) {
    for (const spec of importSpecifiers(runtimeSource(file))) {
      const subpath = coreSubpath(spec);
      if (subpath) enqueueSubpath(subpath, relative(pkgRoot, file));
    }
  }

  const files = new Set();
  const missing = new Map();
  while (queue.length) {
    const file = queue.pop();
    if (files.has(file)) continue;
    files.add(file);
    for (const spec of importSpecifiers(runtimeSource(file))) {
      if (spec.startsWith(".")) {
        // runtimeSource has already pointed a .ts import at .js, so the file
        // on disk may be the .ts one.
        const target = resolve(dirname(file), spec);
        const ts = target.replace(/\.js$/, ".ts");
        queue.push(!existsSync(target) && existsSync(ts) ? ts : target);
      } else if (coreSubpath(spec)) {
        enqueueSubpath(coreSubpath(spec), relative(coreRoot, file));
      } else if (
        !spec.startsWith("node:") &&
        !installed.has(packageName(spec))
      ) {
        missing.set(spec, file);
      }
    }
  }

  if (missing.size) {
    const detail = [...missing]
      .map(([spec, file]) => `  ${spec} (from ${relative(coreRoot, file)})`)
      .join("\n");
    throw new Error(
      `The ${CORE_NAME} modules this server imports reach packages it does not depend on:\n` +
        `${detail}\n\n` +
        "Add them to apps/mcp/package.json's dependencies (at the version core " +
        "asks for) so npm installs them into the bundle.",
    );
  }

  return { files: [...files], subpaths: [...subpaths], exportsMap };
}

// Copy those modules into the staged node_modules as real files, with a manifest
// carrying just the exports the server uses, so `@spelling-creator/core/richText`
// resolves inside the bundle exactly as it does in the workspace.
function vendorCore({ files, subpaths, exportsMap }) {
  const target = join(staging, "node_modules", CORE_NAME);
  for (const file of files) {
    const dest = join(target, toJs(relative(coreRoot, file)));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, runtimeSource(file));
  }

  const source = readJson(join(coreRoot, "package.json"));
  writeJson(join(target, "package.json"), {
    name: source.name,
    version: source.version,
    license: source.license,
    type: source.type,
    exports: Object.fromEntries(subpaths.map((s) => [s, toJs(exportsMap[s])])),
  });

  return files.length;
}

console.log("• Staging a clean copy…");
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
for (const entry of INCLUDE) {
  const from = join(pkgRoot, entry);
  if (!existsSync(from)) {
    if (entry === "icon.png") {
      throw new Error("icon.png missing!");
    }
    continue;
  }
  cpSync(from, join(staging, entry), { recursive: true });
}

// Resolve the workspace side before touching npm, so a broken assumption fails
// the build in a second rather than after a full install.
const core = collectCoreModules();

// npm chokes on `workspace:*`, so the staged manifest doesn't carry it — those
// packages are vendored by hand below instead.
const stagedManifest = join(staging, "package.json");
const manifest = readJson(stagedManifest);
const workspaceDeps = Object.entries(manifest.dependencies || {}).filter(
  ([, range]) => range.startsWith(WORKSPACE_PROTOCOL),
);
for (const [name] of workspaceDeps) delete manifest.dependencies[name];
writeJson(stagedManifest, manifest);

console.log("• Vendoring production dependencies (npm install --omit=dev)…");
// --no-package-lock keeps the staging dir tidy; --omit=dev drops the mcpb CLI
// and other dev-only deps so they don't ship in the bundle.
run(
  "npm",
  ["install", "--omit=dev", "--no-package-lock", "--no-audit", "--no-fund"],
  staging,
);

// After the install: npm prunes anything it doesn't know about from node_modules.
console.log(`• Vendoring ${CORE_NAME} from the workspace…`);
const vendored = vendorCore(core);
console.log(
  `  ${vendored} module(s): ${core.subpaths.map((s) => s.replace("./", "")).join(", ")}`,
);

console.log("• Packing the bundle…");
mkdirSync(distDir, { recursive: true });
// Use the workspace-installed mcpb CLI (falls back to a fetched copy via npx).
const mcpbBin = join(pkgRoot, "node_modules", ".bin", "mcpb");
if (existsSync(mcpbBin)) {
  run(mcpbBin, ["pack", staging, outFile], pkgRoot);
} else {
  run(
    "npx",
    ["--yes", "@anthropic-ai/mcpb", "pack", staging, outFile],
    pkgRoot,
  );
}

console.log(`\n✓ Built ${outFile}`);
console.log(
  "  Install it by opening the file with Claude Desktop, or share it as-is.",
);
