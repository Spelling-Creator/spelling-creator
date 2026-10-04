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
// sections already carry the structure. normalizeTextContent enforces this on
// anything that arrives from outside the editor (an imported file, the MCP
// server, a document written by an older client), and the renderers draw only
// what survives it. Content is rendered as React elements and docx runs, never
// as HTML, so there is no markup to sanitise; the normaliser is what decides
// which shapes exist at all.
//
// A footnote is a numbered note at the foot of the lesson. It can cite one of
// the lesson's sources (`sourceId`, with an optional `locator` such as
// "p. 12"), carry a free-text `note`, or both. Footnotes are numbered in
// reading order across the whole lesson, the way Word numbers them, so the
// page, the printout and the editor agree on every number.

import {
  isSourceId,
  partsText,
  sourceCitationParts,
  sourceHasContent,
} from "./sources.js";

/** The marks a text run may carry, in the canonical order they are stored in. */
export const TEXT_MARKS = ["bold", "italic", "underline"];

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

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// One line of text: footnote fields and text runs never hold line breaks, since
// a line break is what separates two paragraphs.
function oneLine(value, limit) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

/**
 * A footnote's attributes in their exact stored shape, or null when the
 * footnote says nothing (no source and no note).
 * @param {unknown} attrs
 * @returns {{ sourceId: string|null, locator: string, note: string }|null}
 */
export function normalizeFootnote(attrs) {
  const sourceId = isSourceId(attrs?.sourceId) ? attrs.sourceId : null;
  const locator = sourceId ? oneLine(attrs.locator, LOCATOR_LIMIT) : "";
  const note = oneLine(attrs?.note, NOTE_LIMIT);
  if (!sourceId && !note) return null;
  return { sourceId, locator, note };
}

function marksOf(node) {
  if (!Array.isArray(node?.marks)) return [];
  const present = new Set(
    node.marks.map((mark) => (typeof mark === "string" ? mark : mark?.type)),
  );
  return TEXT_MARKS.filter((mark) => present.has(mark));
}

function sameMarks(a, b) {
  return a.length === b.length && a.every((mark, i) => mark === b[i]);
}

// Flatten an inline node (or an unknown wrapper around some) into the inline
// nodes this schema has, appending to `out`.
function collectInline(node, out, depth = 0) {
  if (!isObject(node) || depth > 20) return;
  if (node.type === "text") {
    const text =
      typeof node.text === "string" ? node.text.replace(/[\r\n]+/g, " ") : "";
    if (!text) return;
    const marks = marksOf(node);
    const last = out[out.length - 1];
    if (last && last.type === "text" && sameMarks(last.marks, marks)) {
      last.text += text;
    } else {
      out.push({ type: "text", text, marks });
    }
    return;
  }
  if (node.type === "footnote") {
    const attrs = normalizeFootnote(node.attrs);
    if (attrs) out.push({ type: "footnote", attrs });
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

const INLINE_TYPES = new Set(["text", "footnote", "hardBreak"]);

// Every paragraph inside a block-level node. A heading or a list item pasted in
// from somewhere else becomes the paragraph its words were in.
function collectParagraphs(node, out, depth = 0) {
  if (!isObject(node) || depth > 20) return;
  const children = Array.isArray(node.content) ? node.content : [];
  if (
    node.type === "paragraph" ||
    children.some((child) => INLINE_TYPES.has(child?.type))
  ) {
    const inline = [];
    for (const child of children) collectInline(child, inline);
    out.push(inline.length ? { type: "paragraph", content: inline } : P());
    return;
  }
  for (const child of children) collectParagraphs(child, out, depth + 1);
}

function P() {
  return { type: "paragraph" };
}

/**
 * Text block content in its exact stored shape, or null when the value isn't
 * a document at all.
 *
 * Drops every node and mark outside the schema (keeping the words inside
 * them), merges neighbouring runs that carry the same marks, and stores marks
 * in a fixed order. That last part matters for version history: a block's git
 * blob is a hash of its JSON, so two spellings of the same formatting must
 * normalise to the same bytes or every save would look like an edit.
 * @param {unknown} value
 * @returns {object|null}
 */
export function normalizeTextContent(value) {
  if (!isObject(value) || value.type !== "doc") return null;
  const paragraphs = [];
  for (const child of Array.isArray(value.content) ? value.content : []) {
    collectParagraphs(child, paragraphs);
  }
  return {
    type: "doc",
    content: (paragraphs.length ? paragraphs : [P()]).map(storedParagraph),
  };
}

// Marks are omitted from a run that has none, the way tiptap writes them.
function storedParagraph(paragraph) {
  if (!paragraph.content) return paragraph;
  return {
    type: "paragraph",
    content: paragraph.content.map((node) =>
      node.type === "text" && node.marks.length === 0
        ? { type: "text", text: node.text }
        : node.type === "text"
          ? {
              type: "text",
              text: node.text,
              marks: node.marks.map((type) => ({ type })),
            }
          : node,
    ),
  };
}

/**
 * Plain text as a content document: one paragraph per line.
 * @param {string} text
 * @returns {object}
 */
export function textToContent(text) {
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
 * A text block's content, whichever of the two shapes it is stored in.
 * @param {object} block
 * @returns {object}
 */
export function textBlockContent(block) {
  return normalizeTextContent(block?.content) ?? textToContent(block?.text);
}

// The paragraphs of a document as arrays of normalised inline nodes, with each
// text run's marks as an array of names.
function inlineParagraphs(content) {
  const doc = normalizeTextContent(content) ?? textToContent("");
  return doc.content.map((paragraph) =>
    (paragraph.content || []).map((node) =>
      node.type === "text" ? { ...node, marks: marksOf(node) } : node,
    ),
  );
}

function paragraphPlain(inline) {
  return inline
    .filter((node) => node.type === "text")
    .map((node) => node.text)
    .join("");
}

/**
 * A text block as plain lines, one per paragraph, without formatting or
 * footnote markers. The same lines `text` would have held.
 * @param {object} block
 * @returns {string[]}
 */
export function textBlockLines(block) {
  return inlineParagraphs(textBlockContent(block)).map(paragraphPlain);
}

/**
 * A text block as plain text, paragraphs joined by newlines. This is what every
 * plain-text reader of a lesson wants: summaries, search, spelling-word
 * extraction, the read-aloud voice, the MCP server's grounding checks.
 * @param {object} block
 * @returns {string}
 */
export function textBlockPlain(block) {
  return textBlockLines(block).join("\n");
}

/**
 * Whether a text block has any words in it.
 * @param {object} block
 * @returns {boolean}
 */
export function textBlockHasContent(block) {
  return (
    Boolean(textBlockPlain(block).trim()) ||
    textBlockFootnotes(block).length > 0
  );
}

/**
 * A text block's paragraphs as runs a renderer can draw directly:
 *   { type: "text", text, bold, italic, underline }
 *   { type: "footnote", sourceId, locator, note, index }
 * `index` counts footnotes within the block, from 0, in reading order.
 * @param {object} block
 * @returns {Array<Array<object>>}
 */
export function textBlockParagraphs(block) {
  let index = 0;
  return inlineParagraphs(textBlockContent(block)).map((inline) =>
    inline.map((node) =>
      node.type === "text"
        ? {
            type: "text",
            text: node.text,
            bold: node.marks.includes("bold"),
            italic: node.marks.includes("italic"),
            underline: node.marks.includes("underline"),
          }
        : { type: "footnote", ...node.attrs, index: index++ },
    ),
  );
}

/**
 * A text block's footnotes, in reading order.
 * @param {object} block
 * @returns {Array<{ sourceId: string|null, locator: string, note: string }>}
 */
export function textBlockFootnotes(block) {
  return inlineParagraphs(textBlockContent(block))
    .flat()
    .filter((node) => node.type === "footnote")
    .map((node) => node.attrs);
}

/**
 * How many footnotes come before each text block, keyed by block id. A
 * footnote's number is its block's start plus its own index plus one.
 * @param {object} doc
 * @returns {Map<string, number>}
 */
export function footnoteStarts(doc) {
  const starts = new Map();
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

/**
 * Every footnote in the lesson, numbered in reading order, with where it sits.
 * @param {object} doc
 * @returns {Array<{ number: number, blockId: string, si: number, bi: number,
 *   index: number, sourceId: string|null, locator: string, note: string }>}
 */
export function lessonFootnotes(doc) {
  const out = [];
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
 * @param {{ sourceId: string|null, locator: string, note: string }} footnote
 * @param {Map<string, object>} sources  From sourcesById().
 * @param {{ note?: string }} [options]
 * @returns {Array<{ text: string, italic?: boolean, url?: string, role?: string }>}
 *   The note's run is tagged `role: "note"` and a locator's `role: "locator"`,
 *   which the Word export turns into styles the importer reads back.
 */
export function footnoteParts(footnote, sources, { note } = {}) {
  const parts = [];
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
export function footnoteText(footnote, sources) {
  return partsText(footnoteParts(footnote, sources));
}

/**
 * A text block holding this content, in the smaller of the two shapes: plain
 * `text` when nothing in it is formatted, `content` otherwise. For writers that
 * replace a block whole (importers, the MCP server).
 *
 * Not for the editor: see withTextBlockDocument.
 * @param {object} block    The block being replaced (its id and type are kept).
 * @param {object} content
 * @returns {object}
 */
export function withTextBlockContent(block, content) {
  const normalized = normalizeTextContent(content) ?? textToContent("");
  // Dropping both fields first, so a block never carries a stale copy of one.
  const rest = { ...block };
  delete rest.text;
  delete rest.content;
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
 * collaboration document (ydoc.js) merges a block key by key, so if one person's
 * edit wrote `content` while another's wrote `text`, both keys would survive the
 * merge and `content` would silently hide the other edit. Once the editor has
 * touched a block it only ever writes `content`, so two people editing one block
 * write the same key, and the usual last-write-wins applies to the whole text.
 * @param {object} block
 * @param {object} content
 * @returns {object}
 */
export function withTextBlockDocument(block, content) {
  const rest = { ...block };
  delete rest.text;
  delete rest.content;
  return {
    ...rest,
    content: normalizeTextContent(content) ?? textToContent(""),
  };
}

/**
 * Whether content has nothing a plain string couldn't hold.
 * @param {object} content
 * @returns {boolean}
 */
export function isPlainContent(content) {
  return inlineParagraphs(content).every((inline) =>
    inline.every((node) => node.type === "text" && node.marks.length === 0),
  );
}

/**
 * The lesson with every citation of one source taken out of its text blocks.
 * A footnote that also carries a note keeps the note; one that only cited the
 * source goes. Blocks with nothing to change are returned as they were, so
 * memoised cards stay memoised.
 * @param {object} doc
 * @param {string} sourceId
 * @returns {object}
 */
export function removeSourceCitations(doc, sourceId) {
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
function mapFootnotes(content, fn) {
  return {
    ...content,
    content: content.content.map((paragraph) =>
      paragraph.content
        ? {
            ...paragraph,
            content: paragraph.content.flatMap((node) => {
              if (node.type !== "footnote") return [node];
              const attrs = fn(node.attrs);
              return attrs ? [{ ...node, attrs }] : [];
            }),
          }
        : paragraph,
    ),
  };
}

/**
 * The formatted spans of a text block, for the MCP server's check that an
 * assistant hasn't scattered bold and italics through a passage. A span is a
 * run of formatted text with nothing plain inside it: "**bold *and italic***"
 * is one span carrying both marks, because it reads as one formatted phrase.
 * @param {object} block
 * @returns {{ spans: Array<{ text: string, marks: string[] }>, totalChars: number }}
 */
export function textBlockFormattedSpans(block) {
  const spans = [];
  let totalChars = 0;
  for (const inline of inlineParagraphs(textBlockContent(block))) {
    let current = null;
    const finish = () => {
      if (current && current.text.trim()) {
        spans.push({
          text: current.text.trim(),
          marks: TEXT_MARKS.filter((mark) => current.marks.has(mark)),
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
//
// One line is one paragraph. A backslash makes the next character literal, so
// \* is an asterisk. contentToMarkup escapes whatever needs it, so text read
// out of a lesson can be written straight back.

/**
 * A content document as markup.
 * @param {object} content
 * @returns {string}
 */
export function contentToMarkup(content) {
  return inlineParagraphs(content).map(paragraphToMarkup).join("\n");
}

/** A text block as markup, whichever shape it is stored in. */
export function textBlockMarkup(block) {
  return contentToMarkup(textBlockContent(block));
}

const MARK_SYNTAX = {
  bold: ["**", "**"],
  italic: ["*", "*"],
  underline: ["<u>", "</u>"],
};

function paragraphToMarkup(inline) {
  let out = "";
  let open = [];
  const close = (keep) => {
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
    close(node.marks);
    for (const mark of node.marks) {
      if (!open.includes(mark)) {
        out += MARK_SYNTAX[mark][0];
        open.push(mark);
      }
    }
    out += escapeText(node.text);
  }
  close([]);
  return out;
}

function escapeText(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\*/g, "\\*")
    .replace(/\^\[/g, "\\^[")
    .replace(/<(\/?u>)/gi, "\\<$1");
}

function escapeNote(text) {
  return text.replace(/[\\[\]|]/g, (ch) => `\\${ch}`);
}

function footnoteToMarkup({ sourceId, locator, note }) {
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
 * @param {string} markup
 * @returns {object}
 */
export function markupToContent(markup) {
  const lines = String(markup ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  return normalizeTextContent({
    type: "doc",
    content: lines.map(parseParagraph),
  });
}

function parseParagraph(line) {
  const tokens = tokenize(line);
  resolveUnpaired(tokens);
  const marks = new Set();
  const content = [];
  for (const token of tokens) {
    if (token.kind === "text") {
      content.push({
        type: "text",
        text: token.text,
        marks: [...marks].map((type) => ({ type })),
      });
    } else if (token.kind === "footnote") {
      content.push({ type: "footnote", attrs: token.attrs });
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

function tokenize(line) {
  const tokens = [];
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
function closingBracket(line, from) {
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

// Turn markers that have no partner back into the characters they were written
// as. Bold and italic pair by count (the last of an odd number is literal);
// underline pairs an opening tag with the next closing one.
function resolveUnpaired(tokens) {
  for (const kind of ["bold", "italic"]) {
    const at = tokens
      .map((token, i) => (token.kind === kind ? i : -1))
      .filter((i) => i !== -1);
    if (at.length % 2 === 1) {
      const last = at[at.length - 1];
      tokens[last] = { kind: "text", text: tokens[last].raw };
    }
  }
  let pending = -1;
  tokens.forEach((token, i) => {
    if (token.kind === "u-open") {
      if (pending !== -1) {
        tokens[pending] = { kind: "text", text: tokens[pending].raw };
      }
      pending = i;
    } else if (token.kind === "u-close") {
      if (pending === -1) tokens[i] = { kind: "text", text: token.raw };
      pending = -1;
    }
  });
  if (pending !== -1) {
    tokens[pending] = { kind: "text", text: tokens[pending].raw };
  }
}

// Split at the first unescaped `ch`: [before, after], or [whole, null].
function splitUnescaped(text, ch) {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") {
      i += 1;
    } else if (text[i] === ch) {
      return [text.slice(0, i), text.slice(i + 1)];
    }
  }
  return [text, null];
}

function unescape(text) {
  return text.replace(/\\(.)/g, "$1");
}

function parseFootnoteBody(body) {
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

/**
 * The source ids a piece of markup cites, in order of first appearance.
 * @param {string} markup
 * @returns {string[]}
 */
export function markupSourceIds(markup) {
  const ids = [];
  for (const paragraph of inlineParagraphs(markupToContent(markup))) {
    for (const node of paragraph) {
      if (node.type === "footnote" && node.attrs.sourceId) {
        if (!ids.includes(node.attrs.sourceId)) ids.push(node.attrs.sourceId);
      }
    }
  }
  return ids;
}
