// Best-effort import of a Word .docx back into the lesson model. This is the
// inverse of docxExport.js, and it is deliberately lossy: we run the file
// through mammoth (docx → semantic HTML, the same converter the preview uses),
// then walk that HTML and rebuild the blocks our editor understands.
//
// It is tuned for documents this app produced — the exporter emits a recognised
// shape (a bold title paragraph, question prompts carrying a per-type Word
// character style, a "Spell:" line listing the words). Files authored elsewhere
// import only as well as they happen to match that shape; anything we can't
// recognise degrades to plain text, and a document with no readable content is
// rejected (see validateImportedDoc) so we never open an unusable lesson.
//
// A printed lesson has no section headings and no "[Label]" in front of a
// prompt, so neither is available to read the structure back off. Question types
// come from the character styles instead — questionStyleMap() tells mammoth to
// surface them as `<span class="s2c-q-…">`. Section *divisions* have nothing
// left to carry them, so a document that uses no headings arrives as a single
// section; Export/Import JSON is the lossless round trip.
//
// Text keeps its bold, italics and underlining, and Word footnotes (and
// endnotes) come back as footnotes. The Sources list our exporter prints is
// recognised by its paragraph styles and read back into the lesson's sources;
// a footnote whose text is exactly how the exporter cites one of them becomes
// a citation of it again, and any other footnote is kept as a note.
import mammoth from "mammoth";
import { newId } from "../id.js";
import {
  QUESTION_TYPE_LIST,
  questionStyleClass,
  questionStyleMap,
} from "../questions.js";
import { SPELLING_LABEL } from "../spelling.js";
import { isSafeLink } from "../richText.js";
import {
  CAPTION_CLASS,
  CAPTION_STYLE_NAME,
  FOOTNOTE_LOCATOR_CLASS,
  FOOTNOTE_LOCATOR_STYLE_NAME,
  FOOTNOTE_NOTE_CLASS,
  FOOTNOTE_NOTE_STYLE_NAME,
  SOURCE_ENTRY_CLASS,
  SOURCE_ENTRY_STYLE_NAME,
  SOURCES_HEADING_CLASS,
  SOURCES_HEADING_STYLE_NAME,
} from "../lessonLayout.js";
import {
  normalizeTextContent,
  textBlockHasContent,
  withTextBlockContent,
} from "../lessonText.js";
import { partsText, sourceCitationParts } from "../sources.js";
import {
  VAKT_DEFAULT_IMAGE_ALIGN,
  VAKT_DEFAULT_IMAGE_SIZE,
  VAKT_LABEL,
  VAKT_LINK_JOINER,
  vaktHasContent,
} from "../vakt.js";
import { DEFAULT_IMAGE_SIZE, DEFAULT_IMAGE_ALIGN } from "../image.js";
import { convertDocImages, resolveImageSrc } from "./imageRef.js";

// Thrown when a document is readable but not structured as a lesson. EditorPage
// surfaces the message to the user and refuses to load it (the "refuse to open"
// requirement). Distinct from unexpected errors so callers can tell the two
// apart if they ever want to.
export class DocxImportError extends Error {
  constructor(message) {
    super(message);
    this.name = "DocxImportError";
  }
}

// The class mammoth emits for each question style (e.g. "s2c-q-number") mapped
// back to its type key.
const CLASS_TO_TYPE = Object.fromEntries(
  QUESTION_TYPE_LIST.map((q) => [questionStyleClass(q.key), q.key]),
);

// A CSS selector matching a prompt span of any question type.
const QUESTION_SPAN_SELECTOR = QUESTION_TYPE_LIST.map(
  (q) => `span.${questionStyleClass(q.key)}`,
).join(", ");

const IMPORT_STYLE_MAP = [
  ...questionStyleMap(),
  `p[style-name='${SOURCES_HEADING_STYLE_NAME}'] => p.${SOURCES_HEADING_CLASS}:fresh`,
  `p[style-name='${SOURCE_ENTRY_STYLE_NAME}'] => p.${SOURCE_ENTRY_CLASS}:fresh`,
  `p[style-name='${CAPTION_STYLE_NAME}'] => p.${CAPTION_CLASS}:fresh`,
  `r[style-name='${FOOTNOTE_LOCATOR_STYLE_NAME}'] => span.${FOOTNOTE_LOCATOR_CLASS}`,
  `r[style-name='${FOOTNOTE_NOTE_STYLE_NAME}'] => span.${FOOTNOTE_NOTE_CLASS}`,
  // mammoth drops underlining unless asked to keep it.
  "u => u",
];

// Read a .docx File and rebuild a lesson document. Resolves to a doc shaped like
// { title, sections } ready for the editor; rejects (DocxImportError) when the
// file isn't a usable lesson.
export async function importDocxFile(file) {
  if (!file) throw new DocxImportError("No file was selected.");
  if (!/\.docx$/i.test(file.name || "")) {
    throw new DocxImportError(
      "Please choose a Word .docx file. Older .doc files and other formats aren't supported.",
    );
  }

  let html;
  try {
    const arrayBuffer = await file.arrayBuffer();
    // The style map is what carries each question's type through the conversion,
    // now that nothing in the visible text names it.
    const result = await mammoth.convertToHtml(
      { arrayBuffer },
      { styleMap: IMPORT_STYLE_MAP },
    );
    html = result.value || "";
  } catch {
    throw new DocxImportError(
      "This file couldn't be read as a Word document. It may be corrupted or not a real .docx file.",
    );
  }

  if (!html.trim()) {
    throw new DocxImportError("This Word document appears to be empty.");
  }

  const doc = parseHtmlToDoc(html, file.name);
  validateImportedDoc(doc);
  // Measure while the images still carry their base64 `src`, then convert each
  // to a binary blob + hash ref so the imported lesson matches the new model.
  await measureImages(doc);
  return convertDocImages(doc);
}

// Walk mammoth's HTML and rebuild the lesson. We iterate the body's block-level
// children in order; question and spelling blocks greedily consume the metadata
// paragraphs that follow their heading, so the loop index is advanced past them.
function parseHtmlToDoc(html, fileName) {
  const dom = new DOMParser().parseFromString(html, "text/html");
  // The footnote lists come out first: they aren't lesson content, they are
  // what the footnote markers in the text point at.
  const notes = takeNotes(dom);
  const nodes = Array.from(dom.body.children);
  const sources = [];
  // A file this app exported since captions were given their own style says
  // which paragraphs are captions; an older one leaves it to the shape.
  const styledCaptions = Boolean(dom.querySelector(`p.${CAPTION_CLASS}`));
  const captionOf = (el) => captionText(el, styledCaptions);

  // Decide which heading levels act as section dividers. Our own exports use
  // `<h2>`; we also accept `<h3>`, and fall back to `<h1>` for documents that
  // only use top-level headings (with the first one taken as the title).
  const hasTag = (t) => nodes.some((n) => n.tagName.toLowerCase() === t);
  const h1Count = nodes.filter((n) => n.tagName.toLowerCase() === "h1").length;
  const sectionLevels =
    hasTag("h2") || hasTag("h3")
      ? new Set(["h2", "h3"])
      : h1Count >= 2
        ? new Set(["h1"])
        : new Set();

  let title = "";
  const sections = [];
  let current = null;

  const startSection = (name) => {
    current = { id: newId(), name: name || "Untitled section", blocks: [] };
    sections.push(current);
  };
  // Content that appears before the first heading still needs a home.
  const ensureSection = () => {
    if (!current) startSection("Imported section");
    return current;
  };
  // Text blocks gather paragraphs as they go and become real blocks at the end
  // (finishTextBlocks), once the sources their footnotes may cite are known.
  const pushParagraph = (inline) => {
    const section = ensureSection();
    const last = section.blocks[section.blocks.length - 1];
    if (last && last.type === "text" && last.paragraphs) {
      last.paragraphs.push(inline);
    } else {
      section.blocks.push({ id: newId(), type: "text", paragraphs: [inline] });
    }
  };
  const pushText = (text) => pushParagraph([{ type: "text", text }]);

  for (let i = 0; i < nodes.length; i += 1) {
    const el = nodes[i];
    const tag = el.tagName.toLowerCase();
    const text = el.textContent.trim();

    // Headings: either a section divider or, failing that, plain text.
    if (tag === "h1") {
      if (!title && current === null && sections.length === 0) {
        title = text;
        continue;
      }
      if (sectionLevels.has("h1")) startSection(text);
      else pushText(text);
      continue;
    }
    if (/^h[2-6]$/.test(tag)) {
      if (sectionLevels.has(tag)) startSection(text);
      else if (text) pushText(text);
      continue;
    }

    // Images (a `<p>` wrapping an `<img>`) — checked before the empty-text skip
    // below, since the wrapping paragraph has no text of its own.
    const img = el.querySelector?.("img");
    if (img?.getAttribute("src")) {
      ensureSection();
      const caption = captionOf(nodes[i + 1]);
      current.blocks.push(imageBlock(img, caption));
      if (caption) i += 1; // consume the caption paragraph
      continue;
    }

    // Real lists (not produced by our exporter, but common elsewhere) — keep the
    // items as text so nothing is silently dropped.
    if (tag === "ul" || tag === "ol") {
      const items = Array.from(el.querySelectorAll("li"))
        .map((li) => li.textContent.trim())
        .filter(Boolean);
      if (items.length) pushText(items.join("\n"));
      continue;
    }

    if (tag !== "p") {
      if (text) pushText(text); // tables etc. → their text
      continue;
    }

    if (el.classList.contains(SOURCES_HEADING_CLASS)) continue;
    if (el.classList.contains(SOURCE_ENTRY_CLASS)) {
      const source = readSource(el);
      if (source) sources.push(source);
      continue;
    }

    if (!text && !el.querySelector("sup")) continue; // stray empty paragraph

    // A leading bold-only paragraph before any content is the document title
    // (that's how the exporter emits it — Word's Title style, which mammoth
    // renders as a bold paragraph rather than a heading).
    if (
      !title &&
      current === null &&
      sections.length === 0 &&
      isBoldOnly(el) &&
      !matchQuestion(el) &&
      !isSpellingHeading(text) &&
      !isVaktHeading(text)
    ) {
      title = text;
      continue;
    }

    if (isSpellingHeading(text)) {
      ensureSection();
      const { block, next } = readSpelling(nodes, i);
      current.blocks.push(block);
      i = next;
      continue;
    }

    if (isVaktHeading(text)) {
      ensureSection();
      const { block, next } = readVakt(nodes, i, captionOf);
      current.blocks.push(block);
      i = next;
      continue;
    }

    const question = matchQuestion(el);
    if (question) {
      ensureSection();
      const { block, next } = readQuestion(nodes, i, question);
      current.blocks.push(block);
      i = next;
      continue;
    }

    pushParagraph(inlineContent(el, notes));
  }

  finishTextBlocks(sections, sources);
  return {
    title: title || stripExtension(fileName) || "Imported lesson",
    ...(sources.length ? { sources } : {}),
    sections,
  };
}

// Every footnote and endnote, keyed by the id its marker links to
// ("footnote-1"), with the lists themselves removed from the document. Each is
// { text } for a note from anywhere, plus { cite, locator, note } when the
// exporter marked its parts with their styles (see footnoteParts), which is
// what lets a citation be read back exactly.
function takeNotes(dom) {
  const notes = new Map();
  const items = dom.body.querySelectorAll(
    'li[id^="footnote-"], li[id^="endnote-"]',
  );
  const lists = new Set();
  for (const li of items) {
    // The arrow mammoth adds to lead back to the marker.
    for (const back of li.querySelectorAll(
      'a[href^="#footnote-ref-"], a[href^="#endnote-ref-"]',
    )) {
      back.remove();
    }
    notes.set(li.id, readNote(li));
    if (li.parentElement) lists.add(li.parentElement);
  }
  for (const list of lists) list.remove();
  return notes;
}

const squash = (text) => text.replace(/\s+/g, " ").trim();

function readNote(li) {
  const text = squash(li.textContent);
  const locatorEl = li.querySelector(`span.${FOOTNOTE_LOCATOR_CLASS}`);
  const noteEl = li.querySelector(`span.${FOOTNOTE_NOTE_CLASS}`);
  if (!locatorEl && !noteEl) return { text };

  // What's left once the locator and note are lifted out is the citation,
  // closed by the full stop the exporter puts after it.
  const rest = li.cloneNode(true);
  for (const el of rest.querySelectorAll(
    `span.${FOOTNOTE_LOCATOR_CLASS}, span.${FOOTNOTE_NOTE_CLASS}`,
  )) {
    el.remove();
  }
  return {
    text,
    cite: squash(rest.textContent).replace(/\.$/, ""),
    locator: locatorEl
      ? squash(locatorEl.textContent).replace(/^,\s*/, "")
      : "",
    note: noteEl ? squash(noteEl.textContent) : "",
  };
}

// A paragraph's words as content: formatting from the tags mammoth writes, and
// a footnote wherever a marker links into the notes.
function inlineContent(el, notes) {
  const out = [];
  const walk = (node, marks) => {
    if (node.nodeType === 3) {
      if (node.nodeValue) {
        out.push({
          type: "text",
          text: node.nodeValue,
          marks: [...marks].map((type) => ({ type })),
        });
      }
      return;
    }
    if (node.nodeType !== 1) return;
    const link = node.matches('a[href^="#footnote-"], a[href^="#endnote-"]')
      ? node
      : node.tagName === "SUP"
        ? node.querySelector('a[href^="#footnote-"], a[href^="#endnote-"]')
        : null;
    if (link) {
      const note = notes.get(link.getAttribute("href").slice(1));
      if (note?.text) out.push({ type: "footnote", note });
      return;
    }
    const next = new Set(marks);
    const tag = node.tagName;
    if (tag === "STRONG" || tag === "B") next.add("bold");
    if (tag === "EM" || tag === "I") next.add("italic");
    if (tag === "U") next.add("underline");
    for (const child of node.childNodes) walk(child, next);
  };
  for (const child of el.childNodes) walk(child, new Set());

  // Trim the paragraph's outer whitespace, as the plain-text path always has.
  const first = out.find((node) => node.type === "text");
  if (first) first.text = first.text.replace(/^\s+/, "");
  const last = [...out].reverse().find((node) => node.type === "text");
  if (last) last.text = last.text.replace(/\s+$/, "");
  return out;
}

// One entry of the exporter's Sources list: "Author. Title. Publisher, Year.
// https://...", with the title in italics and the address a link.
function readSource(el) {
  const em = el.querySelector("em, i");
  const link = el.querySelector("a[href]");
  const full = el.textContent.replace(/\s+/g, " ").trim();
  if (!full) return null;

  const url =
    link && isSafeLink(link.getAttribute("href"))
      ? link.getAttribute("href")
      : "";
  // The words between two points in the paragraph. The title and the link are
  // found by where their elements sit, not by searching for their text, which
  // could match inside the author ("Egypt Society" writing "Egypt").
  const textBetween = (setStart, setEnd) => {
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(el);
    setStart?.(range);
    setEnd?.(range);
    return range.toString().replace(/\s+/g, " ");
  };
  const linkAfterTitle =
    link && url && (!em || em.compareDocumentPosition(link) & 4) ? link : null;
  const endAtLink = linkAfterTitle
    ? (range) => range.setEndBefore(linkAfterTitle)
    : null;

  let title = em ? em.textContent.trim() : "";
  let author = "";
  let details;
  if (title) {
    author = textBetween(null, (range) => range.setEndBefore(em))
      .trim()
      .replace(/\.$/, "");
    details = textBetween((range) => range.setStartAfter(em), endAtLink);
  } else if (url) {
    details = textBetween(null, endAtLink);
  } else {
    // No italics and no link: not one of ours. Keep the words as the title.
    title = full;
    details = "";
  }
  details = details.replace(/^[.\s]+|[.\s]+$/g, "");

  const comma = details.lastIndexOf(", ");
  const tail = comma === -1 ? details : details.slice(comma + 2);
  const hasYear = /^(?:c\.\s*)?\d{3,4}\b/.test(tail);
  return {
    id: newId(),
    title,
    author,
    publisher: hasYear
      ? comma === -1
        ? ""
        : details.slice(0, comma)
      : details,
    year: hasYear ? tail : "",
    url,
  };
}

// Turn each gathered text block into a stored one, matching footnotes against
// the sources read off the end of the document.
function finishTextBlocks(sections, sources) {
  for (const section of sections) {
    section.blocks = section.blocks.map((block) => {
      if (block.type !== "text" || !block.paragraphs) return block;
      const content = normalizeTextContent({
        type: "doc",
        content: block.paragraphs.map((inline) => ({
          type: "paragraph",
          content: inline.map((node) =>
            node.type === "footnote"
              ? { type: "footnote", attrs: citationFor(node.note, sources) }
              : node,
          ),
        })),
      });
      return withTextBlockContent({ id: block.id, type: "text" }, content);
    });
  }
}

// A footnote read back as a citation of one of the sources, or as a note.
//
// A note whose parts the exporter styled (see readNote) is exact: the citation
// either matches how one of the sources is cited or it doesn't. An unstyled
// note (a file from before the styles, or from anywhere else) is only matched
// in the two shapes that can't be misread: the citation alone, or the citation
// then a note. A locator can't be told from a note without the styles ("p. 12"
// has a full stop in it), so anything else stays a note with its words intact.
function citationFor(note, sources) {
  const citeOf = (source) =>
    partsText(sourceCitationParts(source)).replace(/\.$/, "");

  if (note.cite !== undefined) {
    const source = note.cite
      ? sources.find((s) => citeOf(s) && citeOf(s) === note.cite)
      : null;
    if (source) {
      return { sourceId: source.id, locator: note.locator, note: note.note };
    }
    return { sourceId: null, note: note.text };
  }

  for (const source of sources) {
    const cite = citeOf(source);
    if (!cite) continue;
    if (note.text === `${cite}.`) return { sourceId: source.id, note: "" };
    if (note.text.startsWith(`${cite}. `)) {
      return { sourceId: source.id, note: note.text.slice(cite.length + 2) };
    }
  }
  return { sourceId: null, note: note.text };
}

// True when the paragraph's entire content is a single <strong> (our title and
// question prompts look like this).
function isBoldOnly(el) {
  return el.children.length === 1 && el.children[0].tagName === "STRONG";
}

// The text of the paragraph under a picture when it is that picture's caption,
// or "". A file with styled captions says so outright. In an older one a caption
// is a paragraph that is one italic run and nothing else, text nodes included:
// counting only element children would take "*Felis catus* is the house cat."
// for a caption, now that text blocks keep their italics.
function captionText(el, styledCaptions) {
  if (!el || el.tagName !== "P") return "";
  if (styledCaptions) {
    return el.classList.contains(CAPTION_CLASS) ? el.textContent.trim() : "";
  }
  if (el.childNodes.length === 1 && el.firstChild.nodeName === "EM") {
    return el.textContent.trim();
  }
  return "";
}

// The exporter's spelling line is "Spell: FIRST SECOND THIRD". Older exports
// used a "Spelling words" heading above a numbered list, which readSpelling
// still understands, so both shapes import.
function isSpellingHeading(text) {
  return (
    /^spelling words$/i.test(text) ||
    text.toLowerCase().startsWith(SPELLING_LABEL.toLowerCase())
  );
}

// Read a question off a paragraph whose prompt carries one of our question
// character styles: `<p><span class="s2c-q-single">prompt</span>  answer</p>`.
// Returns { type, prompt, answer } or null when the paragraph isn't one.
function matchQuestion(el) {
  const span = el.querySelector?.(QUESTION_SPAN_SELECTOR);
  if (!span) return null;
  const type = matchQuestionClass(span);
  if (!type) return null;

  // Whatever follows the prompt span in the same paragraph is the answer the
  // exporter wrote in the body colour.
  let answer = "";
  for (let node = span.nextSibling; node; node = node.nextSibling) {
    answer += node.textContent || "";
  }
  return { type, prompt: span.textContent.trim(), answer: answer.trim() };
}

function matchQuestionClass(span) {
  for (const name of span.classList) {
    if (CLASS_TO_TYPE[name]) return CLASS_TO_TYPE[name];
  }
  return null;
}

// Build a question block from its prompt paragraph. The answer travelled inline
// with the prompt; only a number question's working-out spills onto the indented
// paragraphs that follow. Returns { block, next } where `next` is the index of
// the last node consumed (so the caller resumes after it).
function readQuestion(nodes, i, { type, prompt, answer }) {
  const block = { id: newId(), type: "question", questionType: type, prompt };
  let last = i;

  if (type === "number") {
    block.answer = answer;
    block.steps = [];
    // Numbered working-out lines written under the question.
    let k = i + 1;
    for (;;) {
      const el = nodes[k];
      if (!el || el.tagName.toLowerCase() !== "p") break;
      const text = el.textContent.trim();
      if (!/^\d+\.\s*/.test(text)) break;
      const step = text.replace(/^\d+\.\s*/, "").trim();
      if (step) block.steps.push({ id: newId(), text: step });
      last = k;
      k += 1;
    }
  } else if (type === "single" || type === "background") {
    block.answer = answer;
  } else if (type === "multiple" || type === "multiple_open") {
    // The exporter joins the accepted answers with a run of spaces, which is the
    // only thing left to split them on. An answer containing a double space
    // would be split in two — a known limit of the lossy DOCX round trip.
    block.answers = answer
      .split(/\s{2,}/)
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => ({ id: newId(), text }));
    if (block.answers.length === 0) {
      block.answers.push({ id: newId(), text: "" });
    }
  }

  return { block, next: last };
}

// Build a spelling block from either shape: the current "Spell: FIRST SECOND"
// line, or the older "Spelling words" heading followed by numbered (or
// bulleted/list) word paragraphs.
function readSpelling(nodes, i) {
  const block = { id: newId(), type: "spelling", words: [] };
  let last = i;
  let k = i + 1;

  // "Spell: …" carries the words on its own line, separated by runs of spaces.
  // The older "Spelling words" heading has none of its own and falls through to
  // the list-reading loop below.
  const heading = nodes[i].textContent.trim();
  if (heading.toLowerCase().startsWith(SPELLING_LABEL.toLowerCase())) {
    const inline = heading.slice(SPELLING_LABEL.length).trim();
    if (inline && !/^\(no spelling words/i.test(inline)) {
      for (const word of inline.split(/\s{2,}/)) {
        const text = word.trim();
        if (text) block.words.push({ id: newId(), text });
      }
    }
    if (block.words.length === 0) block.words.push({ id: newId(), text: "" });
    return { block, next: last };
  }

  while (k < nodes.length) {
    const el = nodes[k];
    const tag = el.tagName.toLowerCase();
    const text = el.textContent.trim();
    if (tag === "p" && /^\d+\.\s+/.test(text)) {
      const word = text.replace(/^\d+\.\s+/, "").trim();
      if (word) block.words.push({ id: newId(), text: word });
      last = k;
      k += 1;
    } else if (tag === "ol" || tag === "ul") {
      Array.from(el.querySelectorAll("li")).forEach((li) => {
        const word = li.textContent.trim();
        if (word) block.words.push({ id: newId(), text: word });
      });
      last = k;
      break;
    } else if (tag === "p" && /^\(no spelling words/i.test(text)) {
      last = k; // swallow the "(no spelling words yet)" placeholder
      break;
    } else {
      break;
    }
  }

  if (block.words.length === 0) {
    block.words.push({ id: newId(), text: "" });
  }
  return { block, next: last };
}

// A VAKT activity is recognised by its label rather than by a character style.
// The style is there (the exporter writes one so the red survives to the PDF),
// but the label is in the visible text either way, which means a lesson typed by
// hand in Word imports just as well as one this app printed.
function isVaktHeading(text) {
  return text.toLowerCase().startsWith(VAKT_LABEL.toLowerCase());
}

// Build a VAKT block from its label paragraph, then greedily consume what the
// exporter writes underneath it: the activity's picture (with the italic caption
// that may follow), and one paragraph per link. Returns { block, next } where
// `next` is the index of the last node consumed.
function readVakt(nodes, i, captionOf) {
  const heading = nodes[i].textContent.trim();
  const text = heading.slice(VAKT_LABEL.length).trim();
  const block = {
    id: newId(),
    type: "vakt",
    // "(no activity yet)" is the exporter's own placeholder for an activity the
    // author never filled in — importing it as the text would turn the
    // placeholder into content.
    text: /^\(no activity yet\)$/i.test(text) ? "" : text,
    links: [],
  };
  let last = i;
  let k = i + 1;

  const img = nodes[k]?.querySelector?.("img");
  if (img?.getAttribute("src")) {
    const caption = captionOf(nodes[k + 1]);
    block.src = img.getAttribute("src");
    block.width = 0; // filled in by measureImages()
    block.height = 0;
    // The framing starts at the VAKT defaults, the way an imported image block
    // starts at the image defaults: mammoth gives us no paragraph alignment and
    // a printed width can't be told apart from a picture that was simply small,
    // so a size and alignment picked before the export can't be read back.
    block.size = VAKT_DEFAULT_IMAGE_SIZE;
    block.align = VAKT_DEFAULT_IMAGE_ALIGN;
    if (caption) {
      block.caption = caption;
      k += 1;
    }
    last = k;
    k += 1;
  }

  // Each link printed as its own paragraph, "Label — https://…" (or the bare
  // address when it had no label). Anything that isn't a link ends the block.
  while (k < nodes.length) {
    const el = nodes[k];
    if (el.tagName.toLowerCase() !== "p") break;
    const link = parseVaktLink(el.textContent.trim());
    if (!link) break;
    block.links.push(link);
    last = k;
    k += 1;
  }

  return { block, next: last };
}

// Read one printed link line back into a { id, label, url } row. The joiner is
// searched for from the right, so a label that happens to contain one survives.
function parseVaktLink(text) {
  if (!text) return null;
  const at = text.lastIndexOf(VAKT_LINK_JOINER);
  const label = at === -1 ? "" : text.slice(0, at).trim();
  const url = (
    at === -1 ? text : text.slice(at + VAKT_LINK_JOINER.length)
  ).trim();
  if (!isSafeLink(url) || /\s/.test(url)) return null;
  return { id: newId(), label, url };
}

function imageBlock(img, caption) {
  return {
    id: newId(),
    type: "image",
    src: img.getAttribute("src"),
    width: 0, // filled in by measureImages()
    height: 0,
    size: DEFAULT_IMAGE_SIZE,
    align: DEFAULT_IMAGE_ALIGN,
    ...(caption ? { caption } : {}),
  };
}

function stripExtension(name) {
  return (name || "").replace(/\.docx$/i, "").trim();
}

// Reject documents that are readable but not structured as a lesson, so the
// editor never opens an unusable import.
//
// Section headings are no longer required: an exported lesson has none, so
// demanding them would reject our own documents. What has to be there is
// readable content.
function validateImportedDoc(doc) {
  const hasContent = doc.sections.some((s) => s.blocks.some(blockHasContent));
  if (!hasContent) {
    throw new DocxImportError(
      "This Word document has no readable lesson content: no passages, questions or spelling words could be found in it.",
    );
  }
}

function blockHasContent(block) {
  if (block.type === "text") return textBlockHasContent(block);
  if (block.type === "image") return Boolean(block.image || block.src);
  if (block.type === "question") return Boolean(block.prompt);
  if (block.type === "spelling") {
    return (block.words || []).some((w) => w.text.trim());
  }
  if (block.type === "vakt") return vaktHasContent(block);
  return false;
}

// Imported images carry no dimensions, but the exporter and editor preview need
// them to preserve aspect ratio. Decode each image to read its natural size;
// failures leave it at 0 (the exporter then falls back to a square fit).
async function measureImages(doc) {
  const images = doc.sections
    .flatMap((s) => s.blocks)
    .filter(
      (b) =>
        (b.type === "image" || b.type === "vakt") && Boolean(b.image || b.src),
    );
  await Promise.all(
    images.map(
      (block) =>
        new Promise((resolve) => {
          resolveImageSrc(block)
            .then(({ url, revoke }) => {
              const img = new Image();
              img.onload = () => {
                block.width = img.naturalWidth;
                block.height = img.naturalHeight;
                revoke();
                resolve();
              };
              img.onerror = () => {
                revoke();
                resolve();
              };
              img.src = url;
            })
            .catch(() => resolve());
        }),
    ),
  );
}
