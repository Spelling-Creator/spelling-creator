// `convert`: turn a document into a .json lesson file the editor can open.
//
// The reading is the same as `check`'s, so the import notes it prints are the
// same ones. It does not run the checks; `check` the output for that, or run
// `fix` on the document directly, which converts and fixes in one go.

import type { CommandModule } from "yargs";

import {
  defaultOutputPath,
  LessonReadError,
  OutputExistsError,
  readLesson,
  writeLesson,
} from "../lesson.ts";
import {
  exitCodeFor,
  failedReport,
  printReports,
  type FileReport,
} from "../report.ts";

interface ConvertArgs {
  file: string;
  out?: string;
  force: boolean;
  json: boolean;
}

export const convertCommand: CommandModule<object, ConvertArgs> = {
  command: "convert <file>",
  describe: "Turn a .docx or text document into a .json lesson file",
  builder: (yargs) =>
    yargs
      .positional("file", {
        describe: "A document: .docx, or text (.txt, .md)",
        type: "string",
        demandOption: true,
      })
      .option("out", {
        alias: "o",
        type: "string",
        describe:
          "Where to write the lesson file (default: beside the input, as .json)",
      })
      .option("force", {
        type: "boolean",
        default: false,
        describe: "Replace the output file if it already exists",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Print the report as JSON",
      }),
  handler: async ({ file, out, force, json }) => {
    let report: FileReport;
    try {
      const { doc, source, notes } = await readLesson(file);
      const target = out ?? defaultOutputPath(file);
      await writeLesson(target, doc, { force });
      report = { file, source, notes, errors: [], warnings: [], wrote: target };
    } catch (err) {
      if (err instanceof LessonReadError || err instanceof OutputExistsError) {
        report = failedReport(file, err.message);
      } else {
        throw err;
      }
    }
    printReports([report], json);
    process.exitCode = exitCodeFor([report], false);
  },
};
