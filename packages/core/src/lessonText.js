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
// three. speech.js turns them into what the voices are given.
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
// MathML MathJax makes of it (speech.js); as plain text it is its source,
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

/** How long a pause can be: about a comma's worth, or clearly longer. */
export const PAUSE_LENGTHS = ["short", "long"];

/** The one way a run can be spelled out: a character at a time. */
export const SAY_AS_CHARACTERS = "characters";

const IPA_LIMIT = 200;
const ALIAS_LIMIT = 500;

/**
 * A speech hint in its exact stored shape, or null when it says nothing.
 * Exactly one of `ipa`, `alias` and `sayAs` survives, in that order of
 * preference. IPA is often copied with the slashes or brackets dictionaries
 * put around it, which are not sounds, so they are dropped.
 * @param {unknown} attrs
 * @returns {{ ipa: string }|{ alias: string }|{ sayAs: "characters" }|null}
 */
export function normalizeSpeechHint(attrs) {
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
export const FORMULA_FORMATS = ["asciimath", "tex"];

const FORMULA_LIMIT = 2000;
const SPOKEN_LIMIT = 1000;

/**
 * Spoken text (what read-aloud says for something) in its stored shape: a
 * plain string, or a list of runs that are strings, text runs with one speech
 * hint, and pauses. A run object with none of those is said as its text, as
 * the format asks, and dropped without any. Returns null for nothing to say.
 * @param {unknown} value
 * @returns {string | Array<string | object> | null}
 */
export function normalizeSpokenText(value) {
  const runs = [];
  const pushWords = (text) => {
    if (!text) return;
    if (typeof runs[runs.length - 1] === "string")
      runs[runs.length - 1] += text;
    else runs.push(text);
  };
  // Spaces are kept, even at a run's edges: they are what keep the words of
  // neighboring runs apart. Only a line break has no place in spoken text.
  const spokenLine = (text) =>
    typeof text === "string"
      ? text.replace(/[\r\n]+/g, " ").slice(0, SPOKEN_LIMIT)
      : "";
  for (const run of Array.isArray(value) ? value : [value]) {
    if (typeof run === "string") {
      pushWords(spokenLine(run));
    } else if (isObject(run) && PAUSE_LENGTHS.includes(run.pause)) {
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
  return runs.length === 1 && typeof runs[0] === "string" ? runs[0] : runs;
}

/**
 * A formula's attributes in their exact stored shape, or null when there is
 * no formula (no source). A format this version doesn't know is kept, as the
 * format asks, so the formula survives a save; renderers show its source.
 * @param {unknown} attrs
 * @returns {{ format: string, source: string, display: boolean, spoken: string | object[] | null }|null}
 */
export function normalizeFormula(attrs) {
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

function marksOf(node) {
  if (!Array.isArray(node?.marks)) return [];
  const present = new Set(
    node.marks.map((mark) => (typeof mark === "string" ? mark : mark?.type)),
  );
  return TEXT_MARKS.filter((mark) => present.has(mark));
}

// The speech hint a text node's marks carry, or null.
function speechOf(node) {
  if (!Array.isArray(node?.marks)) return null;
  const mark = node.marks.find((m) => isObject(m) && m.type === "speech");
  return mark ? normalizeSpeechHint(mark.attrs) : null;
}

function sameMarks(a, b) {
  return a.length === b.length && a.every((mark, i) => mark === b[i]);
}

function sameSpeech(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
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
    const length = PAUSE_LENGTHS.includes(node.attrs?.length)
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

const INLINE_TYPES = new Set([
  "text",
  "footnote",
  "pause",
  "math",
  "hardBreak",
]);

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
 * them), merges neighboring runs that carry the same marks, and stores marks
 * in a fixed order. That last part matters for version history: a block's git
 * blob is a hash of its JSON, so two spellings of the same formatting must
 * normalize to the same bytes or every save would look like an edit.
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

// Marks are omitted from a run that has none, the way tiptap writes them. The
// speech mark comes after the formatting marks.
function storedParagraph(paragraph) {
  if (!paragraph.content) return paragraph;
  return {
    type: "paragraph",
    content: paragraph.content.map((node) => {
      if (node.type !== "text") return node;
      const marks = node.marks.map((type) => ({ type }));
      if (node.speech) marks.push({ type: "speech", attrs: node.speech });
      return marks.length
        ? { type: "text", text: node.text, marks }
        : { type: "text", text: node.text };
    }),
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

// The paragraphs of a document as arrays of normalized inline nodes, with each
// text run's formatting marks as an array of names and its speech hint (or
// null) as `speech`.
function inlineParagraphs(content) {
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
function paragraphPlain(inline) {
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
 *   { type: "text", text, bold, italic, underline, speech }
 *   { type: "footnote", sourceId, locator, note, index }
 *   { type: "pause", length }
 *   { type: "math", format, source, display, spoken }
 * `index` counts footnotes within the block, from 0, in reading order.
 * `speech` is the run's speech hint, present only when it has one (see
 * normalizeSpeechHint). Renderers that show or print
 * the lesson draw the text and ignore `speech` and pauses, which only
 * read-aloud uses, and draw a formula with MathJax (or as its source).
 * @param {object} block
 * @returns {Array<Array<object>>}
 */
export function textBlockParagraphs(block) {
  let index = 0;
  return inlineParagraphs(textBlockContent(block)).map((inline) =>
    inline.map((node) => {
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

function escapeText(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\*/g, "\\*")
    .replace(/\^\[/g, "\\^[")
    .replace(/\{/g, "\\{")
    .replace(/<(\/?u>)/gi, "\\<$1");
}

function speechToMarkup(text, speech) {
  const words = text.replace(/[\\\]]/g, (ch) => `\\${ch}`);
  const value = (v) => v.replace(/[\\}]/g, (ch) => `\\${ch}`);
  const body = speech.ipa
    ? `ipa: ${value(speech.ipa)}`
    : speech.alias
      ? `say: ${value(speech.alias)}`
      : "spell";
  return `[${words}]{${body}}`;
}

// The formula's source goes in as it is (see the note on braces above), or,
// when its braces don't balance (a TeX `\left\{ ... \right.`), with
// `escaped` after the notation and a backslash before each brace and
// backslash. Its spoken words, if any, follow in their own braces, flattened
// to words.
function formulaToMarkup({ format, source, display, spoken }) {
  const escaped = balancingBrace(`${source}}`, 0) !== source.length;
  const flags = `${display ? " display" : ""}${escaped ? " escaped" : ""}`;
  const body = escaped ? source.replace(/[\\{}]/g, (ch) => `\\${ch}`) : source;
  let out = `{${format}${flags}: ${body}}`;
  const words = spokenWordsOf(spoken);
  if (words) out += `{spoken: ${words.replace(/[\\}]/g, (ch) => `\\${ch}`)}}`;
  return out;
}

/**
 * Spoken text as it reads: its words, each run's text, nothing for a pause.
 * @param {string | Array<string | object> | null | undefined} spoken
 * @returns {string}
 */
export function spokenWordsOf(spoken) {
  if (typeof spoken === "string") return spoken;
  if (!Array.isArray(spoken)) return "";
  return spoken
    .map((run) => (typeof run === "string" ? run : run?.text || ""))
    .join("");
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

// The index of the `}` closing a brace opened just before `from`, or -1.
function closingBrace(line, from) {
  for (let i = from; i < line.length; i++) {
    if (line[i] === "\\") i += 1;
    else if (line[i] === "}") return i;
  }
  return -1;
}

// What follows a bracketed span: `ipa: ...`, `say: ...` or `spell`. Anything
// else means the brackets and braces were just text.
function parseSpeechBody(body) {
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
function balancingBrace(line, from) {
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
function readFormula(line, at) {
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
  const attrs = {
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
function parsePauseBody(body) {
  const match = /^\s*pause\s*(?::\s*(short|long)\s*)?$/i.exec(body);
  if (!match) return null;
  return (match[1] || "short").toLowerCase();
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
