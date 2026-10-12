#!/usr/bin/env node
// The Spelling Creator command line tool.
//
// Lessons live in files here, not on the hub: a .json lesson file, a Word
// document, or a text file. Each command reads one in (src/lesson.ts), does its
// job, and reports (src/report.ts). The commands are in src/commands/, one
// module each, registered below.
//
// In development this file runs as-is under Node's type stripping (`pnpm
// start`, or `pnpm cli` from the repository root). What ships is dist/cli.js,
// rolldown's bundle of it (rolldown.config.ts), which is what the package's
// `bin` points at.

import { createRequire } from "node:module";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { checkCommand } from "./commands/check.ts";
import { convertCommand } from "./commands/convert.ts";
import { fixCommand } from "./commands/fix.ts";

// Read rather than imported so the bundle doesn't inline the whole manifest,
// and so the path holds from src/ and from dist/ alike.
const { version } = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

await yargs(hideBin(process.argv))
  .scriptName("spelling-creator")
  .usage("$0 <command> [options]")
  .command(checkCommand)
  .command(fixCommand)
  .command(convertCommand)
  .demandCommand(1, "Pick a command.")
  .strict()
  .version(version)
  .help()
  .wrap(Math.min(100, yargs().terminalWidth()))
  .parseAsync();
