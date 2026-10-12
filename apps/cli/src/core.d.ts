// Type declarations for the core modules the CLI uses.
//
// @spelling-creator/core is JavaScript with JSDoc and publishes no .d.ts, so
// importing it from TypeScript would make every export `any`. These ambient
// declarations give the handful of modules the CLI calls their real signatures,
// in terms of the document types in types.ts. They cover only what the CLI
// uses; add to them as it grows, and check them against the JSDoc in
// packages/core/src when a signature there changes.

declare module "@spelling-creator/core/lessonChecks" {
  /** One thing the checks found. See the typedef in core's lessonChecks.js. */
  export interface Finding {
    level: "error" | "warning";
    /** Stable machine code, e.g. "E_GROUNDING_SINGLE". */
    code: string;
    /** Identity of the defect, stable across section renumbering. */
    key: string;
    /** 1-based section number, or null for lesson-wide findings. */
    section: number | null;
    sectionId: string | null;
    blockId: string | null;
    itemId: string | null;
    params: Record<string, unknown>;
    /** Prose naming the section, the value and the fix. */
    message: string;
  }

  export function validateLesson(doc: import("./types.ts").LessonDoc): {
    errors: Finding[];
    warnings: Finding[];
  };
}

declare module "@spelling-creator/core/lessonFixes" {
  import type { Finding } from "@spelling-creator/core/lessonChecks";
  import type { LessonDoc } from "./types.ts";

  export function hasQuickFix(finding: { code: string }): boolean;
  /** The doc with the fix made, or null when there is nothing left to do. */
  export function applyQuickFix(
    doc: LessonDoc,
    finding: Finding,
  ): LessonDoc | null;
}

declare module "@spelling-creator/core/documentImport" {
  import type { LessonDoc } from "./types.ts";

  export class DocumentImportError extends Error {}

  /** What the rules made of one section of a typed document. */
  export interface ParsedSection {
    name: string;
    paragraphs: string[];
    spellingWords: string[];
    questions: Array<{ prompt: string; answers: string[]; steps?: string[] }>;
    vakt?: string[];
    /** Lines the rules could not place. */
    unread?: string[];
  }

  export function readLessonText(text: string): {
    title: string;
    /** The rules found no lesson; the sections are only pieces. */
    loose: boolean;
    sections: Array<{
      heading: string;
      lines: string[];
      parsed: ParsedSection;
    }>;
  };
  export function sectionNeedsModel(parsed: ParsedSection): boolean;
  export function lessonFromSections(
    title: string,
    sections: ParsedSection[],
  ): LessonDoc;
}

declare module "@spelling-creator/core/jsonImport" {
  import type { LessonDoc } from "./types.ts";

  export class JsonImportError extends Error {}
  /** Accepts the lesson-file envelope or a bare doc, and normalizes it. */
  export function normalizeLessonFile(parsed: unknown): LessonDoc;
}

declare module "@spelling-creator/core/lessonFile" {
  import type { LessonDoc, LessonFile } from "./types.ts";

  export function buildLessonFile(doc: LessonDoc): LessonFile;
}

declare module "@spelling-creator/core/oslf" {
  import type { LessonDoc } from "./types.ts";

  export const OSLF_VERSION: string;
  export const OSLF_EXTENSION: string;
  export function isOslfFile(parsed: unknown): boolean;
  export function oslfFileName(title?: string): string;
  /** Thrown by toOslf for a lesson the format can't hold as it stands. */
  export class OslfExportError extends Error {}
  /** The lesson as an Open Spelling Lesson Format file. */
  export function toOslf(
    doc: LessonDoc,
    options?: { imageSrc?: (block: unknown) => string | null | undefined },
  ): unknown;
  /** An OSLF file as a bare lesson doc, before normalizing. */
  export function fromOslf(file: unknown): LessonDoc;
}
