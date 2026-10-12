# @spelling-creator/cli

Check, fix and convert Spelling Creator lessons from the terminal, with no
account and no network. It runs the same lesson checks as the editor's Check
panel and the MCP server, and reads `.json` lesson files, Word documents and
plain text.

```sh
npm install -g @spelling-creator/cli

spelling-creator check lesson.json other.docx    # report, exit 1 on problems
spelling-creator fix lesson.json                 # make the quick fixes in place
spelling-creator convert lesson.docx             # write lesson.json beside it
```

It needs Node 22.12 or newer. In the
[repository](https://github.com/Spelling-Creator/spelling-creator),
`pnpm cli <command>` runs it from source without a build (Node 22.18 or
newer).

Full documentation:
[Command line tool](https://spellingcreator.org/docs/developers/cli) in the
developer docs.
