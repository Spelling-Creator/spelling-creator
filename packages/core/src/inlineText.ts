// Inline text: a one-line field that can carry what a text block's words can.
//
// A question's prompt and a math question's working steps are one line each,
// and for most of the app's life they were plain strings. A math question
// needs a formula in its prompt and its working as much as the passage does,
// a prompt names the same people and places the passage does and wants the
// same read-aloud hints, and the Open Spelling Lesson Format types both as
// rich text. So a field of inline text holds one of two shapes, under one key:
//
//   a string      the plain words, which is every field written before this
//                 existed, and any field nobody has formatted
//   a document    a tiptap document of exactly one paragraph, in the text
//                 block's schema (see lessonText.ts): the three marks, the
//                 speech mark, pauses and formulas. No footnotes: the Notes
//                 list numbers them through the text blocks, and a prompt
//                 has nothing to cite.
//
// One key rather than the text block's two (`text` and `content`), because the
// collaboration document (ydoc.ts) merges a block key by key: with one key a
// field is simply last write wins, as a plain prompt always was. (A document
// is stored there as a nested map whose `content` list has no keyed items, so
// it is replaced whole too.) Whoever writes a field writes the smaller shape
// (normalizeInlineText): a plain string stays a plain string, so a lesson
// nobody has formatted looks exactly as it did.
//
// Nothing else should read a prompt or a step directly: everything goes
// through the helpers here, which treat the two shapes as one. The renderers
// draw inlineTextRuns the way they draw a text block's paragraph, and every
// plain-text reader (the checks, search, translation, the summaries) takes
// inlineTextPlain.

import {
  contentToMarkup,
  isPlainContent,
  markupToContent,
  normalizeTextContent,
  textBlockParagraphs,
  textBlockPlain,
  textToContent,
  type InlineNode,
  type TextBlockRun,
  type TextContent,
} from "./lessonText.ts";
import { isRecord } from "./guards.ts";

// A document's paragraphs folded into one, with a space where each break was,
// footnotes left out and every formula in the line. A second pass through the
// normalizer merges the runs the fold put next to each other.
function oneParagraph(doc: TextContent): TextContent {
  const inline: InlineNode[] = [];
  for (const paragraph of doc.content) {
    const nodes = (paragraph.content || []).filter(
      (node) => node.type !== "footnote",
    );
    if (!nodes.length) continue;
    if (inline.length) inline.push({ type: "text", text: " " });
    for (const node of nodes) {
      inline.push(
        node.type === "math"
          ? { ...node, attrs: { ...node.attrs, display: false } }
          : node,
      );
    }
  }
  // A document, so the normalizer never turns it down.
  return normalizeTextContent({
    type: "doc",
    content: [{ type: "paragraph", content: inline }],
  })!;
}

/**
 * Inline text as a document of one paragraph, whichever shape it is stored
 * in. This is what the editor shows.
 */
export function inlineTextContent(value: unknown): TextContent {
  const doc = isRecord(value)
    ? normalizeTextContent(value)
    : textToContent(typeof value === "string" ? value : "");
  return oneParagraph(doc ?? textToContent(""));
}

/**
 * Inline text in its stored shape: the plain string when nothing in it needs
 * more than a string, the one-paragraph document otherwise. For every writer
 * (the editor, the importers, the MCP server).
 * @param value  A string, a document, or nothing.
 */
export function normalizeInlineText(value: unknown): string | TextContent {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return "";
  const content = inlineTextContent(value);
  return isPlainContent(content) ? textBlockPlain({ content }) : content;
}

/**
 * Inline text as plain words: a formula reads as its source, a pause as
 * nothing, a hinted run as its text. A plain string comes back as it is.
 */
export function inlineTextPlain(value: unknown): string {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return "";
  return textBlockPlain({ content: inlineTextContent(value) });
}

/**
 * Inline text as runs a renderer can draw, the shape of one paragraph of
 * textBlockParagraphs (no footnotes among them).
 */
export function inlineTextRuns(value: unknown): TextBlockRun[] {
  return textBlockParagraphs({ content: inlineTextContent(value) })[0] || [];
}

/** Whether inline text has anything a plain string couldn't hold. */
export function isPlainInlineText(value: unknown): boolean {
  return typeof normalizeInlineText(value) === "string";
}

/**
 * Inline text as the markup the MCP server speaks (see lessonText.ts), one
 * line.
 */
export function inlineTextMarkup(value: unknown): string {
  return contentToMarkup(inlineTextContent(value));
}

/**
 * Markup as inline text in its stored shape. A line break in the markup
 * becomes a space: the field is one line.
 */
export function markupToInlineText(markup: string): string | TextContent {
  return normalizeInlineText(markupToContent(markup));
}
