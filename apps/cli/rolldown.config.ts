// The published bundle: src/cli.ts and everything it reaches, as one ESM file
// in dist/. @spelling-creator/core is a workspace package that isn't on npm, so
// the modules the CLI uses from it are bundled in, along with what they import
// from npm (@xmldom/xmldom, for OSLF's XML form): those aren't the CLI's own
// dependencies, so nothing would install them. The CLI's own dependencies and
// Node's builtins stay external and are installed alongside the package as
// usual.

import { defineConfig } from "rolldown";

export default defineConfig({
  input: "src/cli.ts",
  platform: "node",
  external: [/^node:/, /^yargs(\/|$)/, /^mammoth(\/|$)/],
  output: {
    dir: "dist",
    format: "esm",
    minify: true,
    entryFileNames: "cli.js",
  },
});
