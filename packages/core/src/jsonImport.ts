// Import a lesson from a JSON file produced by "Export JSON" (jsonExport.ts) or
// by the MCP server's `create_lesson_file` tool. Unlike the DOCX import this is
// a lossless, exact-shape format, so we mostly validate and normalise: we accept
// the lesson-file envelope { format, version, doc } or a bare { title, sections }
// doc, ensure every section/block/word/answer has a stable id, drop anything we
// don't recognise, and reject files that aren't structured as a lesson.
//
// An Open Spelling Lesson Format file (oslf.ts) comes through the same door:
// it is turned into a bare doc first, then normalised like one. So does the
// format's XML form (oslfXml.ts), which is read into the JSON form's object
// first. The XML reader is only loaded when an XML file arrives.

import { AGE_RANGES } from "./ageRanges.ts";
import { headingText } from "./heading.ts";
import { newId } from "./id.ts";
import {
  QUESTION_TYPES,
  questionAnswerPlain,
  questionBesides,
} from "./questions.ts";
import { DEFAULT_IMAGE_SIZE, DEFAULT_IMAGE_ALIGN } from "./image.ts";
import { LESSON_FILE_FORMAT } from "./lessonFile.ts";
import { normalizeInlineText } from "./inlineText.ts";
import { OslfImportError, fromOslf, isOslfFile } from "./oslf.ts";
import { isSafeLink } from "./richText.ts";
import {
  normalizeTextContent,
  removeSourceCitations,
  textBlockFootnotes,
  withTextBlockContent,
} from "./lessonText.ts";
import { normalizeSources } from "./sources.ts";
import type {
  Block,
  ImageBlock,
  LessonDoc,
  QuestionBlock,
  QuestionType,
  Section,
  Source,
  StepItem,
  TextItem,
  VaktBlock,
  VaktLink,
} from "./types.ts";
import {
  vaktHasContent,
  vaktImageAlign,
  vaktImageSize,
  vaktText,
} from "./vakt.ts";

// Thrown when a file is readable but not a usable lesson. EditorPage surfaces
// the message and refuses to load it — same contract as DocxImportError.
export class JsonImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonImportError";
  }
}

/** The part of a File the import reads, so anything shaped like one will do. */
export interface ImportFile {
  name?: string;
  text(): Promise<string>;
}

// A doc as a file has it, before normalizing: every field may be anything.
interface DocLike {
  title?: unknown;
  ageRange?: unknown;
  sources?: unknown;
  sections?: unknown;
}

// Anything typeof calls an object, arrays included, the way the checks below
// have always tested for one.
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";

const QUESTION_KEYS: ReadonlySet<unknown> = new Set(
  Object.keys(QUESTION_TYPES),
);

const isQuestionType = (value: unknown): value is QuestionType =>
  QUESTION_KEYS.has(value);

// Read a .json File (or an OSLF lesson as .xml) and rebuild a lesson document
// ready for the editor. Resolves to { title, ageRange?, sources?, sections };
// rejects (JsonImportError) when the file isn't a usable lesson.
export async function importJsonFile(
  file: ImportFile | null | undefined,
): Promise<LessonDoc> {
  if (!file) throw new JsonImportError("No file was selected.");
  const xml = /\.xml$/i.test(file.name || "");
  if (!xml && !/\.json$/i.test(file.name || "")) {
    throw new JsonImportError(
      'Please choose a .json lesson file, the kind you get from "Export JSON" here or from the Spelling Creator AI tool, or an OSLF lesson (.oslf.json or .oslf.xml).',
    );
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new JsonImportError("This file couldn't be read.");
  }

  if (xml) return importOslfXml(text);

  let parsed: unknown;
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
 */
export async function importOslfXml(text: string): Promise<LessonDoc> {
  const { fromOslfXml } = await import("./oslfXml.ts");
  let file: unknown;
  try {
    file = fromOslfXml(text);
  } catch (err) {
    if (err instanceof OslfImportError) throw new JsonImportError(err.message);
    throw err;
  }
  return normalizeLessonFile(file);
}

// Accept the lesson-file envelope { format, version, doc }, a bare doc
// { title, sections }, or an Open Spelling Lesson Format file (oslf.ts),
// then normalise and validate it.
export function normalizeLessonFile(parsed: unknown): LessonDoc {
  if (!isRecord(parsed)) {
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
      `This JSON file is "${String(parsed.format)}", not a Spelling Creator lesson.`,
    );
  }
  const docLike = isRecord(parsed.doc) ? parsed.doc : parsed;
  return normalizeDoc(docLike);
}

function normalizeDoc(docLike: DocLike): LessonDoc {
  const rawSections: unknown[] | null = Array.isArray(docLike.sections)
    ? docLike.sections
    : null;
  if (!rawSections) {
    throw new JsonImportError(
      "This lesson file has no sections. A lesson needs a `sections` array.",
    );
  }

  const sections = rawSections
    .filter(isRecord)
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
  const doc: LessonDoc = {
    title,
    ...((AGE_RANGES as readonly string[]).includes(ageRange)
      ? { ageRange }
      : {}),
    ...(sources.length ? { sources } : {}),
    sections,
  };
  return withoutUnknownCitations(doc, sources);
}

// A footnote citing a source the file doesn't list would print as "Source no
// longer listed", so a note-carrying one keeps its note and a bare citation goes.
function withoutUnknownCitations(doc: LessonDoc, sources: Source[]): LessonDoc {
  const known = new Set(sources.map((source) => source.id));
  const cited = new Set(
    doc.sections
      .flatMap((section) => section.blocks)
      .filter((block) => block.type === "text")
      .flatMap((block) => textBlockFootnotes(block))
      .map((footnote) => footnote.sourceId)
      .filter((id): id is string => Boolean(id)),
  );
  let out = doc;
  for (const id of cited) {
    if (!known.has(id)) out = removeSourceCitations(out, id);
  }
  return out;
}

function normalizeSection(section: Record<string, unknown>): Section {
  const rawBlocks: unknown[] = Array.isArray(section.blocks)
    ? section.blocks
    : [];
  const blocks = rawBlocks
    .map(normalizeBlock)
    .filter((block) => block !== null);
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
function normalizeBlock(block: unknown): Block | null {
  if (!isRecord(block)) return null;
  switch (block.type) {
    case "text": {
      // Formatted blocks carry a tiptap document in `content`; plain ones a
      // string in `text`. Either is accepted, and stored in the smaller shape.
      const content = normalizeTextContent(block.content);
      if (content) {
        return withTextBlockContent(
          { id: keepId(block.id), type: "text" as const },
          content,
        );
      }
      if (typeof block.text !== "string") return null;
      return { id: keepId(block.id), type: "text", text: block.text };
    }

    case "spelling": {
      const words = (Array.isArray(block.words) ? block.words : [])
        .map(normalizeTextItem)
        .filter((word) => word !== null);
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
      // ensure the editor's required framing fields exist. Being verbatim, the
      // fields are whatever the file holds, which the type takes on trust.
      if (!block.image && !block.src) return null;
      return {
        ...block,
        id: keepId(block.id),
        type: "image",
        size: block.size || DEFAULT_IMAGE_SIZE,
        align: block.align || DEFAULT_IMAGE_ALIGN,
      } as ImageBlock;
    }

    default:
      return null;
  }
}

// A VAKT activity: the text (with any label the author typed in front of it
// stripped, so nothing ends up doubly prefixed), its links, and an optional
// image carried verbatim the way an image block's is. Dropped entirely when it
// holds nothing at all — a blank red card is noise in an imported lesson.
function normalizeVakt(block: Record<string, unknown>): VaktBlock | null {
  // The picture and its framing, as the file has them. Like an image block's
  // they are carried unchecked, so the type takes them on trust; the framing
  // is only ever compared against the known sizes and alignments.
  const picture = block as Partial<VaktBlock>;
  const links = (Array.isArray(block.links) ? block.links : [])
    .map(normalizeVaktLink)
    .filter((link) => link !== null);
  const normalized: VaktBlock = {
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
  if (picture.image || picture.src) {
    if (picture.image) normalized.image = picture.image;
    if (picture.src) normalized.src = picture.src;
    if (picture.width != null) normalized.width = picture.width;
    if (picture.height != null) normalized.height = picture.height;
    if (typeof block.caption === "string") normalized.caption = block.caption;
    if (typeof block.credit === "string") normalized.credit = block.credit;
    // The framing, defaulted the VAKT way rather than the image block's, so a
    // file that never carried one imports looking the way it printed.
    normalized.size = vaktImageSize(picture);
    normalized.align = vaktImageAlign(picture);
  }
  return vaktHasContent(normalized) ? normalized : null;
}

// A { id, label, url } link row. A bare string is accepted as a URL with no
// label, so a hand-written file can use the simpler form. Rows whose destination
// isn't a real, safe link are dropped rather than imported unusable.
function normalizeVaktLink(link: unknown): VaktLink | null {
  const raw = typeof link === "string" ? { url: link } : link;
  if (!isRecord(raw)) return null;
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  if (!isSafeLink(url)) return null;
  return {
    id: keepId(raw.id),
    label: typeof raw.label === "string" ? raw.label.trim() : "",
    url,
  };
}

function normalizeQuestion(
  block: Record<string, unknown>,
): QuestionBlock | null {
  if (!isQuestionType(block.questionType)) return null;
  const base: QuestionBlock = {
    id: keepId(block.id),
    type: "question",
    questionType: block.questionType,
    // A string or a one-paragraph document (see inlineText.ts); anything
    // else, or a document holding nothing, is an empty prompt.
    prompt: normalizeInlineText(block.prompt),
  };
  switch (block.questionType) {
    case "number": {
      const steps = (Array.isArray(block.steps) ? block.steps : [])
        .map(normalizeStepItem)
        .filter((step) => step !== null);
      return {
        ...base,
        answer: questionAnswerPlain(block.answer),
        steps,
      };
    }
    case "single":
      return { ...base, answer: questionAnswerPlain(block.answer) };
    case "multiple":
    case "multiple_open": {
      const answers = (Array.isArray(block.answers) ? block.answers : [])
        .map(normalizeTextItem)
        .filter((answer) => answer !== null);
      if (answers.length === 0) answers.push({ id: newId(), text: "" });
      const out: QuestionBlock = { ...base, answers };
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
        .filter((answer) => answer !== null);
      return { ...base, answers };
    }
    // Free written responses: no stored answer, so the base block is complete.
    case "paraphrase":
    case "broad_open":
    case "open":
    case "wyr":
      return base;
    case "background":
      return { ...base, answer: questionAnswerPlain(block.answer) };
    default:
      return null;
  }
}

// A { id, text } row (spelling word or multiple-choice answer). Accepts a bare
// string too, so a hand-written file can use the simpler form.
function normalizeTextItem(item: unknown): TextItem | null {
  if (typeof item === "string") {
    const text = item.trim();
    return text ? { id: newId(), text } : null;
  }
  if (isRecord(item) && typeof item.text === "string") {
    const text = item.text.trim();
    return text ? { id: keepId(item.id), text } : null;
  }
  return null;
}

// A working step: like a text item, but its text is inline text, so it may
// be a document as well as a string (see inlineText.ts).
function normalizeStepItem(item: unknown): StepItem | null {
  if (typeof item === "string") return normalizeTextItem(item);
  if (!isRecord(item)) return null;
  const text = normalizeInlineText(item.text);
  if (typeof text === "string") return normalizeTextItem({ ...item, text });
  return { id: keepId(item.id), text };
}

// Reuse an existing string id, or mint a fresh one. Imported files normally
// already carry ids (the MCP tool and exporter generate them); we regenerate
// only what's missing so every node has a stable React/collaboration key.
function keepId(id: unknown): string {
  return typeof id === "string" && id ? id : newId();
}
