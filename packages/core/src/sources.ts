// A lesson's sources: the books, articles and websites its text draws on.
//
// Sources belong to the lesson, not to a block. They live in `doc.sources` as
// a list of { id, title, author, publisher, year, url } rows, and text blocks
// cite them through footnotes that carry a `sourceId` (see lessonText.ts).
// Keeping one list means a source cited in five places is written once, edited
// once, and printed once in the Sources list at the end of the lesson.
//
// Every field is a plain string and every one is optional, because a source is
// often half-known ("a National Geographic article"). What a source needs to be
// worth printing is a title, an author or a link; sourceHasContent decides that.
//
// Two printed forms come out of here, as runs ({ text, italic?, url? }) so each
// renderer can set the title in italics and the address as a link in its own
// way (React, docx, plain text):
//
//   sourceEntryParts     the Sources list entry: "Jane Smith. Cats of Egypt.
//                        Penguin, 2020. https://..."
//   sourceCitationParts  the shorter form a footnote uses: "Jane Smith, Cats of
//                        Egypt (Penguin, 2020), p. 12." The address is left out
//                        here; it is in the Sources list. The locator run is
//                        tagged `role: "locator"`, so the Word export can mark
//                        it with a style the importer reads back exactly.

import { isObjectLike } from "./guards.ts";
import { isSafeLink } from "./richText.ts";
import type { Source } from "./types.ts";

/** The fields a source carries, in the order the editor shows them. */
export const SOURCE_FIELDS = [
  "title",
  "author",
  "publisher",
  "year",
  "url",
] as const;

export type SourceField = (typeof SOURCE_FIELDS)[number];

/**
 * A run of printed text. The renderer sets an `italic` run in italics and
 * links a `url` run; `role` tags the runs the Word export styles.
 */
export interface CitationPart {
  text: string;
  italic?: boolean;
  url?: string;
  role?: "locator" | "note";
}

// Generous ceilings, so a pasted paragraph can't pass itself off as a title.
const FIELD_LIMITS = {
  title: 500,
  author: 300,
  publisher: 300,
  year: 40,
  url: 2000,
} satisfies Record<SourceField, number>;

// What a source id may look like. The editor makes uuids; the MCP server lets
// an assistant pick readable keys ("smith2020") that its markup refers to.
const SOURCE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Whether a value is usable as a source id. */
export function isSourceId(id: unknown): id is string {
  return typeof id === "string" && SOURCE_ID.test(id);
}

/** A fresh, empty source for the editor to fill in. */
export function createSource(newId: () => string): Source {
  return {
    id: newId(),
    title: "",
    author: "",
    publisher: "",
    year: "",
    url: "",
  };
}

/**
 * One source in its exact stored shape, or null when it has no usable id.
 *
 * A url that isn't a safe http/https/mailto address is dropped rather than
 * stored: renderers link it, and `javascript:` in an href executes.
 */
export function normalizeSource(raw: unknown): Source | null {
  if (!isObjectLike(raw) || !isSourceId(raw.id)) return null;
  const source: Source = {
    id: raw.id,
    title: "",
    author: "",
    publisher: "",
    year: "",
    url: "",
  };
  for (const field of SOURCE_FIELDS) {
    const given = raw[field];
    const value = typeof given === "string" ? given.trim() : "";
    source[field] = value.slice(0, FIELD_LIMITS[field]);
  }
  if (source.url && !isSafeLink(source.url)) source.url = "";
  return source;
}

/** Whether a source has enough in it to print. */
export function sourceHasContent(
  source: Partial<Source> | null | undefined,
): boolean {
  return Boolean(
    source &&
    ((source.title || "").trim() ||
      (source.author || "").trim() ||
      (source.url || "").trim()),
  );
}

/**
 * A lesson's source list, normalised: malformed rows and repeated ids are
 * dropped, and so (with `dropEmpty`) are rows with nothing worth printing. The
 * editor keeps empty rows while someone is filling one in; importers don't.
 */
export function normalizeSources(
  list: unknown,
  { dropEmpty = false }: { dropEmpty?: boolean } = {},
): Source[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const raw of list) {
    const source = normalizeSource(raw);
    if (!source || seen.has(source.id)) continue;
    if (dropEmpty && !sourceHasContent(source)) continue;
    seen.add(source.id);
    out.push(source);
  }
  return out;
}

/**
 * The sources a renderer should list: the document's own, in the order the
 * author put them, without empty rows.
 */
export function lessonSources(doc: { sources?: unknown }): Source[] {
  return normalizeSources(doc?.sources, { dropEmpty: true });
}

/**
 * The lesson's sources keyed by id, for resolving a footnote's `sourceId`.
 * Empty rows are kept here: a footnote may cite a source someone is still
 * filling in, and it should keep its place rather than vanish.
 */
export function sourcesById(doc: { sources?: unknown }): Map<string, Source> {
  const map = new Map<string, Source>();
  for (const source of normalizeSources(doc?.sources)) {
    map.set(source.id, source);
  }
  return map;
}

// Ends a run of text with a full stop unless it already ends in punctuation.
function withStop(text: string) {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

// "Penguin, 2020", or whichever half is known.
function imprint(source: Partial<Source>) {
  return [source.publisher, source.year]
    .map((part) => (part || "").trim())
    .filter(Boolean)
    .join(", ");
}

/** A source as its Sources list entry, in runs. */
export function sourceEntryParts(
  source: Partial<Source> | null | undefined,
): CitationPart[] {
  const parts: CitationPart[] = [];
  const author = (source?.author || "").trim();
  const title = (source?.title || "").trim();
  const details = imprint(source || {});
  const url = (source?.url || "").trim();

  if (author) parts.push({ text: `${withStop(author)} ` });
  if (title) {
    parts.push({ text: title, italic: true });
    parts.push({ text: title.match(/[.!?]$/) ? " " : ". " });
  }
  if (details) parts.push({ text: `${withStop(details)} ` });
  if (url && isSafeLink(url)) parts.push({ text: url, url });

  return trimParts(parts);
}

/**
 * A source as a footnote cites it, in runs, with the locator ("p. 12") added
 * before the closing full stop.
 */
export function sourceCitationParts(
  source: Partial<Source> | null | undefined,
  locator = "",
): CitationPart[] {
  const parts: CitationPart[] = [];
  const author = (source?.author || "").trim();
  const title = (source?.title || "").trim();
  const details = imprint(source || {});
  const url = (source?.url || "").trim();
  const where = (locator || "").trim();

  // Without a title the address stands in for it, so a bare link still says
  // which page was meant.
  const name = title || (isSafeLink(url) ? url : "");
  if (author) parts.push({ text: name ? `${author}, ` : author });
  if (title) parts.push({ text: title, italic: true });
  else if (name) parts.push({ text: name, url: name });
  if (details) parts.push({ text: ` (${details})` });
  if (where) {
    parts.push({ text: parts.length ? `, ${where}` : where, role: "locator" });
  }

  const trimmed = trimParts(parts);
  if (!trimmed.length) return trimmed;
  const last = trimmed[trimmed.length - 1];
  // A link and the locator keep their exact text (a locator is read back off
  // the export run for run); the stop goes after them as a run of its own.
  if (last.url || last.italic || last.role === "locator") {
    if (!/[.!?]$/.test(last.text)) trimmed.push({ text: "." });
  } else {
    trimmed[trimmed.length - 1] = { ...last, text: withStop(last.text) };
  }
  return trimmed;
}

/** Runs flattened to a plain string. */
export function partsText(parts: ReadonlyArray<{ text: string }>): string {
  return parts.map((part) => part.text).join("");
}

/** A source's Sources list entry as plain text. */
export function sourceEntryText(
  source: Partial<Source> | null | undefined,
): string {
  return partsText(sourceEntryParts(source));
}

// Drop the trailing space the builders above leave after the last piece.
function trimParts(parts: CitationPart[]) {
  const out = parts.filter((part) => part.text);
  if (out.length) {
    const last = out[out.length - 1];
    if (!last.url) {
      const text = last.text.replace(/\s+$/, "");
      if (text) out[out.length - 1] = { ...last, text };
      else out.pop();
    }
  }
  return out;
}
