// The Open Spelling Lesson Format (OSLF): reading and writing a lesson as the
// method-neutral file other tools can read.
//
// OSLF is the vocabulary the app's question types follow (see questions.js),
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
//     math question's working are inline text (see inlineText.js), which
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
import { normalizeTextContent, textBlockContent } from "./lessonText.ts";
import {
  isThreeBoard,
  questionAnswerItems,
  questionBesides,
  questionMeta,
  resolveOpenType,
} from "./questions.ts";
import { SOURCE_FIELDS } from "./sources.ts";
import { vaktLinks, vaktText } from "./vakt.ts";

/** The OSLF version this module writes. */
export const OSLF_VERSION = "0.1";

/** The file name extension the format recommends. */
export const OSLF_EXTENSION = ".oslf.json";

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
};
const OSLF_TO_TYPE = {
  known: "single",
  "prior-knowledge": "background",
  math: "number",
  "semi-open": "multiple",
  "tight-open": "tight_open",
  "broad-open": "broad_open",
  paraphrase: "paraphrase",
  "would-you-rather": "wyr",
};

/**
 * Whether a parsed JSON value is an OSLF lesson file, as opposed to the app's
 * own lesson file or something else.
 * @param {unknown} parsed
 * @returns {boolean}
 */
export function isOslfFile(parsed) {
  return Boolean(
    parsed &&
    typeof parsed === "object" &&
    typeof (/** @type {any} */ (parsed).oslf) === "string",
  );
}

/**
 * A file name for a lesson exported as OSLF, from its title: the same stem
 * the app's own lesson file gets, with the format's extension.
 * @param {string} [title]
 * @returns {string}
 */
export function oslfFileName(title) {
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
  constructor(message) {
    super(message);
    this.name = "OslfExportError";
  }
}

// The types the format requires at least one answer for (known, math,
// semi-open and prior-knowledge all do). A draft with one of these still
// blank can't be a valid file, so exporting it stops rather than writing a
// file every reader of the format would reject.
const ANSWER_REQUIRED_TYPES = new Set([
  "single",
  "background",
  "number",
  "multiple",
  "multiple_open",
]);

// The format's one-line strings (a prompt, a heading, a caption, a run of
// rich text) can't hold a line break. The editor's fields can, so a break is
// written as a space on the way out.
function oneLine(value) {
  return String(value ?? "").replace(/\s*\r?\n\s*/g, " ");
}

/**
 * A lesson document as an OSLF lesson file. Throws OslfExportError for a
 * lesson the format can't hold as it stands (see the class).
 *
 * @param {object} doc  The app's lesson document.
 * @param {{ imageSrc?: (block: object) => string | null | undefined }} [options]
 *   `imageSrc` gives the URL a picture is reachable at, for a block that
 *   refers to its bytes by hash. A block that already carries a `src` data
 *   URL uses that. A picture with no URL either way is left out, caption and
 *   all, because an image block in the format needs one.
 * @returns {object}
 */
export function toOslf(doc, { imageSrc } = {}) {
  const out = { oslf: OSLF_VERSION, title: String(doc?.title || "Untitled") };
  if (typeof doc?.ageRange === "string" && doc.ageRange.trim()) {
    out.ageRange = doc.ageRange.trim();
  }
  const sources = (Array.isArray(doc?.sources) ? doc.sources : [])
    .map(sourceToOslf)
    .filter(Boolean);
  if (sources.length) out.sources = sources;
  out.sections = (Array.isArray(doc?.sections) ? doc.sections : []).map(
    (section, si) => {
      let questions = 0;
      const blocks = (Array.isArray(section?.blocks) ? section.blocks : [])
        .map((block) => {
          if (block?.type === "question") {
            questions += 1;
            requireAnswer(block, si + 1, questions);
          }
          return blockToOslf(block, imageSrc);
        })
        .filter(Boolean);
      const result = {};
      if (typeof section?.id === "string" && section.id) result.id = section.id;
      if (typeof section?.name === "string" && section.name.trim()) {
        result.title = section.name.trim();
      }
      result.blocks = blocks;
      return result;
    },
  );
  return out;
}

function requireAnswer(block, section, number) {
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

function sourceToOslf(source) {
  if (!source || typeof source !== "object" || !source.id) return null;
  const out = { id: String(source.id) };
  for (const field of SOURCE_FIELDS) {
    const value = typeof source[field] === "string" ? source[field].trim() : "";
    if (value) out[field] = value;
  }
  return out;
}

function withId(block, out) {
  return typeof block?.id === "string" && block.id
    ? { id: block.id, ...out }
    : out;
}

function blockToOslf(block, imageSrc) {
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
      const out = { type: "vakt", text };
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
function passageOf(block) {
  const content = textBlockContent(block);
  const paragraphs = (content?.content || []).map(paragraphToOslf);
  return paragraphs.length ? paragraphs : [""];
}

// One stored paragraph as OSLF rich text.
function paragraphToOslf(paragraph) {
  const runs = [];
  for (const node of paragraph.content || []) {
    if (node.type === "pause") {
      runs.push({ pause: node.attrs?.length === "long" ? "long" : "short" });
    } else if (node.type === "math") {
      const { format, source, display, spoken } = node.attrs;
      const math = { format, source: oneLine(source) };
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
      const run = { text };
      if (marks.has("bold")) run.bold = true;
      if (marks.has("italic")) run.italic = true;
      if (marks.has("underline")) run.underline = true;
      // The stored mark already holds exactly one of the format's three.
      if (speech) Object.assign(run, speech.attrs);
      runs.push(run);
    } else if (node.type === "footnote") {
      const note = {};
      const { sourceId, locator, note: text } = node.attrs || {};
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
function inlineTextToOslf(value) {
  if (typeof value === "string") return oneLine(value);
  return paragraphToOslf(inlineTextContent(value).content[0]);
}

function imageToOslf(block, imageSrc) {
  const src =
    typeof block?.src === "string" && block.src
      ? block.src
      : block?.image?.hash && imageSrc
        ? imageSrc(block)
        : null;
  if (typeof src !== "string" || !src) return null;
  const out = { src };
  const parts = imageCaptionParts(block);
  const caption = oneLine(parts.caption);
  const { credit } = parts;
  if (caption) {
    out.alt = caption;
    out.caption = caption;
  }
  if (credit) out.credit = { text: credit };
  if (Number.isFinite(block.width) && block.width > 0) out.width = block.width;
  if (Number.isFinite(block.height) && block.height > 0) {
    out.height = block.height;
  }
  if (["small", "medium", "large", "full"].includes(block.size)) {
    out.size = block.size;
  }
  if (["left", "center", "right"].includes(block.align)) {
    out.align = block.align;
  }
  return out;
}

function questionToOslf(block) {
  const type = resolveOpenType(block);
  const questionType = TYPE_TO_OSLF[type] || "broad-open";
  const out = {
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
    case "multiple":
      if (answers.length) out.answers = answers;
      if (isThreeBoard(block)) out.threeBoard = true;
      if (questionBesides(block) != null) out.besides = questionBesides(block);
      break;
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
  constructor(message) {
    super(message);
    this.name = "OslfImportError";
  }
}

/**
 * An OSLF lesson file as the app's lesson document, before normalizing: the
 * shape jsonImport's normalizeLessonFile accepts as a bare doc, which gives
 * every block an id and drops what it can't keep. Throws OslfImportError for
 * a file of a version this can't read.
 *
 * @param {object} file  The parsed OSLF file.
 * @returns {{ title: string, ageRange?: string, sources?: object[], sections: object[] }}
 */
export function fromOslf(file) {
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
  const doc = {
    title: typeof file.title === "string" ? file.title : "",
    sections: (Array.isArray(file.sections) ? file.sections : []).map(
      (section) => ({
        ...(typeof section?.id === "string" ? { id: section.id } : {}),
        name: typeof section?.title === "string" ? section.title : "",
        blocks: (Array.isArray(section?.blocks) ? section.blocks : [])
          .map(blockFromOslf)
          .filter(Boolean),
      }),
    ),
  };
  if (typeof file.ageRange === "string") doc.ageRange = file.ageRange;
  if (Array.isArray(file.sources)) {
    doc.sources = file.sources
      .filter((s) => s && typeof s === "object" && typeof s.id === "string")
      .map((s) => {
        const out = { id: s.id };
        for (const field of SOURCE_FIELDS) {
          if (typeof s[field] === "string") out[field] = s[field];
        }
        return out;
      });
  }
  return doc;
}

function idOf(block) {
  return typeof block?.id === "string" && block.id ? { id: block.id } : {};
}

function blockFromOslf(block) {
  if (!block || typeof block !== "object") return null;
  switch (block.type) {
    case "passage": {
      const paragraphs = Array.isArray(block.paragraphs)
        ? block.paragraphs
        : [];
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
        words: (Array.isArray(block.words) ? block.words : []).filter(
          (w) => typeof w === "string",
        ),
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
        type: "vakt",
        text: typeof block.text === "string" ? block.text : "",
        links: (Array.isArray(block.links) ? block.links : [])
          .filter((link) => link && typeof link.url === "string")
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
function paragraphFromOslf(paragraph) {
  const runs = typeof paragraph === "string" ? [paragraph] : paragraph;
  const content = [];
  for (const run of Array.isArray(runs) ? runs : []) {
    if (typeof run === "string") {
      if (run) content.push({ type: "text", text: run });
    } else if (run && typeof run === "object" && typeof run.text === "string") {
      const marks = [];
      if (run.bold) marks.push({ type: "bold" });
      if (run.italic) marks.push({ type: "italic" });
      if (run.underline) marks.push({ type: "underline" });
      // normalizeTextContent keeps the first of ipa, alias and sayAs.
      const { ipa, alias, sayAs } = run;
      if (ipa || alias || sayAs) {
        marks.push({ type: "speech", attrs: { ipa, alias, sayAs } });
      }
      if (run.text) content.push({ type: "text", text: run.text, marks });
    } else if (run && typeof run === "object" && run.pause) {
      content.push({ type: "pause", attrs: { length: run.pause } });
    } else if (run && typeof run === "object" && run.math) {
      // normalizeTextContent cleans the formula (normalizeFormula).
      const { format, source, display, spoken } = run.math;
      content.push({
        type: "math",
        attrs: { format, source, display, spoken: spoken ?? null },
      });
    } else if (run && typeof run === "object" && run.note) {
      const note = run.note;
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
function richTextPlain(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((run) =>
      typeof run === "string"
        ? run
        : run && typeof run.text === "string"
          ? run.text
          : typeof run?.math?.source === "string"
            ? run.math.source
            : "",
    )
    .join("");
}

function imageFromOslf(image) {
  const src = typeof image?.src === "string" ? image.src.trim() : "";
  // A relative file has nothing to be relative to once the lesson is in the
  // app; only an address the block can show is kept.
  if (!/^(https?:|data:)/i.test(src)) return null;
  const out = { src };
  if (Number.isFinite(image.width)) out.width = image.width;
  if (Number.isFinite(image.height)) out.height = image.height;
  const caption = richTextPlain(image.caption);
  const credit = creditText(image.credit);
  if (caption) out.caption = caption;
  if (credit) out.credit = credit;
  if (typeof image.size === "string") out.size = image.size;
  if (typeof image.align === "string") out.align = image.align;
  return out;
}

function creditText(credit) {
  if (!credit || typeof credit !== "object") return "";
  if (typeof credit.text === "string" && credit.text.trim()) {
    return credit.text.trim();
  }
  return [credit.author, credit.license]
    .filter((v) => typeof v === "string" && v.trim())
    .join(", ");
}

// OSLF rich text as inline text in its stored shape (a prompt, a step).
function inlineTextFromOslf(value) {
  return normalizeInlineText({
    type: "doc",
    content: [paragraphFromOslf(value)],
  });
}

function questionFromOslf(block) {
  const prompt = inlineTextFromOslf(block.prompt);
  const answers = (Array.isArray(block.answers) ? block.answers : []).filter(
    (a) => typeof a === "string" && a.trim(),
  );
  const suggested = block.answerKey === "suggested";
  // A type this app doesn't know is kept rather than dropped, as the format
  // asks: it becomes an untyped (legacy open) question with its prompt.
  const type = OSLF_TO_TYPE[block.questionType] || "open";
  const base = { type: "question", prompt };
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
        steps: (Array.isArray(block.working) ? block.working : [])
          .map((step) => ({ text: inlineTextFromOslf(step) }))
          .filter((step) => inlineTextPlain(step.text).trim()),
      };
    case "multiple": {
      if (suggested) return { ...base, questionType: "multiple_open", answers };
      const out = { ...base, questionType: "multiple", answers };
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
