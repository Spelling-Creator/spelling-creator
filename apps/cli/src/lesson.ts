// Reading a lesson from whatever file holds it, and writing one back out.
//
// Three kinds of file come in. A .json lesson file is the app's own lossless
// format and goes through core's jsonImport. A .docx or a text file (.txt,
// .md, or anything else) is a document that was never a lesson file: its
// text goes through core's rules parser (documentImport.ts), the same one the
// web app's "Import from text" uses. That parser works out question types and
// answers from the wording, so a lesson read that way comes with notes saying
// so, and naming anything it could not place, for the report to show.
//
// A Word file is read as plain text here, even one this app exported. The
// styled import that reads question types back from the exporter's character
// styles (core's browser/docxImport.js) needs a DOM and the browser's image
// store, so it stays in the browser for now; the rules read an exported file
// well enough, since its "Spell:" line and answer gaps are shapes they know.
//
// Everything written out is a .json lesson file, so a converted or fixed
// lesson opens in the editor and round-trips from there, unless the output
// path ends in .oslf.json, which writes the Open Spelling Lesson Format
// (core's oslf.ts) for tools that aren't this app, or .oslf.xml, which writes
// the format's XML form (core's oslfXml.ts). An .oslf.json file reads through
// the same door as a .json one, since core's jsonImport knows both; an .xml
// file is read as the XML form into the same OSLF file first.

import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import mammoth from "mammoth";

import {
  DocumentImportError,
  lessonFromSections,
  readLessonText,
  sectionNeedsModel,
} from "@spelling-creator/core/documentImport";
import {
  JsonImportError,
  normalizeLessonFile,
} from "@spelling-creator/core/jsonImport";
import { buildLessonFile } from "@spelling-creator/core/lessonFile";
import {
  OSLF_EXTENSION,
  OslfExportError,
  OslfImportError,
  isOslfFile,
  toOslf,
  type OslfFile,
} from "@spelling-creator/core/oslf";
import {
  OSLF_XML_EXTENSION,
  fromOslfXml,
  toOslfXml,
} from "@spelling-creator/core/oslfXml";
import type { LessonDoc } from "@spelling-creator/core/types";

/** Whether a path names an Open Spelling Lesson Format file, as JSON or XML. */
export function isOslfPath(path: string): boolean {
  return path.toLowerCase().endsWith(OSLF_EXTENSION) || isOslfXmlPath(path);
}

/** Whether a path names an OSLF file in the format's XML form. */
export function isOslfXmlPath(path: string): boolean {
  return path.toLowerCase().endsWith(OSLF_XML_EXTENSION);
}

export type LessonSource = "json" | "xml" | "docx" | "text";

export interface ReadLesson {
  doc: LessonDoc;
  source: LessonSource;
  /** What the reader wants the author to know, in order. Empty for a .json file. */
  notes: string[];
  /** A hash of the file as read, so a rewrite can tell whether it changed since. */
  hash: string;
  /** For a .json file, what it held before normalizing, to see what a rewrite would drop. */
  raw?: unknown;
}

/** Thrown when a file cannot be read as a lesson. The message is for the user. */
export class LessonReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LessonReadError";
  }
}

/** Which reader a path gets, by its extension. */
export function sourceOf(path: string): LessonSource {
  const ext = extname(path).toLowerCase();
  if (ext === ".json") return "json";
  // Only by the format's own extension, so a lesson rewritten in place is
  // written back as the XML it was.
  if (isOslfXmlPath(path)) return "xml";
  if (ext === ".docx") return "docx";
  return "text";
}

/** Read a lesson from a file of any supported kind. */
export async function readLesson(path: string): Promise<ReadLesson> {
  const source = sourceOf(path);
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new LessonReadError(`Couldn't read ${path}: ${reason}`);
  }

  const hash = hashOf(bytes);
  if (source === "json" || source === "xml") {
    const text = bytes.toString("utf8");
    return {
      ...(source === "xml" ? lessonFromXml(text) : lessonFromJson(text)),
      source,
      notes: [],
      hash,
    };
  }

  const text =
    source === "docx" ? await docxText(bytes) : bytes.toString("utf8");
  return { ...lessonFromText(text), source, hash };
}

function hashOf(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function lessonFromJson(text: string): { doc: LessonDoc; raw: unknown } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new LessonReadError(
      "This file isn't valid JSON. It may be corrupted or not a lesson file.",
    );
  }
  try {
    return { doc: normalizeLessonFile(raw), raw };
  } catch (err) {
    if (err instanceof JsonImportError) throw new LessonReadError(err.message);
    throw err;
  }
}

// An OSLF lesson in its XML form, read into the OSLF file first, so `raw` is
// that file, the same as for an .oslf.json.
function lessonFromXml(text: string): { doc: LessonDoc; raw: unknown } {
  let raw: unknown;
  try {
    raw = fromOslfXml(text);
    return { doc: normalizeLessonFile(raw), raw };
  } catch (err) {
    if (err instanceof OslfImportError || err instanceof JsonImportError) {
      throw new LessonReadError(err.message);
    }
    throw err;
  }
}

// How many dropped fields a refusal names before it summarizes the rest.
const DROPPED_SHOWN = 5;

/**
 * What writing `doc` back over the .json file it was read from would lose:
 * the paths of fields and items in `raw` (the file as parsed) that the
 * written lesson file would not have. Empty when the rewrite keeps everything.
 *
 * Reading a lesson normalizes it, keeping only what the editor understands,
 * so a field a newer version added, a block type this one doesn't know, or
 * `trustedCollaborators` (which a lesson file leaves out on purpose) would
 * quietly vanish from a file rewritten in place. A plain text block's
 * `content` coming back as `text` is the same words in the smaller shape the
 * import stores, so it isn't counted.
 */
export function droppedFields(raw: unknown, doc: LessonDoc): string[] {
  // An OSLF file is written back as OSLF, a different shape altogether, so a
  // field-for-field comparison with the app's own file would name everything.
  if (isOslfFile(raw)) return [];
  const written = buildLessonFile(doc);
  const dropped: string[] = [];
  if (isObject(raw) && isObject(raw.doc)) {
    if (raw.version !== undefined && raw.version !== written.version) {
      dropped.push(`version (${String(raw.version)})`);
    }
    missingFrom(raw, written, "", dropped);
  } else {
    missingFrom(raw, written.doc, "", dropped);
  }
  return dropped;
}

/** Name the dropped fields for a message, the first few in full. */
export function describeDropped(dropped: string[]): string {
  const shown = dropped.slice(0, DROPPED_SHOWN).join(", ");
  const more = dropped.length - DROPPED_SHOWN;
  return more > 0 ? `${shown}, and ${more} more` : shown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function missingFrom(
  before: unknown,
  after: unknown,
  path: string,
  out: string[],
): void {
  if (Array.isArray(before)) {
    // Normalizing only ever drops items (never reorders them), so a shorter
    // list has lost something, and items line up by position otherwise.
    if (!Array.isArray(after) || after.length < before.length) {
      out.push(
        `${path} (${before.length} items, ${Array.isArray(after) ? after.length : 0} kept)`,
      );
      return;
    }
    before.forEach((item, i) =>
      missingFrom(item, after[i], `${path}[${i}]`, out),
    );
    return;
  }
  if (!isObject(before)) return;
  if (!isObject(after)) {
    out.push(path || "the lesson");
    return;
  }
  for (const key of Object.keys(before)) {
    const at = path ? `${path}.${key}` : key;
    if (key in after) {
      missingFrom(before[key], after[key], at, out);
    } else if (
      !(key === "content" && after.type === "text" && "text" in after)
    ) {
      out.push(at);
    }
  }
}

async function docxText(bytes: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer: bytes });
    return result.value;
  } catch {
    throw new LessonReadError(
      "This file couldn't be read as a Word document. It may be corrupted or not a real .docx file.",
    );
  }
}

const TYPED_NOTE =
  "Read as a typed document: the question types and answers were worked out from the wording, so check them.";

// How much of an unplaced line a note quotes.
const QUOTE_LENGTH = 60;

/**
 * A lesson from the text of a document, with notes on what the rules had to
 * guess and what they could not place.
 */
export function lessonFromText(text: string): {
  doc: LessonDoc;
  notes: string[];
} {
  const { title, loose, sections } = readLessonText(text);
  if (loose) {
    throw new LessonReadError(
      "No lesson was found in this file. It needs at least one passage followed by its questions, one question per line.",
    );
  }

  const notes = [TYPED_NOTE];
  sections.forEach(({ parsed }, i) => {
    const label = parsed.name
      ? `Section ${i + 1} (${parsed.name})`
      : `Section ${i + 1}`;
    for (const line of parsed.unread ?? []) {
      notes.push(
        `${label}: this line couldn't be placed and was left out: "${quote(line)}"`,
      );
    }
    if (parsed.questions.length === 0) {
      notes.push(`${label}: no questions were found.`);
    } else if (!(parsed.unread ?? []).length && sectionNeedsModel(parsed)) {
      notes.push(
        `${label}: a question may still have its answer glued to it, or several may have run together on one line.`,
      );
    }
  });

  let doc: LessonDoc;
  try {
    doc = lessonFromSections(
      title,
      sections.map(({ parsed }) => parsed),
    );
  } catch (err) {
    if (err instanceof DocumentImportError) {
      throw new LessonReadError(err.message);
    }
    throw err;
  }
  return { doc, notes };
}

function quote(line: string): string {
  const flat = line.replace(/\s+/g, " ").trim();
  return flat.length > QUOTE_LENGTH
    ? `${flat.slice(0, QUOTE_LENGTH - 1)}…`
    : flat;
}

/** Where a converted or fixed copy of `input` goes when no path is given: beside it, as .json. */
export function defaultOutputPath(input: string): string {
  const stem = basename(input, extname(input));
  return join(dirname(input), `${stem}.json`);
}

/** Thrown when a lesson cannot be written. The message is for the user. */
export class LessonWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LessonWriteError";
  }
}

/** Thrown when writing would overwrite a file the user didn't say to replace. */
export class OutputExistsError extends LessonWriteError {
  constructor(path: string) {
    super(`${path} already exists. Pass --force to replace it.`);
    this.name = "OutputExistsError";
  }
}

/** Thrown when the file being replaced changed after it was read. */
export class LessonChangedError extends LessonWriteError {
  constructor(path: string) {
    super(
      `${path} changed after it was read, so it was left as it is. Run the command again to work on the new version.`,
    );
    this.name = "LessonChangedError";
  }
}

export interface WriteOptions {
  /** Replace the file if it exists. */
  force?: boolean;
  /**
   * The hash readLesson gave the file when it was read. When set, the file is
   * only replaced if it still hashes the same, so a save made in between (by
   * the editor, or anything else) isn't overwritten with a stale copy.
   */
  unchangedSince?: string;
}

// The lesson as an OSLF file. Pictures in one are URLs, and the CLI has no
// image store or hub to resolve a stored picture against, so a picture the
// lesson refers to by hash alone is left out; one carrying a data URL is
// kept. A lesson the format can't hold (a question it requires an answer for
// is blank) is a write that fails, reported like any other.
function oslfFile(path: string, doc: LessonDoc): OslfFile {
  try {
    return toOslf(doc);
  } catch (err) {
    if (err instanceof OslfExportError) {
      throw new LessonWriteError(`Couldn't write ${path}: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Write a lesson as an importable .json lesson file. Refuses to replace an
 * existing file unless `force` is set, since the input may be the only copy.
 * The refusal is the open itself ("wx"), so nothing can appear in between.
 *
 * A forced write goes to a temporary file beside the target and is renamed
 * over it, so the file being replaced (for `fix`, the lesson itself) stays
 * whole until the new one is complete, rather than being truncated first and
 * lost if the write fails partway.
 */
export async function writeLesson(
  path: string,
  doc: LessonDoc,
  { force = false, unchangedSince }: WriteOptions = {},
): Promise<void> {
  const file = isOslfPath(path) ? oslfFile(path, doc) : null;
  const contents =
    file && isOslfXmlPath(path)
      ? toOslfXml(file)
      : `${JSON.stringify(file ?? buildLessonFile(doc), null, 2)}\n`;
  try {
    if (force) {
      await replaceFile(path, contents, unchangedSince);
    } else {
      await writeFile(path, contents, { encoding: "utf8", flag: "wx" });
    }
  } catch (err) {
    if (err instanceof LessonWriteError) throw err;
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new OutputExistsError(path);
    }
    const reason = err instanceof Error ? err.message : String(err);
    throw new LessonWriteError(`Couldn't write ${path}: ${reason}`);
  }
}

// The same directory as the target, so the rename stays on one filesystem
// and is atomic. The temporary file is removed if anything fails.
//
// The changed-since check runs after the new file is complete, as close to
// the rename as it can be. A save landing between the two would still be
// lost, but that window is the length of one read, not of the whole command.
async function replaceFile(
  path: string,
  contents: string,
  unchangedSince: string | undefined,
): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, contents, { encoding: "utf8", flag: "wx" });
    if (unchangedSince !== undefined) {
      const now = await readFile(path).then(hashOf, () => null);
      if (now !== unchangedSince) throw new LessonChangedError(path);
    }
    await rename(temp, path);
  } catch (err) {
    await rm(temp, { force: true });
    throw err;
  }
}
