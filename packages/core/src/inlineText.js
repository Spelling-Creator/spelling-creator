// Inline text: a one-line field that can carry what a text block's words can.
//
// A question's prompt, a math question's working steps and its answer are one
// line each, and for most of the app's life they were plain strings. A math
// question needs a formula in its prompt and its working as much as the
// passage does, and in its answer too where the speller spells a fraction or a
// pi on a math letterboard; a prompt names the same people and places the
// passage does and wants the same read-aloud hints; and the Open Spelling
// Lesson Format types the prompt and the working as rich text. So a field of
// inline text holds one of two shapes, under one key:
//
//   a string      the plain words, which is every field written before this
//                 existed, and any field nobody has formatted
//   a document    a tiptap document of exactly one paragraph, in the text
//                 block's schema (see lessonText.js): the three marks, the
//                 speech mark, pauses and formulas. No footnotes: the Notes
//                 list numbers them through the text blocks, and a prompt
//                 has nothing to cite.
//
// One key rather than the text block's two (`text` and `content`), because the
// collaboration document (ydoc.js) merges a block key by key: with one key a
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
} from "./lessonText.js";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// A document's paragraphs folded into one, with a space where each break was,
// footnotes left out and every formula in the line. A second pass through the
// normalizer merges the runs the fold put next to each other.
function oneParagraph(doc) {
  const inline = [];
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
  return normalizeTextContent({
    type: "doc",
    content: [{ type: "paragraph", content: inline }],
  });
}

/**
 * Inline text as a document of one paragraph, whichever shape it is stored
 * in. This is what the editor shows.
 * @param {unknown} value
 * @returns {object}
 */
export function inlineTextContent(value) {
  const doc = isObject(value)
    ? normalizeTextContent(value)
    : textToContent(typeof value === "string" ? value : "");
  return oneParagraph(doc ?? textToContent(""));
}

/**
 * Inline text in its stored shape: the plain string when nothing in it needs
 * more than a string, the one-paragraph document otherwise. For every writer
 * (the editor, the importers, the MCP server).
 * @param {unknown} value  A string, a document, or nothing.
 * @returns {string | object}
 */
export function normalizeInlineText(value) {
  if (typeof value === "string") return value;
  if (!isObject(value)) return "";
  const content = inlineTextContent(value);
  return isPlainContent(content) ? textBlockPlain({ content }) : content;
}

/**
 * Inline text as plain words: a formula reads as its source, a pause as
 * nothing, a hinted run as its text. A plain string comes back as it is.
 * @param {unknown} value
 * @returns {string}
 */
export function inlineTextPlain(value) {
  if (typeof value === "string") return value;
  if (!isObject(value)) return "";
  return textBlockPlain({ content: inlineTextContent(value) });
}

/**
 * Inline text as runs a renderer can draw, the shape of one paragraph of
 * textBlockParagraphs (no footnotes among them).
 * @param {unknown} value
 * @returns {Array<object>}
 */
export function inlineTextRuns(value) {
  return textBlockParagraphs({ content: inlineTextContent(value) })[0] || [];
}

/**
 * Whether inline text has anything a plain string couldn't hold.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isPlainInlineText(value) {
  return typeof normalizeInlineText(value) === "string";
}

/**
 * Inline text as the markup the MCP server speaks (see lessonText.js), one
 * line.
 * @param {unknown} value
 * @returns {string}
 */
export function inlineTextMarkup(value) {
  return contentToMarkup(inlineTextContent(value));
}

/**
 * Markup as inline text in its stored shape. A line break in the markup
 * becomes a space: the field is one line.
 * @param {string} markup
 * @returns {string | object}
 */
export function markupToInlineText(markup) {
  return normalizeInlineText(markupToContent(markup));
}
