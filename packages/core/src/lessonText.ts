// The content of a lesson text block: formatted paragraphs with footnotes.
//
// A text block holds its words one of two ways:
//
//   text     a plain string, one paragraph per line. Every block written before
//            formatting existed looks like this, and so does an unformatted
//            block written whole (by an importer or the MCP server).
//   content  a tiptap (ProseMirror) JSON document, once the block carries any
//            formatting or footnotes, or has been edited in the editor:
//
//              { type: "doc", content: [
//                { type: "paragraph", content: [
//                  { type: "text", text: "Cats came to ", marks: [] },
//                  { type: "text", text: "Egypt", marks: [{ type: "italic" }] },
//                  { type: "footnote", attrs: { sourceId, locator, note } },
//                ] },
//              ] }
//
// When `content` is present it wins and `text` is ignored. Whole-block writers
// (importers, the MCP server) store the smaller shape; the editor, once it has
// touched a block, always stores `content` (withTextBlockDocument says why).
// Nothing else in the app should read either field directly: everything goes
// through the helpers
// here, which treat the two shapes as one. Paragraphs map one to one onto the
// old lines, so code that keyed things by line index (translation, the docx
// paragraphs) keeps its keys.
//
// The schema is deliberately small. Three marks (bold, italic, underline), one
// kind of block (the paragraph) and one inline node (the footnote). Lessons are
// read aloud and printed; headings, lists and links would be layout, and
// sections already carry the structure.
//
// Two more things exist only for read-aloud, and print as nothing of their own:
//
//   the speech mark   { type: "speech", attrs: { ipa } }, or { alias } or
//                     { sayAs: "characters" }: how the words it covers are
//                     said (in IPA, as other words, or one letter at a time).
//                     They still show and print as written.
//   the pause node    { type: "pause", attrs: { length: "short" | "long" } }:
//                     a pause in read-aloud, which displays as nothing.
//
// They are the Open Spelling Lesson Format's pronunciation, substitution,
// spell-out and pause (a small subset of SSML), stored the tiptap way. A text
// run carries at most one speech hint, so the mark holds exactly one of the
// three. speech.ts turns them into what the voices are given.
//
// And one inline node holds a formula:
//
//   the math node     { type: "math", attrs: { format, source, display, spoken } }
//                     `source` is the formula as the author wrote it, in the
//                     notation `format` names ("asciimath" or "tex"); `display`
//                     puts it on a line of its own; `spoken` is what read-aloud
//                     says for it, when the speech made from it isn't right.
//
// That is the format's math run. A formula is rendered by MathJax (the web
// app's Formula component, and the Word export), and read aloud from the
// MathML MathJax makes of it (speech.ts); as plain text it is its source,
// which is also what shows wherever MathJax can't run.
//
// normalizeTextContent enforces all of this on anything that arrives from
// outside the editor (an imported file, the MCP server, a document written by
// an older client), and the renderers draw only what survives it. Content is
// rendered as React elements and docx runs, never as HTML, so there is no
// markup to sanitize; the normalizer is what decides which shapes exist at all.
//
// A footnote is a numbered note at the foot of the lesson. It can cite one of
// the lesson's sources (`sourceId`, with an optional `locator` such as
// "p. 12"), carry a free-text `note`, or both. Footnotes are numbered in
// reading order across the whole lesson, the way Word numbers them, so the
// page, the printout and the editor agree on every number.

import {
  type CitationPart,
  isSourceId,
  partsText,
  sourceCitationParts,
  sourceHasContent,
} from "./sources.ts";
import type { LessonDoc, Source } from "./types.ts";

/** The marks a text run may carry, in the canonical order they are stored in. */
export const TEXT_MARKS = ["bold", "italic", "underline"] as const;

export type TextMark = (typeof TEXT_MARKS)[number];

const LOCATOR_LIMIT = 200;
const NOTE_LIMIT = 2000;

/**
 * What a footnote says when it cites a source that is no longer in the
 * lesson's list and carries no note of its own. Only reachable through a merge
 * or a concurrent edit; deleting a source in the editor strips its citations.
 */
export const MISSING_SOURCE_TEXT = "Source no longer listed.";

/**
 * What a footnote names a source by while the source is still empty: someone
 * added it and cited it, and hasn't filled it in yet. It is in the list, so it
 * mustn't read as missing.
 */
export const UNTITLED_SOURCE_TEXT = "Untitled source";

// The attributes below are types rather than interfaces so that a stored
// document is also a RichNode, whose attrs are a Record.

/** A footnote's attributes in their stored shape. */
export type Footnote = {
  sourceId: string | null;
  locator: string;
  note: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// One line of text: footnote fields and text runs never hold line breaks, since
// a line break is what separates two paragraphs.
function oneLine(value: unknown, limit: number) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

/**
 * A footnote's attributes in their exact stored shape, or null when the
 * footnote says nothing (no source and no note).
 */
export function normalizeFootnote(attrs: unknown): Footnote | null {
  const fields: Record<string, unknown> = isObject(attrs) ? attrs : {};
  const sourceId = isSourceId(fields.sourceId) ? fields.sourceId : null;
  const locator = sourceId ? oneLine(fields.locator, LOCATOR_LIMIT) : "";
  const note = oneLine(fields.note, NOTE_LIMIT);
  if (!sourceId && !note) return null;
  return { sourceId, locator, note };
}

/** How long a pause can be: about a comma's worth, or clearly longer. */
export const PAUSE_LENGTHS = ["short", "long"] as const;

export type PauseLength = (typeof PAUSE_LENGTHS)[number];

function isPauseLength(value: unknown): value is PauseLength {
  return PAUSE_LENGTHS.some((length) => length === value);
}

/** The one way a run can be spelled out: a character at a time. */
export const SAY_AS_CHARACTERS = "characters";

/** How the words a run covers are said. It holds exactly one of these. */
export type SpeechHint =
  | { ipa: string }
  | { alias: string }
  | { sayAs: typeof SAY_AS_CHARACTERS };

const IPA_LIMIT = 200;
const ALIAS_LIMIT = 500;

/**
 * A speech hint in its exact stored shape, or null when it says nothing.
 * Exactly one of `ipa`, `alias` and `sayAs` survives, in that order of
 * preference. IPA is often copied with the slashes or brackets dictionaries
 * put around it, which are not sounds, so they are dropped.
 */
export function normalizeSpeechHint(attrs: unknown): SpeechHint | null {
  if (!isObject(attrs)) return null;
  const ipa = oneLine(attrs.ipa, IPA_LIMIT)
    .replace(/^[/[]+|[/\]]+$/g, "")
    .trim();
  if (ipa) return { ipa };
  const alias = oneLine(attrs.alias, ALIAS_LIMIT);
  if (alias) return { alias };
  if (attrs.sayAs === SAY_AS_CHARACTERS) return { sayAs: SAY_AS_CHARACTERS };
  return null;
}

/** The notations a formula can be written in, as the format names them. */
export const FORMULA_FORMATS = ["asciimath", "tex"] as const;

const FORMULA_LIMIT = 2000;
const SPOKEN_LIMIT = 1000;

/** A run of spoken text: words, words with one speech hint, or a pause. */
export type SpokenTextRun =
  | string
  | ({ text: string } & SpeechHint)
  | { pause: PauseLength };

/** Spoken text in its stored shape: a plain string, or a list of runs. */
export type SpokenText = string | SpokenTextRun[];

/**
 * Spoken text (what read-aloud says for something) in its stored shape: a
 * plain string, or a list of runs that are strings, text runs with one speech
 * hint, and pauses. A run object with none of those is said as its text, as
 * the format asks, and dropped without any. Returns null for nothing to say.
 */
export function normalizeSpokenText(value: unknown): SpokenText | null {
  const runs: SpokenTextRun[] = [];
  const pushWords = (text: string) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (typeof last === "string") runs[runs.length - 1] = last + text;
    else runs.push(text);
  };
  // Spaces are kept, even at a run's edges: they are what keep the words of
  // neighboring runs apart. Only a line break has no place in spoken text.
  const spokenLine = (text: unknown) =>
    typeof text === "string"
      ? text.replace(/[\r\n]+/g, " ").slice(0, SPOKEN_LIMIT)
      : "";
  const list: unknown[] = Array.isArray(value) ? value : [value];
  for (const run of list) {
    if (typeof run === "string") {
      pushWords(spokenLine(run));
    } else if (isObject(run) && isPauseLength(run.pause)) {
      runs.push({ pause: run.pause });
    } else if (isObject(run) && typeof run.text === "string") {
      const text = spokenLine(run.text);
      if (!text) continue;
      const hint = normalizeSpeechHint(run);
      if (hint) runs.push({ text, ...hint });
      else pushWords(text);
    }
  }
  if (!runs.length) return null;
  const [first] = runs;
  return runs.length === 1 && typeof first === "string" ? first : runs;
}

/**
 * A formula's attributes in their stored shape. `format` is one of
 * FORMULA_FORMATS, or a notation this version doesn't know.
 */
export type Formula = {
  format: string;
  source: string;
  display: boolean;
  spoken: SpokenText | null;
};

/**
 * A formula's attributes in their exact stored shape, or null when there is
 * no formula (no source). A format this version doesn't know is kept, as the
 * format asks, so the formula survives a save; renderers show its source.
 */
export function normalizeFormula(attrs: unknown): Formula | null {
  if (!isObject(attrs)) return null;
  const source = oneLine(attrs.source, FORMULA_LIMIT);
  if (!source) return null;
  const format =
    typeof attrs.format === "string" && attrs.format.trim()
      ? attrs.format.trim().toLowerCase().slice(0, 32)
      : FORMULA_FORMATS[0];
  const spoken = normalizeSpokenText(attrs.spoken);
  return {
    format,
    source,
    display: attrs.display === true,
    // Only words count as something to say in place of the formula.
    spoken: typeof spoken === "string" && !spoken.trim() ? null : spoken,
  };
}

/** A text run in a stored document. Marks are omitted when it has none. */
export interface TextNode {
  type: "text";
  text: string;
  marks?: Array<{ type: TextMark } | { type: "speech"; attrs: SpeechHint }>;
}

export interface FootnoteNode {
  type: "footnote";
  attrs: Footnote;
}

export interface PauseNode {
  type: "pause";
  attrs: { length: PauseLength };
}

export interface MathNode {
  type: "math";
  attrs: Formula;
}

/** The inline nodes a stored document's paragraphs hold. */
export type InlineNode = TextNode | FootnoteNode | PauseNode | MathNode;

/** A stored paragraph. An empty one has no `content`. */
export interface ParagraphNode {
  type: "paragraph";
  content?: InlineNode[];
}

/** Text block content in its stored shape, as normalizeTextContent makes it. */
export interface TextContent {
  type: "doc";
  content: ParagraphNode[];
}

// A text run the way the helpers below work with it: its formatting marks as
// an array of names, and its speech hint (or null) as `speech`.
interface FlatText {
  type: "text";
  text: string;
  marks: TextMark[];
  speech: SpeechHint | null;
}

type FlatNode = FlatText | FootnoteNode | PauseNode | MathNode;

interface FlatParagraph {
  type: "paragraph";
  content?: FlatNode[];
}

function marksOf(node: { marks?: unknown }) {
  if (!Array.isArray(node?.marks)) return [];
  const marks: unknown[] = node.marks;
  const present = new Set(
    marks.map((mark) =>
      typeof mark === "string" ? mark : isObject(mark) ? mark.type : undefined,
    ),
  );
  return TEXT_MARKS.filter((mark) => present.has(mark));
}

// The speech hint a text node's marks carry, or null.
function speechOf(node: { marks?: unknown }) {
  if (!Array.isArray(node?.marks)) return null;
  const marks: unknown[] = node.marks;
  const mark = marks.find((m) => isObject(m) && m.type === "speech");
  return isObject(mark) ? normalizeSpeechHint(mark.attrs) : null;
}

function sameMarks(a: TextMark[], b: TextMark[]) {
  return a.length === b.length && a.every((mark, i) => mark === b[i]);
}

function sameSpeech(a: SpeechHint | null, b: SpeechHint | null) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// Flatten an inline node (or an unknown wrapper around some) into the inline
// nodes this schema has, appending to `out`.
function collectInline(node: unknown, out: FlatNode[], depth = 0) {
  if (!isObject(node) || depth > 20) return;
  if (node.type === "text") {
    const text =
      typeof node.text === "string" ? node.text.replace(/[\r\n]+/g, " ") : "";
    if (!text) return;
    const marks = marksOf(node);
    const speech = speechOf(node);
    const last = out[out.length - 1];
    if (
      last &&
      last.type === "text" &&
      sameMarks(last.marks, marks) &&
      sameSpeech(last.speech, speech)
    ) {
      last.text += text;
    } else {
      out.push({ type: "text", text, marks, speech });
    }
    return;
  }
  if (node.type === "footnote") {
    const attrs = normalizeFootnote(node.attrs);
    if (attrs) out.push({ type: "footnote", attrs });
    return;
  }
  if (node.type === "pause") {
    const length =
      isObject(node.attrs) && isPauseLength(node.attrs.length)
        ? node.attrs.length
        : "short";
    out.push({ type: "pause", attrs: { length } });
    return;
  }
  if (node.type === "math") {
    const attrs = normalizeFormula(node.attrs);
    if (attrs) out.push({ type: "math", attrs });
    return;
  }
  if (node.type === "hardBreak") {
    collectInline({ type: "text", text: " " }, out, depth);
    return;
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) collectInline(child, out, depth + 1);
  }
}

const INLINE_TYPES = new Set<unknown>([
  "text",
  "footnote",
  "pause",
  "math",
  "hardBreak",
]);

// Every paragraph inside a block-level node. A heading or a list item pasted in
// from somewhere else becomes the paragraph its words were in.
function collectParagraphs(node: unknown, out: FlatParagraph[], depth = 0) {
  if (!isObject(node) || depth > 20) return;
  const children: unknown[] = Array.isArray(node.content) ? node.content : [];
  if (
    node.type === "paragraph" ||
    children.some((child) => isObject(child) && INLINE_TYPES.has(child.type))
  ) {
    const inline: FlatNode[] = [];
    for (const child of children) collectInline(child, inline);
    out.push(inline.length ? { type: "paragraph", content: inline } : P());
    return;
  }
  for (const child of children) collectParagraphs(child, out, depth + 1);
}

function P(): { type: "paragraph" } {
  return { type: "paragraph" };
}

/**
 * Text block content in its exact stored shape, or null when the value isn't
 * a document at all.
 *
 * Drops every node and mark outside the schema (keeping the words inside
 * them), merges neighboring runs that carry the same marks, and stores marks
 * in a fixed order. That last part matters for version history: a block's git
 * blob is a hash of its JSON, so two spellings of the same formatting must
 * normalize to the same bytes or every save would look like an edit.
 */
export function normalizeTextContent(value: unknown): TextContent | null {
  if (!isObject(value) || value.type !== "doc") return null;
  return storedDocument(value.content);
}

// The stored document holding a document's block-level children.
function storedDocument(children: unknown): TextContent {
  const paragraphs: FlatParagraph[] = [];
  const list: unknown[] = Array.isArray(children) ? children : [];
  for (const child of list) {
    collectParagraphs(child, paragraphs);
  }
  return {
    type: "doc",
    content: (paragraphs.length ? paragraphs : [P()]).map(storedParagraph),
  };
}

// Marks are omitted from a run that has none, the way tiptap writes them. The
// speech mark comes after the formatting marks.
function storedParagraph(paragraph: FlatParagraph): ParagraphNode {
  if (!paragraph.content) return P();
  return {
    type: "paragraph",
    content: paragraph.content.map((node) => {
      if (node.type !== "text") return node;
      const marks: NonNullable<TextNode["marks"]> = node.marks.map((type) => ({
        type,
      }));
      if (node.speech) marks.push({ type: "speech", attrs: node.speech });
      return marks.length
        ? { type: "text", text: node.text, marks }
        : { type: "text", text: node.text };
    }),
  };
}

/** Plain text as a content document: one paragraph per line. */
export function textToContent(text: string | null | undefined): TextContent {
  const lines = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  return {
    type: "doc",
    content: lines.map((line) =>
      line
        ? { type: "paragraph", content: [{ type: "text", text: line }] }
        : P(),
    ),
  };
}

/**
 * The fields of a text block that the helpers below look at. A whole block
 * will do, and so will just its content, which is how inline text
 * (inlineText.ts) borrows the readers. A `content` that isn't a document is
 * ignored, and the writers keep `id` and `type` as they are.
 */
export interface TextBlockFields {
  id?: string;
  type?: string;
  text?: string;
  content?: unknown;
}

/** A text block's content, whichever of the two shapes it is stored in. */
export function textBlockContent(block: TextBlockFields): TextContent {
  return normalizeTextContent(block?.content) ?? textToContent(block?.text);
}

// The paragraphs of a document as arrays of normalized inline nodes, with each
// text run's formatting marks as an array of names and its speech hint (or
// null) as `speech`.
function inlineParagraphs(content: unknown): FlatNode[][] {
  const doc = normalizeTextContent(content) ?? textToContent("");
  return doc.content.map((paragraph) =>
    (paragraph.content || []).map((node) =>
      node.type === "text"
        ? { ...node, marks: marksOf(node), speech: speechOf(node) }
        : node,
    ),
  );
}

// A formula reads as its source in plain text: what the format says to show
// where it can't be rendered, and what a check or a search can match.
function paragraphPlain(inline: FlatNode[]) {
  return inline
    .map((node) =>
      node.type === "text"
        ? node.text
        : node.type === "math"
          ? node.attrs.source
          : "",
    )
    .join("");
}

/**
 * A text block as plain lines, one per paragraph, without formatting or
 * footnote markers. The same lines `text` would have held.
 */
export function textBlockLines(block: TextBlockFields): string[] {
  return inlineParagraphs(textBlockContent(block)).map(paragraphPlain);
}

/**
 * A text block as plain text, paragraphs joined by newlines. This is what every
 * plain-text reader of a lesson wants: summaries, search, spelling-word
 * extraction, the read-aloud voice, the MCP server's grounding checks.
 */
export function textBlockPlain(block: TextBlockFields): string {
  return textBlockLines(block).join("\n");
}

/** Whether a text block has any words in it. */
export function textBlockHasContent(block: TextBlockFields): boolean {
  return (
    Boolean(textBlockPlain(block).trim()) ||
    textBlockFootnotes(block).length > 0
  );
}

export interface TextRun {
  type: "text";
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  speech?: SpeechHint;
}

export type FootnoteRun = { type: "footnote"; index: number } & Footnote;

export interface PauseRun {
  type: "pause";
  length: PauseLength;
}

export type MathRun = { type: "math" } & Formula;

/** A run of a text block's paragraph, as textBlockParagraphs gives it. */
export type TextBlockRun = TextRun | FootnoteRun | PauseRun | MathRun;

/**
 * A text block's paragraphs as runs a renderer can draw directly:
 *   { type: "text", text, bold, italic, underline, speech }
 *   { type: "footnote", sourceId, locator, note, index }
 *   { type: "pause", length }
 *   { type: "math", format, source, display, spoken }
 * `index` counts footnotes within the block, from 0, in reading order.
 * `speech` is the run's speech hint, present only when it has one (see
 * normalizeSpeechHint). Renderers that show or print
 * the lesson draw the text and ignore `speech` and pauses, which only
 * read-aloud uses, and draw a formula with MathJax (or as its source).
 */
export function textBlockParagraphs(block: TextBlockFields): TextBlockRun[][] {
  let index = 0;
  return inlineParagraphs(textBlockContent(block)).map((inline) =>
    inline.map((node): TextBlockRun => {
      if (node.type === "text") {
        return {
          type: "text",
          text: node.text,
          bold: node.marks.includes("bold"),
          italic: node.marks.includes("italic"),
          underline: node.marks.includes("underline"),
          ...(node.speech ? { speech: node.speech } : {}),
        };
      }
      if (node.type === "pause") {
        return { type: "pause", length: node.attrs.length };
      }
      if (node.type === "math") {
        return { type: "math", ...node.attrs };
      }
      return { type: "footnote", ...node.attrs, index: index++ };
    }),
  );
}

/** A text block's footnotes, in reading order. */
export function textBlockFootnotes(block: TextBlockFields): Footnote[] {
  return inlineParagraphs(textBlockContent(block))
    .flat()
    .filter((node): node is FootnoteNode => node.type === "footnote")
    .map((node) => node.attrs);
}

/**
 * How many footnotes come before each text block, keyed by block id. A
 * footnote's number is its block's start plus its own index plus one.
 */
export function footnoteStarts(doc: LessonDoc): Map<string, number> {
  const starts = new Map<string, number>();
  let count = 0;
  for (const section of doc?.sections || []) {
    for (const block of section.blocks || []) {
      if (block?.type !== "text") continue;
      starts.set(block.id, count);
      count += textBlockFootnotes(block).length;
    }
  }
  return starts;
}

/** A footnote of the lesson, with its number and where it sits. */
export type LessonFootnote = Footnote & {
  number: number;
  blockId: string;
  si: number;
  bi: number;
  index: number;
};

/** Every footnote in the lesson, numbered in reading order, with where it sits. */
export function lessonFootnotes(doc: LessonDoc): LessonFootnote[] {
  const out: LessonFootnote[] = [];
  (doc?.sections || []).forEach((section, si) => {
    (section.blocks || []).forEach((block, bi) => {
      if (block?.type !== "text") return;
      textBlockFootnotes(block).forEach((footnote, index) => {
        out.push({
          number: out.length + 1,
          blockId: block.id,
          si,
          bi,
          index,
          ...footnote,
        });
      });
    });
  });
  return out;
}

/**
 * What a footnote prints, in runs: the citation (when it cites a source that
 * exists), then the note. `note` can be overridden, which is how a translated
 * note is laid in without translating the citation in front of it.
 * @param sources  From sourcesById().
 * @returns The note's run is tagged `role: "note"` and a locator's
 *   `role: "locator"`, which the Word export turns into styles the importer
 *   reads back.
 */
export function footnoteParts(
  footnote: Footnote,
  sources: ReadonlyMap<string, Source>,
  { note }: { note?: string } = {},
): CitationPart[] {
  const parts: CitationPart[] = [];
  const source = footnote?.sourceId ? sources?.get(footnote.sourceId) : null;
  if (source) {
    parts.push(
      ...sourceCitationParts(
        // An empty source is named as such (as a plain run, not a title).
        sourceHasContent(source) ? source : { author: UNTITLED_SOURCE_TEXT },
        footnote.locator,
      ),
    );
  }
  const text = (note ?? footnote?.note ?? "").trim();
  if (text)
    parts.push({ text: parts.length ? ` ${text}` : text, role: "note" });
  if (!parts.length) parts.push({ text: MISSING_SOURCE_TEXT });
  return parts;
}

/** A footnote as plain text. */
export function footnoteText(
  footnote: Footnote,
  sources: ReadonlyMap<string, Source>,
): string {
  return partsText(footnoteParts(footnote, sources));
}

/**
 * A text block holding this content, in the smaller of the two shapes: plain
 * `text` when nothing in it is formatted, `content` otherwise. For writers that
 * replace a block whole (importers, the MCP server).
 *
 * Not for the editor: see withTextBlockDocument.
 * @param block The block being replaced (its id and type are kept).
 */
export function withTextBlockContent<B extends TextBlockFields>(
  block: B,
  content: unknown,
): Omit<B, "text" | "content"> & { text?: string; content?: TextContent } {
  const normalized = normalizeTextContent(content) ?? textToContent("");
  // Dropping both fields first, so a block never carries a stale copy of one.
  const { text: _text, content: _content, ...rest } = block;
  if (isPlainContent(normalized)) {
    return {
      ...rest,
      text: inlineParagraphs(normalized).map(paragraphPlain).join("\n"),
    };
  }
  return { ...rest, content: normalized };
}

/**
 * A text block holding this content as a `content` document, always, even when
 * nothing in it is formatted.
 *
 * This is what the editor writes, and the reason is live collaboration. The
 * collaboration document (ydoc.ts) merges a block key by key, so if one person's
 * edit wrote `content` while another's wrote `text`, both keys would survive the
 * merge and `content` would silently hide the other edit. Once the editor has
 * touched a block it only ever writes `content`, so two people editing one block
 * write the same key, and the usual last-write-wins applies to the whole text.
 */
export function withTextBlockDocument<B extends TextBlockFields>(
  block: B,
  content: unknown,
): Omit<B, "text" | "content"> & { text?: undefined; content: TextContent } {
  const { text: _text, content: _content, ...rest } = block;
  return {
    ...rest,
    content: normalizeTextContent(content) ?? textToContent(""),
  };
}

/** Whether content has nothing a plain string couldn't hold. */
export function isPlainContent(content: unknown): boolean {
  return inlineParagraphs(content).every((inline) =>
    inline.every(
      (node) => node.type === "text" && node.marks.length === 0 && !node.speech,
    ),
  );
}

/**
 * The lesson with every citation of one source taken out of its text blocks.
 * A footnote that also carries a note keeps the note; one that only cited the
 * source goes. Blocks with nothing to change are returned as they were, so
 * memoized cards stay memoized.
 */
export function removeSourceCitations(
  doc: LessonDoc,
  sourceId: string,
): LessonDoc {
  return {
    ...doc,
    sections: (doc?.sections || []).map((section) => {
      let changed = false;
      const blocks = (section.blocks || []).map((block) => {
        if (block?.type !== "text") return block;
        const cites = textBlockFootnotes(block).some(
          (footnote) => footnote.sourceId === sourceId,
        );
        if (!cites) return block;
        changed = true;
        // A block that cites a source has footnotes, so it is already stored as
        // a document; keep it that way (see withTextBlockDocument).
        return withTextBlockDocument(
          block,
          mapFootnotes(textBlockContent(block), (attrs) =>
            attrs.sourceId !== sourceId
              ? attrs
              : attrs.note
                ? { sourceId: null, locator: "", note: attrs.note }
                : null,
          ),
        );
      });
      return changed ? { ...section, blocks } : section;
    }),
  };
}

// Rewrite every footnote in a document; returning null removes it.
function mapFootnotes(
  content: TextContent,
  fn: (attrs: Footnote) => Footnote | null,
): TextContent {
  return {
    ...content,
    content: content.content.map((paragraph) =>
      paragraph.content
        ? {
            ...paragraph,
            content: paragraph.content.flatMap((node): InlineNode[] => {
              if (node.type !== "footnote") return [node];
              const attrs = fn(node.attrs);
              return attrs ? [{ ...node, attrs }] : [];
            }),
          }
        : paragraph,
    ),
  };
}

/** A run of formatted text, as textBlockFormattedSpans finds it. */
export interface FormattedSpan {
  text: string;
  marks: TextMark[];
}

/**
 * The formatted spans of a text block, for the MCP server's check that an
 * assistant hasn't scattered bold and italics through a passage. A span is a
 * run of formatted text with nothing plain inside it: "**bold *and italic***"
 * is one span carrying both marks, because it reads as one formatted phrase.
 */
export function textBlockFormattedSpans(block: TextBlockFields): {
  spans: FormattedSpan[];
  totalChars: number;
} {
  const spans: FormattedSpan[] = [];
  let totalChars = 0;
  for (const inline of inlineParagraphs(textBlockContent(block))) {
    let current: { text: string; marks: Set<TextMark> } | null = null;
    const finish = () => {
      const span = current;
      if (span && span.text.trim()) {
        spans.push({
          text: span.text.trim(),
          marks: TEXT_MARKS.filter((mark) => span.marks.has(mark)),
        });
      }
      current = null;
    };
    for (const node of inline) {
      if (node.type !== "text") continue;
      totalChars += node.text.length;
      if (!node.marks.length) {
        finish();
        continue;
      }
      current ??= { text: "", marks: new Set() };
      current.text += node.text;
      for (const mark of node.marks) current.marks.add(mark);
    }
    finish();
  }
  return { spans, totalChars };
}

// ---- Markup: the plain-text form the MCP server speaks ---------------------
//
// An assistant writes and reads text blocks as one string, not as JSON. The
// syntax is Markdown where Markdown has an answer and as small as it can be
// where it doesn't:
//
//   **bold**   *italic*   <u>underline</u>
//   ^[A free-text note.]
//   ^[@sourceId]                    cites a source
//   ^[@sourceId, p. 12]             with a locator
//   ^[@sourceId, p. 12 | A note.]   with a locator and a note
//   ^[@sourceId | A note.]          with a note
//   [FRESNEL]{ipa: freɪˈnɛl}        said as the IPA gives it
//   [WWF]{say: World Wide Fund}     said as other words
//   [REEF]{spell}                   said one letter at a time
//   {pause}   {pause: long}         a short or long pause in read-aloud
//   {asciimath: 120 xx 3 = 360}     a formula, in AsciiMath
//   {tex: \frac{60}{5} = 12}        a formula, in LaTeX
//   {tex display: ...}              on a line of its own
//   {tex: ...}{spoken: ...}         with the words read-aloud says for it
//
// The read-aloud forms borrow Pandoc's bracketed spans: the words in square
// brackets show and print as they are, and the braces right after them say
// how to read them.
//
// A formula runs to the brace that balances its opening one, and nothing
// inside it is an escape, since TeX is full of both braces and backslashes.
// The rare formula whose braces don't balance (TeX's `\left\{ x \right.`)
// is written `{tex escaped: \left\\\{ x \right.}` instead: with `escaped`
// after the notation, a backslash makes the next character literal, as it
// does in text.
//
// One line is one paragraph. A backslash makes the next character literal, so
// \* is an asterisk. contentToMarkup escapes whatever needs it, so text read
// out of a lesson can be written straight back.

/** A content document as markup. */
export function contentToMarkup(content: unknown): string {
  return inlineParagraphs(content).map(paragraphToMarkup).join("\n");
}

/** A text block as markup, whichever shape it is stored in. */
export function textBlockMarkup(block: TextBlockFields): string {
  return contentToMarkup(textBlockContent(block));
}

const MARK_SYNTAX = {
  bold: ["**", "**"],
  italic: ["*", "*"],
  underline: ["<u>", "</u>"],
} satisfies Record<TextMark, [string, string]>;

function paragraphToMarkup(inline: FlatNode[]) {
  let out = "";
  let open: TextMark[] = [];
  const close = (keep: TextMark[]) => {
    // Closed innermost first, so the output nests the way Markdown reads.
    for (const mark of [...open].reverse()) {
      if (!keep.includes(mark)) out += MARK_SYNTAX[mark][1];
    }
    open = open.filter((mark) => keep.includes(mark));
  };
  for (const node of inline) {
    if (node.type === "footnote") {
      close([]);
      out += footnoteToMarkup(node.attrs);
      continue;
    }
    // A pause sits wherever it falls, inside formatting or not.
    if (node.type === "pause") {
      out += node.attrs.length === "long" ? "{pause: long}" : "{pause}";
      continue;
    }
    if (node.type === "math") {
      close([]);
      out += formulaToMarkup(node.attrs);
      continue;
    }
    close(node.marks);
    for (const mark of node.marks) {
      if (!open.includes(mark)) {
        out += MARK_SYNTAX[mark][0];
        open.push(mark);
      }
    }
    out += node.speech
      ? speechToMarkup(node.text, node.speech)
      : escapeText(node.text);
  }
  close([]);
  return out;
}

function escapeText(text: string) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\*/g, "\\*")
    .replace(/\^\[/g, "\\^[")
    .replace(/\{/g, "\\{")
    .replace(/<(\/?u>)/gi, "\\<$1");
}

function speechToMarkup(text: string, speech: SpeechHint) {
  const words = text.replace(/[\\\]]/g, (ch) => `\\${ch}`);
  const value = (v: string) => v.replace(/[\\}]/g, (ch) => `\\${ch}`);
  const body =
    "ipa" in speech
      ? `ipa: ${value(speech.ipa)}`
      : "alias" in speech
        ? `say: ${value(speech.alias)}`
        : "spell";
  return `[${words}]{${body}}`;
}

// The formula's source goes in as it is (see the note on braces above), or,
// when its braces don't balance (a TeX `\left\{ ... \right.`), with
// `escaped` after the notation and a backslash before each brace and
// backslash. Its spoken words, if any, follow in their own braces, flattened
// to words.
function formulaToMarkup({ format, source, display, spoken }: Formula) {
  const escaped = balancingBrace(`${source}}`, 0) !== source.length;
  const flags = `${display ? " display" : ""}${escaped ? " escaped" : ""}`;
  const body = escaped ? source.replace(/[\\{}]/g, (ch) => `\\${ch}`) : source;
  let out = `{${format}${flags}: ${body}}`;
  const words = spokenWordsOf(spoken);
  if (words) out += `{spoken: ${words.replace(/[\\}]/g, (ch) => `\\${ch}`)}}`;
  return out;
}

/** Spoken text as it reads: its words, each run's text, nothing for a pause. */
export function spokenWordsOf(spoken: SpokenText | null | undefined): string {
  if (typeof spoken === "string") return spoken;
  if (!Array.isArray(spoken)) return "";
  return spoken
    .map((run) =>
      typeof run === "string" ? run : (run && "text" in run && run.text) || "",
    )
    .join("");
}

function escapeNote(text: string) {
  return text.replace(/[\\[\]|]/g, (ch) => `\\${ch}`);
}

function footnoteToMarkup({ sourceId, locator, note }: Footnote) {
  if (!sourceId) {
    const body = escapeNote(note);
    return `^[${body.startsWith("@") ? `\\${body}` : body}]`;
  }
  let body = `@${sourceId}`;
  if (locator) body += `, ${escapeNote(locator)}`;
  if (note) body += ` | ${escapeNote(note)}`;
  return `^[${body}]`;
}

/**
 * Markup as a content document.
 *
 * Forgiving rather than strict: a `**` or `*` with no partner, or a `^[` that
 * never closes, is read as the literal characters, so prose that happens to
 * contain an asterisk survives. A citation of an id that isn't a valid source
 * id becomes a note holding what was written; whether the id names a source in
 * the lesson is for the caller to check (see markupSourceIds).
 */
export function markupToContent(markup: string): TextContent {
  const lines = String(markup ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  return storedDocument(lines.map(parseParagraph));
}

type Token =
  | { kind: "text"; text: string }
  | { kind: "footnote"; attrs: Footnote; raw: string }
  | { kind: "speech"; text: string; speech: SpeechHint }
  | { kind: "pause"; length: PauseLength }
  | { kind: "formula"; attrs: Formula }
  | { kind: "bold" | "italic" | "u-open" | "u-close"; raw: string };

function parseParagraph(line: string) {
  const tokens = tokenize(line);
  resolveUnpaired(tokens);
  const marks = new Set<TextMark>();
  const content: InlineNode[] = [];
  for (const token of tokens) {
    if (token.kind === "text") {
      content.push({
        type: "text",
        text: token.text,
        marks: [...marks].map((type) => ({ type })),
      });
    } else if (token.kind === "footnote") {
      content.push({ type: "footnote", attrs: token.attrs });
    } else if (token.kind === "speech") {
      content.push({
        type: "text",
        text: token.text,
        marks: [
          ...[...marks].map((type) => ({ type })),
          { type: "speech", attrs: token.speech },
        ],
      });
    } else if (token.kind === "pause") {
      content.push({ type: "pause", attrs: { length: token.length } });
    } else if (token.kind === "formula") {
      content.push({ type: "math", attrs: token.attrs });
    } else if (token.kind === "u-open") {
      marks.add("underline");
    } else if (token.kind === "u-close") {
      marks.delete("underline");
    } else if (marks.has(token.kind)) {
      marks.delete(token.kind);
    } else {
      marks.add(token.kind);
    }
  }
  return { type: "paragraph", content };
}

function tokenize(line: string) {
  const tokens: Token[] = [];
  let text = "";
  const flush = () => {
    if (text) tokens.push({ kind: "text", text });
    text = "";
  };
  for (let i = 0; i < line.length;) {
    const ch = line[i];
    if (ch === "\\" && i + 1 < line.length) {
      text += line[i + 1];
      i += 2;
      continue;
    }
    if (ch === "^" && line[i + 1] === "[") {
      const end = closingBracket(line, i + 2);
      if (end !== -1) {
        flush();
        tokens.push({
          kind: "footnote",
          attrs: parseFootnoteBody(line.slice(i + 2, end)),
          raw: line.slice(i, end + 1),
        });
        i = end + 1;
        continue;
      }
    }
    if (ch === "[") {
      const end = closingBracket(line, i + 1);
      const braceEnd =
        end !== -1 && line[end + 1] === "{" ? closingBrace(line, end + 2) : -1;
      const speech =
        braceEnd !== -1 ? parseSpeechBody(line.slice(end + 2, braceEnd)) : null;
      const words = end !== -1 ? unescape(line.slice(i + 1, end)) : "";
      if (speech && words.trim()) {
        flush();
        tokens.push({ kind: "speech", text: words, speech });
        i = braceEnd + 1;
        continue;
      }
    }
    if (ch === "{") {
      const formula = readFormula(line, i);
      if (formula) {
        flush();
        tokens.push({ kind: "formula", attrs: formula.attrs });
        i = formula.end;
        continue;
      }
      const end = closingBrace(line, i + 1);
      const length = end !== -1 ? parsePauseBody(line.slice(i + 1, end)) : null;
      if (length) {
        flush();
        tokens.push({ kind: "pause", length });
        i = end + 1;
        continue;
      }
    }
    if (line.startsWith("**", i)) {
      flush();
      tokens.push({ kind: "bold", raw: "**" });
      i += 2;
      continue;
    }
    if (ch === "*") {
      flush();
      tokens.push({ kind: "italic", raw: "*" });
      i += 1;
      continue;
    }
    const lower = line.slice(i, i + 4).toLowerCase();
    if (lower.startsWith("<u>")) {
      flush();
      tokens.push({ kind: "u-open", raw: line.slice(i, i + 3) });
      i += 3;
      continue;
    }
    if (lower === "</u>") {
      flush();
      tokens.push({ kind: "u-close", raw: line.slice(i, i + 4) });
      i += 4;
      continue;
    }
    text += ch;
    i += 1;
  }
  flush();
  return tokens;
}

// The index of the `]` closing a bracket opened just before `from`, allowing
// balanced brackets and escapes inside it, or -1.
function closingBracket(line: string, from: number) {
  let depth = 0;
  for (let i = from; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\") {
      i += 1;
    } else if (ch === "[") {
      depth += 1;
    } else if (ch === "]") {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

// The index of the `}` closing a brace opened just before `from`, or -1.
function closingBrace(line: string, from: number) {
  for (let i = from; i < line.length; i++) {
    if (line[i] === "\\") i += 1;
    else if (line[i] === "}") return i;
  }
  return -1;
}

// What follows a bracketed span: `ipa: ...`, `say: ...` or `spell`. Anything
// else means the brackets and braces were just text.
function parseSpeechBody(body: string): SpeechHint | null {
  const match = /^\s*(ipa|say|spell)\s*(?::(.*))?$/is.exec(body);
  if (!match) return null;
  const key = match[1].toLowerCase();
  const value = unescape(match[2] ?? "").trim();
  if (key === "spell") {
    return value ? null : { sayAs: SAY_AS_CHARACTERS };
  }
  return normalizeSpeechHint(key === "ipa" ? { ipa: value } : { alias: value });
}

// The index of the `}` that balances a brace opened just before `from`, with
// no escapes (TeX inside), or -1.
function balancingBrace(line: string, from: number) {
  let depth = 0;
  for (let i = from; i < line.length; i++) {
    if (line[i] === "{") depth += 1;
    else if (line[i] === "}") {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

const FORMULA_HEAD = /^\s*(asciimath|tex)((?:\s+(?:display|escaped))*)\s*:/i;

// A formula span starting at the `{` at `at`, with its spoken words if a
// `{spoken: ...}` follows it straight away: { attrs, end } where `end` is the
// index after the last brace, or null when this isn't a formula.
function readFormula(
  line: string,
  at: number,
): { attrs: Formula; end: number } | null {
  const head = FORMULA_HEAD.exec(line.slice(at + 1, at + 40));
  if (!head) return null;
  const flags = head[2].toLowerCase().split(/\s+/);
  const escaped = flags.includes("escaped");
  const close = escaped
    ? closingBrace(line, at + 1)
    : balancingBrace(line, at + 1);
  if (close === -1) return null;
  const raw = line.slice(at + 1 + head[0].length, close);
  const source = (escaped ? unescape(raw) : raw).trim();
  if (!source) return null;
  const attrs: Formula = {
    format: head[1].toLowerCase(),
    source,
    display: flags.includes("display"),
    spoken: null,
  };
  let end = close + 1;
  const spoken = /^\{spoken\s*:/i.exec(line.slice(end, end + 12));
  if (spoken) {
    const spokenClose = closingBrace(line, end + spoken[0].length);
    if (spokenClose !== -1) {
      attrs.spoken = unescape(
        line.slice(end + spoken[0].length, spokenClose),
      ).trim();
      end = spokenClose + 1;
    }
  }
  const normalized = normalizeFormula(attrs);
  return normalized ? { attrs: normalized, end } : null;
}

// `pause`, `pause: short` or `pause: long`, as a length, or null.
function parsePauseBody(body: string) {
  const match = /^\s*pause\s*(?::\s*(short|long)\s*)?$/i.exec(body);
  if (!match) return null;
  const length = (match[1] || "short").toLowerCase();
  return isPauseLength(length) ? length : null;
}

// A marker token as the characters it was written as.
function literal(token: Token): Token {
  return { kind: "text", text: "raw" in token ? token.raw : "" };
}

// Turn markers that have no partner back into the characters they were written
// as. Bold and italic pair by count (the last of an odd number is literal);
// underline pairs an opening tag with the next closing one.
function resolveUnpaired(tokens: Token[]) {
  for (const kind of ["bold", "italic"]) {
    const at = tokens
      .map((token, i) => (token.kind === kind ? i : -1))
      .filter((i) => i !== -1);
    if (at.length % 2 === 1) {
      const last = at[at.length - 1];
      tokens[last] = literal(tokens[last]);
    }
  }
  let pending = -1;
  tokens.forEach((token, i) => {
    if (token.kind === "u-open") {
      if (pending !== -1) {
        tokens[pending] = literal(tokens[pending]);
      }
      pending = i;
    } else if (token.kind === "u-close") {
      if (pending === -1) tokens[i] = { kind: "text", text: token.raw };
      pending = -1;
    }
  });
  if (pending !== -1) {
    tokens[pending] = literal(tokens[pending]);
  }
}

// Split at the first unescaped `ch`: [before, after], or [whole, null].
function splitUnescaped(text: string, ch: string): [string, string | null] {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") {
      i += 1;
    } else if (text[i] === ch) {
      return [text.slice(0, i), text.slice(i + 1)];
    }
  }
  return [text, null];
}

function unescape(text: string) {
  return text.replace(/\\(.)/g, "$1");
}

function parseFootnoteBody(body: string): Footnote {
  const trimmed = body.trim();
  if (trimmed.startsWith("@")) {
    const [head, note] = splitUnescaped(trimmed.slice(1), "|");
    const [id, locator] = splitUnescaped(head, ",");
    const sourceId = unescape(id).trim();
    if (isSourceId(sourceId)) {
      return {
        sourceId,
        locator: unescape(locator ?? "").trim(),
        note: unescape(note ?? "").trim(),
      };
    }
  }
  return { sourceId: null, locator: "", note: unescape(trimmed) };
}

/** The source ids a piece of markup cites, in order of first appearance. */
export function markupSourceIds(markup: string): string[] {
  const ids: string[] = [];
  for (const paragraph of inlineParagraphs(markupToContent(markup))) {
    for (const node of paragraph) {
      if (node.type === "footnote" && node.attrs.sourceId) {
        if (!ids.includes(node.attrs.sourceId)) ids.push(node.attrs.sourceId);
      }
    }
  }
  return ids;
}
