// What a command tells the user about a file, and how it says it.
//
// Every command builds one FileReport per input file and hands it here, so
// `check`, `fix` and `convert` all read the same way, and `--json` prints the
// same objects a script would want. Findings are printed with the prose core
// wrote for them (`message`), which names the section and question, followed
// by the code in case the reader wants to look it up or filter on it.
//
// Colour comes from node:util's styleText, which already leaves it out when
// stdout isn't a terminal or NO_COLOR is set.

import { styleText } from "node:util";

import type { Finding } from "@spelling-creator/core/lessonChecks";

import type { LessonSource } from "./lesson.ts";

export interface FileReport {
  file: string;
  /** Missing when the file couldn't be read, in which case `error` says why. */
  source?: LessonSource;
  error?: string;
  notes: string[];
  errors: Finding[];
  warnings: Finding[];
  /** The findings `fix` acted on, in the order it made them. */
  fixed?: Finding[];
  /** Where `fix` or `convert` wrote the lesson, if it did. */
  wrote?: string;
}

/** A report for a file that couldn't be read at all. */
export function failedReport(file: string, error: string): FileReport {
  return { file, error, notes: [], errors: [], warnings: [] };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function summary(report: FileReport): string {
  const parts = [];
  if (report.fixed?.length) parts.push(plural(report.fixed.length, "fix"));
  parts.push(plural(report.errors.length, "problem"));
  parts.push(plural(report.warnings.length, "suggestion"));
  return parts.join(", ");
}

function findingLines(findings: Finding[]): string[] {
  return findings.map(
    (f) => `  ${f.message} ${styleText("dim", `[${f.code}]`)}`,
  );
}

/** The report as lines for a terminal. */
export function formatReport(report: FileReport): string {
  const lines: string[] = [];
  if (report.error) {
    lines.push(
      `${styleText("bold", report.file)}: ${styleText("red", report.error)}`,
    );
    return lines.join("\n");
  }

  lines.push(`${styleText("bold", report.file)}: ${summary(report)}`);
  if (report.wrote) lines.push(`  wrote ${report.wrote}`);

  if (report.fixed?.length) {
    lines.push("", styleText("green", "Fixed"), ...findingLines(report.fixed));
  }
  if (report.errors.length) {
    lines.push(
      "",
      styleText("red", "Problems"),
      ...findingLines(report.errors),
    );
  }
  if (report.warnings.length) {
    lines.push(
      "",
      styleText("yellow", "Suggestions"),
      ...findingLines(report.warnings),
    );
  }
  if (report.notes.length) {
    lines.push(
      "",
      styleText("cyan", "Import notes"),
      ...report.notes.map((note) => `  ${note}`),
    );
  }
  return lines.join("\n");
}

/** Print the reports, as prose or as JSON. */
export function printReports(reports: FileReport[], json: boolean): void {
  if (json) {
    console.log(JSON.stringify(reports, null, 2));
    return;
  }
  console.log(reports.map(formatReport).join("\n\n"));
}

/**
 * The process exit code the reports add up to: 2 when a file couldn't be
 * read, 1 when a lesson has problems (or, with `strict`, suggestions), else 0.
 */
export function exitCodeFor(reports: FileReport[], strict: boolean): number {
  if (reports.some((r) => r.error)) return 2;
  const failing = (r: FileReport) =>
    r.errors.length > 0 || (strict && r.warnings.length > 0);
  return reports.some(failing) ? 1 : 0;
}
