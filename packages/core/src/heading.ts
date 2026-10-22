// Shared definitions for the heading block: a short heading inside a section,
// such as "WOULD YOU RATHER" over a run of those questions. The Open Spelling
// Lesson Format's `heading` block, stored under the same name.
//
// A heading is not a section. Sections are the editor's organising device and
// never print (see docxExport.js); a heading block is part of the lesson's
// content and prints where it sits. It carries nothing but its text, is never
// answered, and is not counted by interactive mode's progress or the checks.
//
// Imported by the editor (SectionCard / ContentBlock), the read-only viewer,
// the exporters and the importers, so the label and the block shape stay in
// sync everywhere.

import type { HeadingBlock } from "./types.ts";

/** Whether a block is a heading. */
export function isHeadingBlock(
  block: { type?: unknown } | null | undefined,
): boolean {
  return Boolean(block) && block?.type === "heading";
}

/**
 * Build a fresh, empty heading block. `newId` is injected so this stays
 * decoupled from the id helper (same convention as createVaktBlock).
 */
export function createHeadingBlock(newId: () => string): HeadingBlock {
  return { id: newId(), type: "heading", text: "" };
}

/** The heading's text, trimmed, or "" for a block with none. */
export function headingText(
  block: { text?: unknown } | null | undefined,
): string {
  return String(block?.text ?? "").trim();
}

// ---------------------------------------------------------------------------
// The Word paragraph style a heading prints in, mirroring the question and
// VAKT styles. It is a style of its own rather than one of Word's heading
// levels because the DOCX importer reads Word headings as section breaks, and
// a heading inside a section must come back inside it. mammoth keeps the
// style, so the PDF can set it and the importer can read it back.
// ---------------------------------------------------------------------------

/** The Word style id for a heading paragraph. */
export const HEADING_STYLE_ID = "s2cHeading";
/** The Word style *name*, which is what mammoth matches on in a style map. */
export const HEADING_STYLE_NAME = "S2C Heading";
/** The HTML class mammoth is told to emit for that style. */
export const HEADING_STYLE_CLASS = "s2c-heading";

/** The mammoth style-map entry turning the heading style back into a class. */
export function headingStyleMap() {
  return [
    `p[style-name='${HEADING_STYLE_NAME}'] => p.${HEADING_STYLE_CLASS}:fresh`,
  ];
}
