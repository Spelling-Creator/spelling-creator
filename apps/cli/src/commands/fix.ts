// `fix`: make the quick fixes and write the lesson back.
//
// Only core's quick fixes (lessonFixes.js) are made: the ones that follow from
// the finding alone, with no judgement, such as taking bold off a passage or
// moving a VAKT activity to the end of its section. Everything else is left
// for the report, the same as `check` would show it.
//
// Fixes are made one at a time, re-running the checks between them, because a
// fix can change what the next finding would be (a block moves, a span loses
// its marks). A finding whose fix turns out to have nothing to do is set aside
// so the loop cannot spin on it.

import { resolve } from "node:path";

import type { CommandModule } from "yargs";

import {
  validateLesson,
  type Finding,
} from "@spelling-creator/core/lessonChecks";
import { applyQuickFix, hasQuickFix } from "@spelling-creator/core/lessonFixes";

import {
  defaultOutputPath,
  LessonReadError,
  LessonWriteError,
  readLesson,
  writeLesson,
} from "../lesson.ts";
import {
  exitCodeFor,
  failedReport,
  printReports,
  type FileReport,
} from "../report.ts";
import type { LessonDoc } from "../types.ts";

interface FixArgs {
  file: string;
  out?: string;
  force: boolean;
  "dry-run": boolean;
  json: boolean;
  strict: boolean;
}

// A ceiling on passes, well above what a lesson can need: each pass makes one
// fix or sets one finding aside, and both are bounded by the findings.
const MAX_PASSES = 200;

/**
 * The lesson with every quick fix made, the findings that were fixed, and what
 * the checks still find in the fixed lesson.
 */
export function fixLesson(doc: LessonDoc): {
  doc: LessonDoc;
  fixed: Finding[];
  errors: Finding[];
  warnings: Finding[];
} {
  const fixed: Finding[] = [];
  const skipped = new Set<string>();
  let current = doc;
  let checks = validateLesson(current);
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const finding = [...checks.errors, ...checks.warnings].find(
      (f) => hasQuickFix(f) && !skipped.has(f.key),
    );
    if (!finding) break;
    const next = applyQuickFix(current, finding);
    if (next) {
      current = next;
      fixed.push(finding);
      checks = validateLesson(current);
    } else {
      skipped.add(finding.key);
    }
  }
  return { doc: current, fixed, ...checks };
}

export const fixCommand: CommandModule<object, FixArgs> = {
  command: "fix <file>",
  describe: "Make the quick fixes and write the lesson back",
  builder: (yargs) =>
    yargs
      .positional("file", {
        describe: "A lesson file: .json, .docx, or text (.txt, .md)",
        type: "string",
        demandOption: true,
      })
      .option("out", {
        alias: "o",
        type: "string",
        describe:
          "Where to write the fixed lesson. A .json input is rewritten in place; anything else goes beside it as .json",
      })
      .option("force", {
        type: "boolean",
        default: false,
        describe: "Replace the output file if it already exists",
      })
      .option("dry-run", {
        type: "boolean",
        default: false,
        describe: "Report what would be fixed without writing anything",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Print the report as JSON",
      })
      .option("strict", {
        type: "boolean",
        default: false,
        describe: "Treat remaining suggestions as problems for the exit code",
      }),
  handler: async ({ file, out, force, "dry-run": dryRun, json, strict }) => {
    let report: FileReport;
    try {
      const { doc, source, notes } = await readLesson(file);
      const { doc: fixedDoc, fixed, errors, warnings } = fixLesson(doc);
      report = { file, source, notes, errors, warnings, fixed };
      if (!dryRun) {
        // Rewriting the file that was read is the point of `fix` on a .json
        // lesson, so that case needs no --force; a different output does, and
        // so does writing a lesson file over the document it came from.
        const target =
          out ?? (source === "json" ? file : defaultOutputPath(file));
        const inPlace = source === "json" && resolve(target) === resolve(file);
        await writeLesson(target, fixedDoc, { force: force || inPlace });
        report.wrote = target;
      }
    } catch (err) {
      if (err instanceof LessonReadError || err instanceof LessonWriteError) {
        report = failedReport(file, err.message);
      } else {
        throw err;
      }
    }
    printReports([report], json);
    process.exitCode = exitCodeFor([report], strict);
  },
};
