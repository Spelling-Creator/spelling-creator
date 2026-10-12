// Reading a lesson from whatever file holds it, and writing one back out.
//
// Three kinds of file come in. A .json lesson file is the app's own lossless
// format and goes through core's jsonImport. A .docx or a text file (.txt,
// .md, or anything else) is a document that was never a lesson file: its
// text goes through core's rules parser (documentImport.js), the same one the
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
// lesson opens in the editor and round-trips from there.

import { readFile, writeFile } from "node:fs/promises";
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

import type { LessonDoc } from "./types.ts";

export type LessonSource = "json" | "docx" | "text";

export interface ReadLesson {
  doc: LessonDoc;
  source: LessonSource;
  /** What the reader wants the author to know, in order. Empty for a .json file. */
  notes: string[];
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

  if (source === "json") {
    return { doc: lessonFromJson(bytes.toString("utf8")), source, notes: [] };
  }

  const text =
    source === "docx" ? await docxText(bytes) : bytes.toString("utf8");
  return { ...lessonFromText(text), source };
}

function lessonFromJson(text: string): LessonDoc {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LessonReadError(
      "This file isn't valid JSON. It may be corrupted or not a lesson file.",
    );
  }
  try {
    return normalizeLessonFile(parsed);
  } catch (err) {
    if (err instanceof JsonImportError) throw new LessonReadError(err.message);
    throw err;
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
export function lessonFromText(text: string): Omit<ReadLesson, "source"> {
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

/**
 * Write a lesson as an importable .json lesson file. Refuses to replace an
 * existing file unless `force` is set, since the input may be the only copy.
 * The refusal is the open itself ("wx"), so nothing can appear in between.
 */
export async function writeLesson(
  path: string,
  doc: LessonDoc,
  { force = false } = {},
): Promise<void> {
  const json = JSON.stringify(buildLessonFile(doc), null, 2);
  try {
    await writeFile(path, `${json}\n`, {
      encoding: "utf8",
      flag: force ? "w" : "wx",
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new OutputExistsError(path);
    }
    const reason = err instanceof Error ? err.message : String(err);
    throw new LessonWriteError(`Couldn't write ${path}: ${reason}`);
  }
}
