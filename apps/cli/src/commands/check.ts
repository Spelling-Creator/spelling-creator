// `check`: run the lesson checks over one or more files and report.
//
// The checks are core's validateLesson, the same ones the editor's Check panel
// and the MCP server run, so a lesson that passes here passes there. Nothing
// is written. The exit code is what a script or a CI job keys on.

import type { CommandModule } from "yargs";

import { validateLesson } from "@spelling-creator/core/lessonChecks";

import { LessonReadError, readLesson } from "../lesson.ts";
import {
  exitCodeFor,
  failedReport,
  printReports,
  type FileReport,
} from "../report.ts";

interface CheckArgs {
  files: string[];
  json: boolean;
  strict: boolean;
}

export async function checkFile(file: string): Promise<FileReport> {
  try {
    const { doc, source, notes } = await readLesson(file);
    const { errors, warnings } = validateLesson(doc);
    return { file, source, notes, errors, warnings };
  } catch (err) {
    if (err instanceof LessonReadError) return failedReport(file, err.message);
    throw err;
  }
}

export const checkCommand: CommandModule<object, CheckArgs> = {
  command: "check <files..>",
  describe: "Check lessons against the lesson standard",
  builder: (yargs) =>
    yargs
      .positional("files", {
        describe: "Lesson files: .json, .docx, or text (.txt, .md)",
        type: "string",
        array: true,
        demandOption: true,
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Print the reports as JSON",
      })
      .option("strict", {
        type: "boolean",
        default: false,
        describe: "Treat suggestions as problems for the exit code",
      }),
  handler: async ({ files, json, strict }) => {
    const reports = await Promise.all(files.map(checkFile));
    printReports(reports, json);
    process.exitCode = exitCodeFor(reports, strict);
  },
};
