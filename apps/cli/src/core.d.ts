// Type declarations for the core modules the CLI uses.
//
// Most of @spelling-creator/core is still JavaScript, so importing one of its
// modules from TypeScript would make every export `any`. These ambient
// declarations give the handful of modules the CLI calls their real signatures,
// in terms of core's document types (@spelling-creator/core/types). They cover
// only what the CLI uses. A module's block goes once core has ported that
// module to TypeScript and its own types take over.

declare module "@spelling-creator/core/documentImport" {
  import type { LessonDoc } from "@spelling-creator/core/types";

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
  import type { LessonDoc } from "@spelling-creator/core/types";

  export class JsonImportError extends Error {}
  /** Accepts the lesson-file envelope or a bare doc, and normalizes it. */
  export function normalizeLessonFile(parsed: unknown): LessonDoc;
}

declare module "@spelling-creator/core/oslf" {
  import type { LessonDoc } from "@spelling-creator/core/types";

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
  /** Thrown by fromOslf, and by fromOslfXml, for a file this can't read. */
  export class OslfImportError extends Error {}
}

declare module "@spelling-creator/core/oslfXml" {
  export const OSLF_XML_EXTENSION: string;
  /** An OSLF file (what toOslf writes) in the format's XML form. */
  export function toOslfXml(file: unknown): string;
  /** An OSLF lesson's XML form as the OSLF file, for fromOslf to read. */
  export function fromOslfXml(text: string): unknown;
}
