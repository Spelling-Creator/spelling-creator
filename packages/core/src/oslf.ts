// The Open Spelling Lesson Format (OSLF): reading and writing a lesson as the
// method-neutral file other tools can read.
//
// OSLF is the vocabulary the app's question types follow (see questions.ts),
// written down as a JSON file with a published schema:
// https://github.com/playforge-coding/open-spelling-lesson-format. This
// module maps the app's own document (the shape buildDoc produces and the hub
// stores) onto that file and back. The app's own .json lesson file stays what
// it is, a lossless dump of the editor's document; OSLF is for passing a
// lesson to something that isn't this app.
//
// Two things don't survive the trip and are worth knowing:
//
//   - A caption or heading is rich text in OSLF and a plain string here, so
//     marks and notes on those come back as their text alone. A prompt and a
//     math question's working are inline text (see inlineText.ts), which
//     holds everything the format's rich text does but a note, so a note in
//     one of those comes back as nothing.
//   - An image is referred to by URL in OSLF. Exporting writes the public URL
//     the caller supplies for each stored picture (or the data URL a block
//     already carries); importing keeps an https or data URL as the block's
//     `src`, and drops a picture given as a relative file, since a single
//     file has nothing for that to be relative to.
//
// oslf.schema.json beside this file is the format's lesson schema, copied
// from the 0.1 draft so the tests can hold toOslf's output to it. Nothing at
// runtime reads it.

import { headingText } from "./heading.ts";
import { imageCaptionParts } from "./imageCredit.ts";
import {
  inlineTextContent,
  inlineTextPlain,
  normalizeInlineText,
} from "./inlineText.ts";
import { lessonFileBase } from "./lessonFile.ts";
import {
  type Footnote,
  type ParagraphNode,
  type TextContent,
  normalizeTextContent,
  textBlockContent,
} from "./lessonText.ts";
import {
  isThreeBoard,
  questionAnswerItems,
  questionBesides,
  questionMeta,
  resolveOpenType,
} from "./questions.ts";
import { SOURCE_FIELDS } from "./sources.ts";
import type {
  Block,
  ImageBlock,
  InlineText,
  LessonDoc,
  QuestionBlock,
  QuestionType,
  RichNode,
  Source,
  TextBlock,
  VaktBlock,
} from "./types.ts";
import { vaktLinks, vaktText } from "./vakt.ts";

/** The OSLF version this module writes. */
export const OSLF_VERSION = "0.1";

/** The file name extension the format recommends. */
export const OSLF_EXTENSION = ".oslf.json";

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

// The JSON form of an OSLF lesson file, as oslf.schema.json describes it.
// Rich text and spoken text never hold a line break.

/** Keys are URIs owned by whoever defines the extension. */
export type OslfExtensions = Record<string, unknown>;

/** How a run is said: exactly one of the three. */
export type OslfHint =
  | { ipa: string }
  | { alias: string }
  | { sayAs: "characters" };

/** A pause in read-aloud. Rich text displays it as nothing. */
export interface OslfPauseRun {
  pause: "short" | "long";
}

/** One run of spoken text: words, words with one hint, or a pause. */
export type OslfSpokenRun =
  | string
  | ({ text: string } & OslfHint)
  | OslfPauseRun;

/** What read-aloud says: a plain string, or a list of spoken runs. */
export type OslfSpokenText = string | OslfSpokenRun[];

/** Words, with their formatting and at most one of the three hints. */
export interface OslfTextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  ipa?: string;
  alias?: string;
  sayAs?: "characters";
}

/** A note: a citation of one of the lesson's sources, free text, or both. */
export interface OslfNote {
  source?: string;
  locator?: string;
  text?: string;
}

/**
 * A formula. `format` is "asciimath" or "tex" in 0.1; a notation a reader
 * doesn't know is kept, as the format asks, and shown as its source.
 */
export interface OslfMath {
  format: string;
  source: string;
  display?: boolean;
  spoken?: OslfSpokenText;
}

export type OslfRun =
  | string
  | OslfTextRun
  | { note: OslfNote }
  | { math: OslfMath }
  | OslfPauseRun;

/** A plain string, or a list of runs. */
export type OslfRichText = string | OslfRun[];

export interface OslfPerson {
  name: string;
  url?: string;
}

export interface OslfSource {
  id: string;
  title?: string;
  author?: string;
  publisher?: string;
  year?: string;
  url?: string;
}

/** Who made a picture and on what terms. At least one field is set. */
export interface OslfCredit {
  text?: string;
  author?: string;
  license?: string;
  licenseUrl?: string;
  sourceUrl?: string;
}

export type OslfImageSize = "small" | "medium" | "large" | "full";
export type OslfImageAlign = "left" | "center" | "right";

/** A picture, by URL: https, a data URL, or a file relative to the lesson's. */
export interface OslfImage {
  src: string;
  alt?: string;
  caption?: OslfRichText;
  credit?: OslfCredit;
  width?: number;
  height?: number;
  size?: OslfImageSize;
  align?: OslfImageAlign;
}

interface OslfBlockFields {
  id?: string;
  extensions?: OslfExtensions;
}

export interface OslfPassage extends OslfBlockFields {
  type: "passage";
  paragraphs: OslfRichText[];
}

export interface OslfSpelling extends OslfBlockFields {
  type: "spelling";
  words: string[];
}

export interface OslfImageBlock extends OslfBlockFields, OslfImage {
  type: "image";
}

/** The format's question type ids. */
export type OslfQuestionType =
  | "known"
  | "prior-knowledge"
  | "math"
  | "semi-open"
  | "tight-open"
  | "would-you-rather"
  | "paraphrase"
  | "broad-open";

export interface OslfQuestion extends OslfBlockFields {
  type: "question";
  questionType: OslfQuestionType;
  prompt: OslfRichText;
  answerKey?: "exhaustive" | "suggested" | "none";
  answers?: string[];
  /** Math only. */
  working?: OslfRichText[];
  /** Semi-open only. */
  threeBoard?: boolean;
  /** Semi-open only. */
  besides?: string;
}

export interface OslfVakt extends OslfBlockFields {
  type: "vakt";
  text: string;
  links?: Array<{ url: string; label?: string }>;
  image?: OslfImage;
}

export interface OslfHeading extends OslfBlockFields {
  type: "heading";
  text: OslfRichText;
}

export type OslfBlock =
  | OslfPassage
  | OslfSpelling
  | OslfImageBlock
  | OslfQuestion
  | OslfVakt
  | OslfHeading;

export interface OslfSection {
  id?: string;
  title?: string;
  blocks: OslfBlock[];
  extensions?: OslfExtensions;
}

/** An OSLF lesson file, the object its .oslf.json holds. */
export interface OslfFile {
  /** The format version the file follows. */
  oslf: string;
  title: string;
  id?: string;
  language?: string;
  authors?: OslfPerson[];
  license?: string;
  created?: string;
  modified?: string;
  ageRange?: string;
  profiles?: string[];
  sources?: OslfSource[];
  sections: OslfSection[];
  extensions?: OslfExtensions;
}

// The app's type keys and the format's ids, both ways. `open` is sorted by
// wording on the way out (resolveOpenType, the same reading the lesson
// checks use, so a lesson that passes them still does once it comes back),
// so it has no entry of its own.
const TYPE_TO_OSLF = {
  single: "known",
  background: "prior-knowledge",
  number: "math",
  multiple: "semi-open",
  multiple_open: "semi-open",
  tight_open: "tight-open",
  broad_open: "broad-open",
  paraphrase: "paraphrase",
  wyr: "would-you-rather",
} satisfies Partial<Record<QuestionType, OslfQuestionType>>;
const OSLF_TO_TYPE = {
  known: "single",
  "prior-knowledge": "background",
  math: "number",
  "semi-open": "multiple",
  "tight-open": "tight_open",
  "broad-open": "broad_open",
  paraphrase: "paraphrase",
  "would-you-rather": "wyr",
} satisfies Record<OslfQuestionType, QuestionType>;

const IMAGE_SIZES: readonly OslfImageSize[] = [
  "small",
  "medium",
  "large",
  "full",
];
const IMAGE_ALIGNS: readonly OslfImageAlign[] = ["left", "center", "right"];

type Fields = Record<string, unknown>;

function isObject(value: unknown): value is Fields {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// The fields of a value read from a file, or none for anything else.
function fieldsOf(value: unknown): Fields {
  return isObject(value) ? value : {};
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isOneOf<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return values.some((v) => v === value);
}

function isFiniteNumber(value: unknown): value is number {
  return Number.isFinite(value);
}

/**
 * Whether a parsed JSON value is an OSLF lesson file, as opposed to the app's
 * own lesson file or something else.
 */
export function isOslfFile(
  parsed: unknown,
): parsed is Fields & { oslf: string } {
  return Boolean(
    parsed &&
    typeof parsed === "object" &&
    "oslf" in parsed &&
    typeof parsed.oslf === "string",
  );
}

/**
 * A file name for a lesson exported as OSLF, from its title: the same stem
 * the app's own lesson file gets, with the format's extension.
 */
export function oslfFileName(title?: string): string {
  return `${lessonFileBase(title)}${OSLF_EXTENSION}`;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Thrown when a lesson can't be written as a valid OSLF file as it stands:
 * a question of a kind the format requires an answer for has none. The
 * message names the question, so whoever asked for the file can fill it in.
 */
export class OslfExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OslfExportError";
  }
}

// The types the format requires at least one answer for (known, math,
// semi-open and prior-knowledge all do). A draft with one of these still
// blank can't be a valid file, so exporting it stops rather than writing a
// file every reader of the format would reject.
const ANSWER_REQUIRED_TYPES = new Set<QuestionType>([
  "single",
  "background",
  "number",
  "multiple",
  "multiple_open",
]);

// The format's one-line strings (a prompt, a heading, a caption, a run of
// rich text) can't hold a line break. The editor's fields can, so a break is
// written as a space on the way out.
function oneLine(value: unknown): string {
  return String(value ?? "").replace(/\s*\r?\n\s*/g, " ");
}

/** A block that may carry a picture. */
type PictureBlock = ImageBlock | VaktBlock;

export interface OslfExportOptions {
  /**
   * The URL a picture is reachable at, for a block that refers to its bytes
   * by hash.
   */
  imageSrc?: (block: PictureBlock) => string | null | undefined;
}

/**
 * A lesson document as an OSLF lesson file. Throws OslfExportError for a
 * lesson the format can't hold as it stands (see the class).
 *
 * @param doc  The app's lesson document.
 * @param options
 *   `imageSrc` gives the URL a picture is reachable at, for a block that
 *   refers to its bytes by hash. A block that already carries a `src` data
 *   URL uses that. A picture with no URL either way is left out, caption and
 *   all, because an image block in the format needs one.
 */
export function toOslf(
  doc: LessonDoc,
  { imageSrc }: OslfExportOptions = {},
): OslfFile {
  const out: Omit<OslfFile, "sections"> = {
    oslf: OSLF_VERSION,
    title: String(doc?.title || "Untitled"),
  };
  if (typeof doc?.ageRange === "string" && doc.ageRange.trim()) {
    out.ageRange = doc.ageRange.trim();
  }
  const sources = (Array.isArray(doc?.sources) ? doc.sources : [])
    .map(sourceToOslf)
    .filter((source) => source !== null);
  if (sources.length) out.sources = sources;
  const sections = (Array.isArray(doc?.sections) ? doc.sections : []).map(
    (section, si): OslfSection => {
      let questions = 0;
      const blocks = (Array.isArray(section?.blocks) ? section.blocks : [])
        .map((block) => {
          if (block?.type === "question") {
            questions += 1;
            requireAnswer(block, si + 1, questions);
          }
          return blockToOslf(block, imageSrc);
        })
        .filter((block) => block !== null);
      const result: Omit<OslfSection, "blocks"> = {};
      if (typeof section?.id === "string" && section.id) result.id = section.id;
      if (typeof section?.name === "string" && section.name.trim()) {
        result.title = section.name.trim();
      }
      return { ...result, blocks };
    },
  );
  return { ...out, sections };
}

function requireAnswer(block: QuestionBlock, section: number, number: number) {
  const type = block.questionType;
  if (!ANSWER_REQUIRED_TYPES.has(type) || questionAnswerItems(block).length) {
    return;
  }
  const prompt = oneLine(inlineTextPlain(block.prompt)).trim();
  const named = prompt ? ` ("${prompt}")` : "";
  throw new OslfExportError(
    `Section ${section}, question ${number}${named} has no answer. The Open Spelling Lesson Format ` +
      `needs one for a ${questionMeta(type).label} question: fill it in, or change the question's type, ` +
      "and export again.",
  );
}

function sourceToOslf(source: Source): OslfSource | null {
  if (!source || typeof source !== "object" || !source.id) return null;
  const out: OslfSource = { id: String(source.id) };
  for (const field of SOURCE_FIELDS) {
    const value = typeof source[field] === "string" ? source[field].trim() : "";
    if (value) out[field] = value;
  }
  return out;
}

function withId<T extends OslfBlock>(block: Block, out: T): T {
  return typeof block?.id === "string" && block.id
    ? { id: block.id, ...out }
    : out;
}

function blockToOslf(
  block: Block,
  imageSrc: OslfExportOptions["imageSrc"],
): OslfBlock | null {
  if (!block || typeof block !== "object") return null;
  switch (block.type) {
    case "text":
      return withId(block, { type: "passage", paragraphs: passageOf(block) });
    case "spelling": {
      const words = (block.words || [])
        .map((w) => (typeof w === "string" ? w : w?.text) || "")
        .map((text) => text.trim())
        .filter(Boolean);
      return words.length ? withId(block, { type: "spelling", words }) : null;
    }
    case "image": {
      const image = imageToOslf(block, imageSrc);
      return image ? withId(block, { type: "image", ...image }) : null;
    }
    case "question":
      return withId(block, questionToOslf(block));
    case "vakt": {
      const text = vaktText(block);
      if (!text) return null;
      const out: OslfVakt = { type: "vakt", text };
      const links = vaktLinks(block).map((link) =>
        link.label ? { url: link.url, label: link.label } : { url: link.url },
      );
      if (links.length) out.links = links;
      const image = imageToOslf(block, imageSrc);
      if (image) out.image = image;
      return withId(block, out);
    }
    case "heading": {
      const text = oneLine(headingText(block));
      return text ? withId(block, { type: "heading", text }) : null;
    }
    default:
      return null;
  }
}

// A text block's paragraphs as OSLF rich text: a plain string where a
// paragraph has no marks or notes, and a list of runs otherwise.
function passageOf(block: TextBlock): OslfRichText[] {
  const content = textBlockContent(block);
  const paragraphs = (content?.content || []).map(paragraphToOslf);
  return paragraphs.length ? paragraphs : [""];
}

// One stored paragraph as OSLF rich text.
function paragraphToOslf(paragraph: ParagraphNode): OslfRichText {
  const runs: OslfRun[] = [];
  for (const node of paragraph.content || []) {
    if (node.type === "pause") {
      runs.push({ pause: node.attrs?.length === "long" ? "long" : "short" });
    } else if (node.type === "math") {
      const { format, source, display, spoken } = node.attrs;
      const math: OslfMath = { format, source: oneLine(source) };
      if (display) math.display = true;
      if (spoken) math.spoken = spoken;
      runs.push({ math });
    } else if (node.type === "text") {
      const marks = new Set((node.marks || []).map((m) => m.type));
      const speech = (node.marks || []).find((m) => m.type === "speech");
      marks.delete("speech");
      const text = oneLine(node.text);
      if (!marks.size && !speech) {
        // Adjacent plain runs join, so a paragraph with no formatting is
        // one string.
        if (typeof runs[runs.length - 1] === "string") {
          runs[runs.length - 1] += text;
        } else {
          runs.push(text);
        }
        continue;
      }
      const run: OslfTextRun = { text };
      if (marks.has("bold")) run.bold = true;
      if (marks.has("italic")) run.italic = true;
      if (marks.has("underline")) run.underline = true;
      // The stored mark already holds exactly one of the format's three.
      if (speech) Object.assign(run, speech.attrs);
      runs.push(run);
    } else if (node.type === "footnote") {
      const note: OslfNote = {};
      const {
        sourceId,
        locator,
        note: text,
      }: Partial<Footnote> = node.attrs || {};
      if (typeof sourceId === "string" && sourceId) note.source = sourceId;
      if (typeof locator === "string" && locator.trim()) {
        note.locator = oneLine(locator).trim();
      }
      if (typeof text === "string" && text.trim()) {
        note.text = oneLine(text).trim();
      }
      // A note with neither a source nor any text says nothing.
      if (note.source || note.text) runs.push({ note });
    }
  }
  if (runs.length === 1 && typeof runs[0] === "string") return runs[0];
  return runs.length ? runs : "";
}

// Inline text (a prompt, a step) as OSLF rich text: its plain string, or
// its one paragraph's runs.
function inlineTextToOslf(value: InlineText): OslfRichText {
  if (typeof value === "string") return oneLine(value);
  return paragraphToOslf(inlineTextContent(value).content[0]);
}

function imageToOslf(
  block: PictureBlock,
  imageSrc: OslfExportOptions["imageSrc"],
): OslfImage | null {
  const src =
    typeof block?.src === "string" && block.src
      ? block.src
      : block?.image?.hash && imageSrc
        ? imageSrc(block)
        : null;
  if (typeof src !== "string" || !src) return null;
  const out: OslfImage = { src };
  const parts = imageCaptionParts(block);
  const caption = oneLine(parts.caption);
  const { credit } = parts;
  if (caption) {
    out.alt = caption;
    out.caption = caption;
  }
  if (credit) out.credit = { text: credit };
  if (isFiniteNumber(block.width) && block.width > 0) out.width = block.width;
  if (isFiniteNumber(block.height) && block.height > 0) {
    out.height = block.height;
  }
  if (isOneOf(IMAGE_SIZES, block.size)) {
    out.size = block.size;
  }
  if (isOneOf(IMAGE_ALIGNS, block.align)) {
    out.align = block.align;
  }
  return out;
}

function questionToOslf(block: QuestionBlock): OslfQuestion {
  const type = resolveOpenType(block);
  const toOslfType: Partial<Record<string, OslfQuestionType>> = TYPE_TO_OSLF;
  const questionType = toOslfType[String(type)] || "broad-open";
  const out: OslfQuestion = {
    type: "question",
    questionType,
    prompt: inlineTextToOslf(block.prompt),
  };
  const answers = questionAnswerItems(block);
  switch (type) {
    case "single":
    case "background":
    case "number":
      if (answers.length) out.answers = answers;
      if (type === "number") {
        const working = (block.steps || [])
          .map((s) => (typeof s === "string" ? s : s?.text))
          .filter((text) => inlineTextPlain(text).trim())
          .map(inlineTextToOslf);
        if (working.length) out.working = working;
      }
      break;
    case "multiple": {
      if (answers.length) out.answers = answers;
      if (isThreeBoard(block)) out.threeBoard = true;
      const besides = questionBesides(block);
      if (besides != null) out.besides = besides;
      break;
    }
    case "multiple_open":
      out.answerKey = "suggested";
      if (answers.length) out.answers = answers;
      break;
    case "tight_open":
      if (answers.length) {
        out.answerKey = "suggested";
        out.answers = answers;
      }
      break;
    default:
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Thrown when a file says it is OSLF but can't be read as a lesson.
 */
export class OslfImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OslfImportError";
  }
}

// A picture's fields as the file gives them, before jsonImport checks them.
interface ImportedPicture {
  src: string;
  width?: number;
  height?: number;
  caption?: string;
  credit?: string;
  size?: string;
  align?: string;
}

type ImportedText = string | TextContent;

interface ImportedQuestion {
  type: "question";
  questionType: QuestionType;
  prompt: ImportedText;
  answer?: string;
  answers?: string[];
  steps?: Array<{ text: ImportedText }>;
  threeBoard?: boolean;
  besides?: string;
}

/**
 * A block as fromOslf reads it: the app's block before normalizing, so ids
 * may be missing, and words, answers, steps and links have none of their own.
 */
export type OslfImportBlock = { id?: string } & (
  | { type: "text"; content: TextContent }
  | { type: "spelling"; words: string[] }
  | ({ type: "image" } & ImportedPicture)
  | ImportedQuestion
  | ({
      type: "vakt";
      text: string;
      links: Array<{ url: string; label: string }>;
    } & Partial<ImportedPicture>)
  | { type: "heading"; text: string }
);

/** What fromOslf gives: the app's lesson document, before normalizing. */
export interface OslfImportDoc {
  title: string;
  ageRange?: string;
  sources?: Array<Partial<Source> & { id: string }>;
  sections: Array<{ id?: string; name: string; blocks: OslfImportBlock[] }>;
}

/**
 * An OSLF lesson file as the app's lesson document, before normalizing: the
 * shape jsonImport's normalizeLessonFile accepts as a bare doc, which gives
 * every block an id and drops what it can't keep. Throws OslfImportError for
 * a file of a version this can't read.
 *
 * @param file  The parsed OSLF file.
 */
export function fromOslf(file: unknown): OslfImportDoc {
  if (!isOslfFile(file)) {
    throw new OslfImportError("This file isn't an OSLF lesson.");
  }
  // This module reads the 0.x drafts. A 1.0 may change what a field holds,
  // so a file that says it is one is refused rather than read on 0.1's terms
  // and quietly emptied of whatever moved.
  const [major] = String(file.oslf).split(".");
  if (major !== "0") {
    throw new OslfImportError(
      `This lesson is OSLF ${file.oslf}, which is newer than this app can read.`,
    );
  }
  const doc: OslfImportDoc = {
    title: typeof file.title === "string" ? file.title : "",
    sections: listOf(file.sections).map((value) => {
      const section = fieldsOf(value);
      return {
        ...(typeof section.id === "string" ? { id: section.id } : {}),
        name: typeof section.title === "string" ? section.title : "",
        blocks: listOf(section.blocks)
          .map(blockFromOslf)
          .filter((block) => block !== null),
      };
    }),
  };
  if (typeof file.ageRange === "string") doc.ageRange = file.ageRange;
  if (Array.isArray(file.sources)) {
    doc.sources = listOf(file.sources)
      .filter(
        (s): s is Fields & { id: string } =>
          isObject(s) && typeof s.id === "string",
      )
      .map((s) => {
        const out: Partial<Source> & { id: string } = { id: s.id };
        for (const field of SOURCE_FIELDS) {
          const value = s[field];
          if (typeof value === "string") out[field] = value;
        }
        return out;
      });
  }
  return doc;
}

function idOf(block: Fields): { id?: string } {
  return typeof block.id === "string" && block.id ? { id: block.id } : {};
}

function blockFromOslf(block: unknown): OslfImportBlock | null {
  if (!isObject(block)) return null;
  switch (block.type) {
    case "passage": {
      const paragraphs = listOf(block.paragraphs);
      const content = normalizeTextContent({
        type: "doc",
        content: paragraphs.map(paragraphFromOslf),
      });
      return content ? { ...idOf(block), type: "text", content } : null;
    }
    case "spelling":
      return {
        ...idOf(block),
        type: "spelling",
        words: listOf(block.words).filter((w) => typeof w === "string"),
      };
    case "image": {
      const image = imageFromOslf(block);
      return image ? { ...idOf(block), type: "image", ...image } : null;
    }
    case "question":
      return { ...idOf(block), ...questionFromOslf(block) };
    case "vakt": {
      const out = {
        ...idOf(block),
        type: "vakt" as const,
        text: typeof block.text === "string" ? block.text : "",
        links: listOf(block.links)
          .filter(
            (link): link is Fields & { url: string } =>
              isObject(link) && typeof link.url === "string",
          )
          .map((link) => ({
            url: link.url,
            label: typeof link.label === "string" ? link.label : "",
          })),
      };
      const image = block.image ? imageFromOslf(block.image) : null;
      if (image) Object.assign(out, image);
      return out;
    }
    case "heading":
      return {
        ...idOf(block),
        type: "heading",
        text: richTextPlain(block.text),
      };
    default:
      return null;
  }
}

// OSLF rich text as a tiptap paragraph (normalizeTextContent checks it).
function paragraphFromOslf(paragraph: unknown): RichNode {
  const runs = typeof paragraph === "string" ? [paragraph] : paragraph;
  const content: RichNode[] = [];
  for (const run of listOf(runs)) {
    if (typeof run === "string") {
      if (run) content.push({ type: "text", text: run });
    } else if (isObject(run) && typeof run.text === "string") {
      const marks: NonNullable<RichNode["marks"]> = [];
      if (run.bold) marks.push({ type: "bold" });
      if (run.italic) marks.push({ type: "italic" });
      if (run.underline) marks.push({ type: "underline" });
      // normalizeTextContent keeps the first of ipa, alias and sayAs.
      const { ipa, alias, sayAs } = run;
      if (ipa || alias || sayAs) {
        marks.push({ type: "speech", attrs: { ipa, alias, sayAs } });
      }
      if (run.text) content.push({ type: "text", text: run.text, marks });
    } else if (isObject(run) && run.pause) {
      content.push({ type: "pause", attrs: { length: run.pause } });
    } else if (isObject(run) && run.math) {
      // normalizeTextContent cleans the formula (normalizeFormula).
      const { format, source, display, spoken } = fieldsOf(run.math);
      content.push({
        type: "math",
        attrs: { format, source, display, spoken: spoken ?? null },
      });
    } else if (isObject(run) && run.note) {
      const note = fieldsOf(run.note);
      content.push({
        type: "footnote",
        attrs: {
          sourceId: typeof note.source === "string" ? note.source : null,
          locator: typeof note.locator === "string" ? note.locator : "",
          note: typeof note.text === "string" ? note.text : "",
        },
      });
    }
  }
  return content.length
    ? { type: "paragraph", content }
    : { type: "paragraph" };
}

// Rich text flattened to its words: a prompt, caption or heading is a plain
// string here. A formula reads as its source, as the format says to show it
// where it can't be rendered.
function richTextPlain(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((run: unknown) => {
      if (typeof run === "string") return run;
      const fields = fieldsOf(run);
      if (typeof fields.text === "string") return fields.text;
      const math = fieldsOf(fields.math);
      return typeof math.source === "string" ? math.source : "";
    })
    .join("");
}

function imageFromOslf(value: unknown): ImportedPicture | null {
  const image = fieldsOf(value);
  const src = typeof image.src === "string" ? image.src.trim() : "";
  // A relative file has nothing to be relative to once the lesson is in the
  // app; only an address the block can show is kept.
  if (!/^(https?:|data:)/i.test(src)) return null;
  const out: ImportedPicture = { src };
  if (isFiniteNumber(image.width)) out.width = image.width;
  if (isFiniteNumber(image.height)) out.height = image.height;
  const caption = richTextPlain(image.caption);
  const credit = creditText(image.credit);
  if (caption) out.caption = caption;
  if (credit) out.credit = credit;
  if (typeof image.size === "string") out.size = image.size;
  if (typeof image.align === "string") out.align = image.align;
  return out;
}

function creditText(credit: unknown): string {
  if (!isObject(credit)) return "";
  if (typeof credit.text === "string" && credit.text.trim()) {
    return credit.text.trim();
  }
  return [credit.author, credit.license]
    .filter((v) => typeof v === "string" && v.trim())
    .join(", ");
}

// OSLF rich text as inline text in its stored shape (a prompt, a step).
function inlineTextFromOslf(value: unknown): ImportedText {
  return normalizeInlineText({
    type: "doc",
    content: [paragraphFromOslf(value)],
  });
}

function questionFromOslf(block: Fields): ImportedQuestion {
  const prompt = inlineTextFromOslf(block.prompt);
  const answers = listOf(block.answers).filter(
    (a): a is string => typeof a === "string" && a.trim() !== "",
  );
  const suggested = block.answerKey === "suggested";
  // A type this app doesn't know is kept rather than dropped, as the format
  // asks: it becomes an untyped (legacy open) question with its prompt.
  const fromOslfType: Partial<Record<string, QuestionType>> = OSLF_TO_TYPE;
  const type = fromOslfType[String(block.questionType)] || "open";
  const base = { type: "question" as const, prompt };
  switch (type) {
    case "single":
    case "background":
      return { ...base, questionType: type, answer: answers[0] ?? "" };
    case "number":
      return {
        ...base,
        questionType: type,
        answer: answers[0] ?? "",
        // As the editor's step rows (normalizeLessonFile gives them ids).
        steps: listOf(block.working)
          .map((step) => ({ text: inlineTextFromOslf(step) }))
          .filter((step) => inlineTextPlain(step.text).trim()),
      };
    case "multiple": {
      if (suggested) return { ...base, questionType: "multiple_open", answers };
      const out: ImportedQuestion = {
        ...base,
        questionType: "multiple",
        answers,
      };
      if (block.threeBoard === true) out.threeBoard = true;
      if (typeof block.besides === "string") out.besides = block.besides;
      return out;
    }
    case "tight_open":
      return { ...base, questionType: type, answers };
    default:
      return { ...base, questionType: type };
  }
}
