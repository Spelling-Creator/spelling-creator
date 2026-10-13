// Import a lesson from a JSON file produced by "Export JSON" (jsonExport.js) or
// by the MCP server's `create_lesson_file` tool. Unlike the DOCX import this is
// a lossless, exact-shape format, so we mostly validate and normalise: we accept
// the lesson-file envelope { format, version, doc } or a bare { title, sections }
// doc, ensure every section/block/word/answer has a stable id, drop anything we
// don't recognise, and reject files that aren't structured as a lesson.
//
// An Open Spelling Lesson Format file (oslf.js) comes through the same door:
// it is turned into a bare doc first, then normalised like one. So does the
// format's XML form (oslfXml.js), which is read into the JSON form's object
// first. The XML reader is only loaded when an XML file arrives.

import { AGE_RANGES } from "./ageRanges.js";
import { headingText } from "./heading.js";
import { newId } from "./id.js";
import { QUESTION_TYPES, questionBesides } from "./questions.js";
import { DEFAULT_IMAGE_SIZE, DEFAULT_IMAGE_ALIGN } from "./image.js";
import { LESSON_FILE_FORMAT } from "./lessonFile.js";
import { OslfImportError, fromOslf, isOslfFile } from "./oslf.js";
import { isSafeLink } from "./richText.js";
import {
  normalizeTextContent,
  removeSourceCitations,
  textBlockFootnotes,
  withTextBlockContent,
} from "./lessonText.js";
import { normalizeSources } from "./sources.js";
import {
  vaktHasContent,
  vaktImageAlign,
  vaktImageSize,
  vaktText,
} from "./vakt.js";

// Thrown when a file is readable but not a usable lesson. EditorPage surfaces
// the message and refuses to load it — same contract as DocxImportError.
export class JsonImportError extends Error {
  constructor(message) {
    super(message);
    this.name = "JsonImportError";
  }
}

const QUESTION_KEYS = new Set(Object.keys(QUESTION_TYPES));

// Read a .json File (or an OSLF lesson as .xml) and rebuild a lesson document
// ready for the editor. Resolves to { title, ageRange?, sources?, sections };
// rejects (JsonImportError) when the file isn't a usable lesson.
export async function importJsonFile(file) {
  if (!file) throw new JsonImportError("No file was selected.");
  const xml = /\.xml$/i.test(file.name || "");
  if (!xml && !/\.json$/i.test(file.name || "")) {
    throw new JsonImportError(
      'Please choose a .json lesson file, the kind you get from "Export JSON" here or from the Spelling Creator AI tool, or an OSLF lesson (.oslf.json or .oslf.xml).',
    );
  }

  let text;
  try {
    text = await file.text();
  } catch {
    throw new JsonImportError("This file couldn't be read.");
  }

  if (xml) return importOslfXml(text);

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new JsonImportError(
      "This file isn't valid JSON. It may be corrupted or not a lesson file.",
    );
  }

  return normalizeLessonFile(parsed);
}

/**
 * An OSLF lesson in its XML form, as a lesson document ready for the editor.
 * Rejects (JsonImportError) when the text isn't one.
 * @param {string} text
 * @returns {Promise<object>}
 */
export async function importOslfXml(text) {
  const { fromOslfXml } = await import("./oslfXml.js");
  let file;
  try {
    file = fromOslfXml(text);
  } catch (err) {
    if (err instanceof OslfImportError) throw new JsonImportError(err.message);
    throw err;
  }
  return normalizeLessonFile(file);
}

// Accept the lesson-file envelope { format, version, doc }, a bare doc
// { title, sections }, or an Open Spelling Lesson Format file (oslf.js),
// then normalise and validate it.
export function normalizeLessonFile(parsed) {
  if (!parsed || typeof parsed !== "object") {
    throw new JsonImportError(
      "This file isn't a lesson: expected a JSON object.",
    );
  }
  if (isOslfFile(parsed)) {
    try {
      return normalizeDoc(fromOslf(parsed));
    } catch (err) {
      if (err instanceof OslfImportError)
        throw new JsonImportError(err.message);
      throw err;
    }
  }
  // A wrong but explicit format marker is a clear, actionable error.
  if (parsed.format && parsed.format !== LESSON_FILE_FORMAT) {
    throw new JsonImportError(
      `This JSON file is "${parsed.format}", not a Spelling Creator lesson.`,
    );
  }
  const docLike =
    parsed.doc && typeof parsed.doc === "object" ? parsed.doc : parsed;
  return normalizeDoc(docLike);
}

function normalizeDoc(docLike) {
  const rawSections = Array.isArray(docLike.sections) ? docLike.sections : null;
  if (!rawSections) {
    throw new JsonImportError(
      "This lesson file has no sections. A lesson needs a `sections` array.",
    );
  }

  const sections = rawSections
    .filter((s) => s && typeof s === "object")
    .map(normalizeSection)
    .filter((s) => s.blocks.length > 0);

  if (sections.length === 0) {
    throw new JsonImportError(
      "This lesson file has no readable sections or content.",
    );
  }

  const title =
    typeof docLike.title === "string" && docLike.title.trim()
      ? docLike.title
      : "Imported lesson";

  // Only a range the editor offers survives. Anything else would leave the age
  // picker showing a value it has no option for, so it reads as "any age".
  const ageRange =
    typeof docLike.ageRange === "string" ? docLike.ageRange.trim() : "";

  const sources = normalizeSources(docLike.sources, { dropEmpty: true });
  const doc = {
    title,
    ...(AGE_RANGES.includes(ageRange) ? { ageRange } : {}),
    ...(sources.length ? { sources } : {}),
    sections,
  };
  return withoutUnknownCitations(doc, sources);
}

// A footnote citing a source the file doesn't list would print as "Source no
// longer listed", so a note-carrying one keeps its note and a bare citation goes.
function withoutUnknownCitations(doc, sources) {
  const known = new Set(sources.map((source) => source.id));
  const cited = new Set(
    doc.sections
      .flatMap((section) => section.blocks)
      .filter((block) => block.type === "text")
      .flatMap((block) => textBlockFootnotes(block))
      .map((footnote) => footnote.sourceId)
      .filter(Boolean),
  );
  let out = doc;
  for (const id of cited) {
    if (!known.has(id)) out = removeSourceCitations(out, id);
  }
  return out;
}

function normalizeSection(section) {
  const rawBlocks = Array.isArray(section.blocks) ? section.blocks : [];
  const blocks = rawBlocks.map(normalizeBlock).filter(Boolean);
  return {
    id: keepId(section.id),
    name:
      typeof section.name === "string" && section.name.trim()
        ? section.name
        : "Imported section",
    blocks,
  };
}

// Normalise one block to the exact editor shape, or return null to drop it.
function normalizeBlock(block) {
  if (!block || typeof block !== "object") return null;
  switch (block.type) {
    case "text": {
      // Formatted blocks carry a tiptap document in `content`; plain ones a
      // string in `text`. Either is accepted, and stored in the smaller shape.
      const content = normalizeTextContent(block.content);
      if (content) {
        return withTextBlockContent(
          { id: keepId(block.id), type: "text" },
          content,
        );
      }
      if (typeof block.text !== "string") return null;
      return { id: keepId(block.id), type: "text", text: block.text };
    }

    case "spelling": {
      const words = (Array.isArray(block.words) ? block.words : [])
        .map(normalizeTextItem)
        .filter(Boolean);
      if (words.length === 0) return null;
      return { id: keepId(block.id), type: "spelling", words };
    }

    case "question":
      return normalizeQuestion(block);

    case "vakt":
      return normalizeVakt(block);

    // A heading with nothing in it is a blank line nobody meant to keep.
    case "heading": {
      const text = headingText(block);
      return text ? { id: keepId(block.id), type: "heading", text } : null;
    }

    case "image": {
      // Preserve image blocks verbatim (binary ref / src / dimensions) and just
      // ensure the editor's required framing fields exist.
      if (!block.image && !block.src) return null;
      return {
        ...block,
        id: keepId(block.id),
        type: "image",
        size: block.size || DEFAULT_IMAGE_SIZE,
        align: block.align || DEFAULT_IMAGE_ALIGN,
      };
    }

    default:
      return null;
  }
}

// A VAKT activity: the text (with any label the author typed in front of it
// stripped, so nothing ends up doubly prefixed), its links, and an optional
// image carried verbatim the way an image block's is. Dropped entirely when it
// holds nothing at all — a blank red card is noise in an imported lesson.
function normalizeVakt(block) {
  const links = (Array.isArray(block.links) ? block.links : [])
    .map(normalizeVaktLink)
    .filter(Boolean);
  const normalized = {
    id: keepId(block.id),
    type: "vakt",
    text: vaktText(block),
    links,
  };
  // Both representations of a picture, for the same reason the image block
  // tolerates both: a hash ref is what a stored lesson carries, and an inline
  // `src` data URL is what one still carries between a DOCX import and the
  // convertDocImages pass that turns it into a ref. Dropping `src` here would
  // silently lose the picture — and, for a block that had nothing else, the
  // whole block.
  if (block.image || block.src) {
    if (block.image) normalized.image = block.image;
    if (block.src) normalized.src = block.src;
    if (block.width != null) normalized.width = block.width;
    if (block.height != null) normalized.height = block.height;
    if (typeof block.caption === "string") normalized.caption = block.caption;
    if (typeof block.credit === "string") normalized.credit = block.credit;
    // The framing, defaulted the VAKT way rather than the image block's, so a
    // file that never carried one imports looking the way it printed.
    normalized.size = vaktImageSize(block);
    normalized.align = vaktImageAlign(block);
  }
  return vaktHasContent(normalized) ? normalized : null;
}

// A { id, label, url } link row. A bare string is accepted as a URL with no
// label, so a hand-written file can use the simpler form. Rows whose destination
// isn't a real, safe link are dropped rather than imported unusable.
function normalizeVaktLink(link) {
  const raw = typeof link === "string" ? { url: link } : link;
  if (!raw || typeof raw !== "object") return null;
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  if (!isSafeLink(url)) return null;
  return {
    id: keepId(raw.id),
    label: typeof raw.label === "string" ? raw.label.trim() : "",
    url,
  };
}

function normalizeQuestion(block) {
  if (!QUESTION_KEYS.has(block.questionType)) return null;
  const prompt = typeof block.prompt === "string" ? block.prompt : "";
  const base = {
    id: keepId(block.id),
    type: "question",
    questionType: block.questionType,
    prompt,
  };
  switch (block.questionType) {
    case "number": {
      const steps = (Array.isArray(block.steps) ? block.steps : [])
        .map(normalizeTextItem)
        .filter(Boolean);
      return {
        ...base,
        answer: block.answer != null ? String(block.answer) : "",
        steps,
      };
    }
    case "single":
      return {
        ...base,
        answer: typeof block.answer === "string" ? block.answer : "",
      };
    case "multiple":
    case "multiple_open": {
      const answers = (Array.isArray(block.answers) ? block.answers : [])
        .map(normalizeTextItem)
        .filter(Boolean);
      if (answers.length === 0) answers.push({ id: newId(), text: "" });
      const out = { ...base, answers };
      // The three-board mark and the Besides line, on the tight type only. A
      // Besides line naming an answer the list doesn't have is dropped rather
      // than carried: it would print nothing and confuse the editor's picker.
      if (block.questionType === "multiple") {
        if (block.threeBoard === true) out.threeBoard = true;
        const besides = questionBesides({ ...out, besides: block.besides });
        if (besides != null) out.besides = besides;
      }
      return out;
    }
    // A tight open's examples are optional, so an empty list stays empty.
    case "tight_open": {
      const answers = (Array.isArray(block.answers) ? block.answers : [])
        .map(normalizeTextItem)
        .filter(Boolean);
      return { ...base, answers };
    }
    // Free written responses: no stored answer, so the base block is complete.
    case "paraphrase":
    case "broad_open":
    case "open":
    case "wyr":
      return base;
    case "background":
      return {
        ...base,
        answer: typeof block.answer === "string" ? block.answer : "",
      };
    default:
      return null;
  }
}

// A { id, text } row (spelling word or multiple-choice answer). Accepts a bare
// string too, so a hand-written file can use the simpler form.
function normalizeTextItem(item) {
  if (typeof item === "string") {
    const text = item.trim();
    return text ? { id: newId(), text } : null;
  }
  if (item && typeof item === "object" && typeof item.text === "string") {
    const text = item.text.trim();
    return text ? { id: keepId(item.id), text } : null;
  }
  return null;
}

// Reuse an existing string id, or mint a fresh one. Imported files normally
// already carry ids (the MCP tool and exporter generate them); we regenerate
// only what's missing so every node has a stable React/collaboration key.
function keepId(id) {
  return typeof id === "string" && id ? id : newId();
}
