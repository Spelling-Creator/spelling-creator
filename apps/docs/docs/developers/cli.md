---
title: Command line tool
---

# Command line tool

`apps/cli` is `spelling-creator`, a command line tool for lessons that live in
files. It runs the [lesson checks](./web-app/lesson-checks.md) on a lesson,
makes the quick fixes, and converts a Word document or a text file into a
`.json` lesson file the editor can open. It needs no account and makes no
network requests, which makes it the simplest way for a script, a CI job or an
AI agent to check a lesson without the [MCP server](./mcp-server/overview.md).

Installed from npm it is the `spelling-creator` command:

```sh
npm install -g @spelling-creator/cli
spelling-creator check lesson.json
```

In the repository, `pnpm cli check lesson.json` from the root runs it from
source, with no build.

## Commands

### `check <files..>`

Runs the checks over each file and reports. Nothing is written.

```
domestic-cats.docx: 0 problems, 2 suggestions

Suggestions
  Section 1 (The Wildcat Ancestor) has 7 questions; the usual shape is 15. [W_QUESTION_COUNT]
  ...

Import notes
  Read as a typed document: the question types and answers were worked out from the wording, so check them.
```

Problems are the checks' errors (what would confuse the speller or mark a right
answer wrong) and suggestions are its warnings (the usual shape of a lesson),
the same split as the editor's Check panel. Each line is the prose the check
wrote, which names the section and question, with the finding's code after it.

The exit code is **0** when no file has problems, **1** when one does, and
**2** when a file couldn't be read at all (or, for `fix` and `convert`,
couldn't be written). `--strict` counts suggestions as
problems, for a lesson library that wants the standard shape enforced.

### `fix <file>`

Makes the [quick fixes](./web-app/lesson-checks.md) (the ones that follow from
a finding alone, such as removing bold from a passage or moving a VAKT
activity to the end of its section), writes the lesson back, and reports what
it fixed and what is left. A `.json` lesson is rewritten in place. A document
is converted at the same time and written beside it as `.json`, or wherever
`--out` says; replacing an existing file there, the document itself included,
takes `--force`. `--dry-run` reports without writing. The exit code is `check`'s,
for what remains.

Fixes are made one at a time with the checks rerun in between, since one fix
can change the next finding.

Replacing a file (the in-place rewrite, or anything with `--force`) writes the
new lesson to a temporary file beside it and renames that over the old one, so
a write that fails partway leaves the old file as it was rather than cut off.

### `convert <file>`

Reads a document and writes it as a `.json` lesson file, beside the input or
at `--out`. It never replaces an existing file unless `--force` is passed,
since the document may be the author's only copy. It doesn't run the checks,
so its report says "converted, not checked" rather than counting problems
(and has `"checked": false` in `--json`); `check` the output for those.

### Options every command takes

`--json` prints the report as JSON, one object per file:

```json
[
  {
    "file": "domestic-cats.docx",
    "source": "docx",
    "notes": ["Read as a typed document: ..."],
    "errors": [],
    "warnings": [
      {
        "level": "warning",
        "code": "W_QUESTION_COUNT",
        "message": "...",
        "section": 1,
        "...": "..."
      }
    ],
    "fixed": [],
    "wrote": "domestic-cats.json"
  }
]
```

The findings are core's `Finding` objects exactly as `validateLesson` returns
them, so a script gets the `code`, `section`, `blockId` and `params` the editor
and the MCP server work from. A file that couldn't be read or written has
`error` instead of `source`.

## What it reads

| Extension          | How it is read                                                                                                                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.json`            | The app's own lesson file, through core's `jsonImport`. Lossless, and the envelope or a bare `{ title, sections }` doc are both accepted.                                                                              |
| `.docx`            | The document's text, extracted with mammoth, then read by the rules parser below.                                                                                                                                      |
| `.txt`, `.md`, any | The file as text, read by the rules parser in `packages/core/src/documentImport.js`, the same one behind [Import from text](../guide/import-from-text.md): headings, passages, a spelling line, one question per line. |

A document was never a lesson file, so nothing in it says what a question's
type is: the parser works that out from the answers and the wording. The report
says so in its **Import notes**, and adds a note for every line it couldn't
place and every section where a question may still have its answer glued on,
so a clean check can't hide a misread document. Check those before trusting the
result.

A Word document is read as plain text even when this app exported it. The
styled import that reads question types back from the exporter's character
styles (`packages/core/src/browser/docxImport.js`) needs a DOM and the
browser's image store, so for now it only runs in the editor. The rules read
an exported file well regardless, since its `Spell:` line and answer gaps are
shapes they know; images are the one thing lost.

## Code

```
apps/cli/
  src/cli.ts            yargs setup: registers the commands, help, version
  src/commands/*.ts     one module per command
  src/lesson.ts         readLesson / writeLesson: file in, lesson out, and back
  src/report.ts         FileReport, the prose and JSON output, the exit code
  src/types.ts          the lesson document's shape, for TypeScript
  src/core.d.ts         ambient types for the core modules the CLI calls
  rolldown.config.ts    the build: src/cli.ts and core's modules into dist/cli.js
  test/                 node --test, with the built bin spawned for the commands
```

### TypeScript, and the build

The CLI is the first TypeScript package in the repository. In development it
needs no build: `pnpm start` and the root's `pnpm cli` run `src/cli.ts`
directly, with Node 24 stripping the types as it loads them. That holds the
code to syntax Node can erase (`erasableSyntaxOnly` in `tsconfig.json`: no
enums, namespaces or parameter properties), and imports between its own files
name the `.ts` extension. `pnpm --filter @spelling-creator/cli typecheck` runs
`tsc --noEmit`, which is all tsc does here.

What ships is a bundle. `pnpm build` runs [rolldown](https://rolldown.rs)
with `rolldown.config.ts`, which turns `src/cli.ts` and everything it reaches
into one ESM file, `dist/cli.js`, that the package's `bin` points at.
`@spelling-creator/core` is a workspace package that isn't published to npm,
so the core modules the CLI uses are bundled in; they import nothing from npm
themselves, so the bundle adds no dependencies. The CLI's own dependencies
(yargs, mammoth) and Node's builtins stay external. `pnpm test` builds first
and spawns the bundle, so what is tested is what is published, and
`prepublishOnly` builds again before `pnpm publish`.

Rolldown rather than Vite or tsdown because the job is small and plain: Vite
brings a dev server and an app's conventions, and tsdown adds declaration
output and a library's packaging, neither of which a command line tool uses.

`@spelling-creator/core` is JavaScript with JSDoc and publishes no
declarations, so the CLI carries its own in `src/core.d.ts`: ambient `declare
module` blocks for the few core subpaths it imports, with signatures written
against the document types in `src/types.ts`. That is a stopgap. When a second
TypeScript package needs core, the better move is for core to emit
declarations from its JSDoc (`tsc --allowJs --declaration --emitDeclarationOnly`)
and for both to use those.

## Not yet

This is the first cut. Things it points toward, in rough order:

- An interactive `check` (Ink) for stepping through findings and applying
  quick fixes one by one, and a `--watch` that rechecks a document on save.
- Reading an exported Word document through the styled import, so question
  types and images survive.
- Hub access: `login`, listing and fetching lessons, and `clone` / `pull` /
  `push` against a lesson's [version history](./version-history.md).
- A Markdown lesson format with directives for blocks, for `edit` in
  `$EDITOR`.
