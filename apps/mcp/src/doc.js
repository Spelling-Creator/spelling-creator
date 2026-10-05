// Build the canonical editor document (`doc`) from the LLM-friendly lesson input
// the tools accept. The Worker stores `doc` verbatim and the web editor renders
// it, so the shapes here must match the editor's exactly. They are kept in sync
// with:
//   • packages/core/src/questions.js  (question block shapes, the eight types)
//   • packages/core/src/spelling.js   (spelling block shape)
//   • packages/core/src/vakt.js       (VAKT activity block shape)
//   • packages/core/src/id.js         (id generation)
//
// The canonical doc is:
//   { title, sources?, sections: [ { id, name, blocks: [ Block, ... ] } ] }
//
// Text blocks are written in a small markup (see "Markup" in
// packages/core/src/lessonText.js): **bold**, *italic*, <u>underline</u>, and
// footnotes as ^[a note] or ^[@sourceId, p. 12 | a note]. A block with none of
// that is stored as a plain `text` string, exactly as before; one with any of it
// is stored as a formatted `content` document. presentDoc turns stored blocks
// back into the same markup, so what get_lesson shows can be sent straight back.
// Blocks carry a stable `id`; we generate every id here so callers (and the AI
// assistant driving them) never have to. Input is intentionally simpler than the
// stored shape — e.g. spelling words are plain strings here, objects in the doc.

import { IMAGE_ALIGNS } from "@spelling-creator/core/image";
import { isSafeLink } from "@spelling-creator/core/richText";
import {
  markupToContent,
  normalizeTextContent,
  textBlockMarkup,
  withTextBlockContent,
} from "@spelling-creator/core/lessonText";
import {
  SOURCE_FIELDS,
  isSourceId,
  normalizeSource,
  sourceHasContent,
} from "@spelling-creator/core/sources";

import { extFromMime } from "./images.js";

export function newId() {
  return crypto.randomUUID();
}

export const QUESTION_TYPES = [
  "number",
  "single",
  "multiple",
  "multiple_open",
  "paraphrase",
  "open",
  "wyr",
  "background",
];

// Map one input block to its stored form. Throws a descriptive Error on bad
// input so the assistant gets actionable feedback it can correct. Exported so
// the patch logic (patch.js) can build single blocks the same way.
export function buildBlock(block, where) {
  if (!block || typeof block !== "object") {
    throw new Error(`${where}: each block must be an object.`);
  }
  switch (block.type) {
    case "text": {
      // `content` is the stored form, passed through when a block read some
      // other way comes back unchanged; `text` is the markup an assistant writes.
      const stored = normalizeTextContent(block.content);
      if (stored && typeof block.text !== "string") {
        return withTextBlockContent({ id: newId(), type: "text" }, stored);
      }
      if (typeof block.text !== "string") {
        throw new Error(`${where}: a text block needs a "text" string.`);
      }
      return withTextBlockContent(
        { id: newId(), type: "text" },
        markupToContent(block.text),
      );
    }

    case "spelling": {
      const raw = Array.isArray(block.words) ? block.words : [];
      const words = raw
        .filter((w) => typeof w === "string" && w.trim())
        .map((text) => ({ id: newId(), text: text.trim() }));
      if (words.length === 0) {
        throw new Error(
          `${where}: a spelling block needs a non-empty "words" array of strings.`,
        );
      }
      return { id: newId(), type: "spelling", words };
    }

    case "question":
      return buildQuestionBlock(block, where);

    case "image":
      return buildImageBlock(block, where);

    case "vakt":
      return buildVaktBlock(block, where);

    default:
      throw new Error(
        `${where}: unknown block type "${block.type}". Use one of: text, spelling, question, image, vakt.`,
      );
  }
}

// A VAKT block — a regulation activity, never a question. Input is deliberately
// simpler than the stored shape: the text is the activity alone (the "VAKT:"
// label is added by whatever renders it, so writing one here would double it up)
// and links are `{ url, label? }` objects that get ids here.
function buildVaktBlock(block, where) {
  // Strip the label BEFORE deciding whether there is an activity here, or a
  // block whose whole text is "VAKT:" passes the check and then normalises away
  // to nothing — an empty red card in the finished lesson.
  const text = (typeof block.text === "string" ? block.text : "")
    .trim()
    .replace(/^VAKT\s*:\s*/i, "")
    .trim();

  const rawLinks = Array.isArray(block.links) ? block.links : [];
  const links = rawLinks.map((link, i) => {
    const url = typeof link?.url === "string" ? link.url.trim() : "";
    // The same rule the editor and the renderers apply (core/vakt.js), rather
    // than a stricter http-only one: mailto is a legitimate destination for a
    // VAKT link, and a tool that refused one would contradict both the schema
    // and every other path a VAKT block can be written through.
    if (!isSafeLink(url)) {
      throw new Error(
        `${where}: VAKT link ${i + 1} needs a "url" that is an http://, https:// or mailto: address.`,
      );
    }
    return {
      id: newId(),
      label: typeof link.label === "string" ? link.label.trim() : "",
      url,
    };
  });

  // The activity is what a VAKT block IS: an instruction to whoever is running
  // the lesson. Links and images are optional extras that go with it, so
  // neither can stand in for it — a picture alone doesn't say what to do.
  if (!text) {
    throw new Error(
      `${where}: a VAKT block needs a non-empty "text" activity — the thing to do, e.g. ` +
        `"Bob likes to do jumping jacks. Let's do 3 of those." ("links" and "image" are optional extras.)`,
    );
  }

  const out = { id: newId(), type: "vakt", text, links };

  // The picture, in exactly an image block's shape and produced the same way —
  // by add_image, never by hand. Its framing comes through too: a VAKT picture
  // takes the same "size" and "align" an image block does, only defaulting
  // smaller when neither is given (see core/vakt.js).
  if (block.image) {
    const image = buildImageBlock(block, where);
    out.image = image.image;
    if (image.width != null) out.width = image.width;
    if (image.height != null) out.height = image.height;
    if (image.caption != null) out.caption = image.caption;
    if (image.align != null) out.align = image.align;
    if (image.size != null) out.size = image.size;
  }

  return out;
}

function buildQuestionBlock(block, where) {
  const { questionType, prompt } = block;
  if (!QUESTION_TYPES.includes(questionType)) {
    throw new Error(
      `${where}: question block needs "questionType" of ${QUESTION_TYPES.join(", ")}.`,
    );
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new Error(`${where}: question block needs a non-empty "prompt".`);
  }
  const base = { id: newId(), type: "question", questionType, prompt };

  switch (questionType) {
    case "number": {
      // Stored as a string (the editor's number field), but accept a number too.
      if (block.answer == null || block.answer === "") {
        throw new Error(`${where}: a number question needs an "answer".`);
      }
      const rawSteps = Array.isArray(block.steps) ? block.steps : [];
      const steps = rawSteps
        .filter((t) => typeof t === "string" && t.trim())
        .map((text) => ({ id: newId(), text: text.trim() }));
      return { ...base, answer: String(block.answer), steps };
    }

    case "single":
      if (typeof block.answer !== "string" || !block.answer.trim()) {
        throw new Error(
          `${where}: a single-answer question needs an "answer" string.`,
        );
      }
      return { ...base, answer: block.answer };

    // The two semi-open types store the same thing and mean different things by
    // it — an exhaustive accepted set for `multiple`, a set of suggestions for
    // `multiple_open` — which is decided in core's lessonChecks, not here. The block
    // shape is identical.
    case "multiple":
    case "multiple_open": {
      const raw = Array.isArray(block.answers) ? block.answers : [];
      const answers = raw
        .filter((t) => typeof t === "string" && t.trim())
        .map((text) => ({ id: newId(), text: text.trim() }));
      if (answers.length === 0) {
        throw new Error(
          `${where}: a ${questionType} question needs a non-empty "answers" array of strings.`,
        );
      }
      return { ...base, answers };
    }

    // All free written responses: the speller answers on their own paper, so
    // none of them stores an answer.
    case "paraphrase":
    case "open":
    case "wyr":
      return { ...base };

    case "background":
      if (typeof block.answer !== "string" || !block.answer.trim()) {
        throw new Error(
          `${where}: a background question needs an "answer" string.`,
        );
      }
      return {
        ...base,
        background:
          typeof block.background === "string" ? block.background : "",
        answer: block.answer,
      };

    default:
      return base;
  }
}

// An image block references its bytes by content hash. The bytes are uploaded
// out of band by the add_image tool (which talks to Wikimedia Commons + R2), so
// here we only validate and normalise the resulting ref — the model never
// hand-writes one. Existing image blocks (from get_lesson) round-trip through
// this unchanged.
function buildImageBlock(block, where) {
  const ref = block.image;
  if (
    !ref ||
    typeof ref !== "object" ||
    typeof ref.hash !== "string" ||
    !ref.hash
  ) {
    throw new Error(
      `${where}: image blocks must carry an { image: { hash, mime, ext } } reference. ` +
        "Don't write these by hand — use the search_images and add_image tools, which download the image and upload its bytes.",
    );
  }
  const mime =
    typeof ref.mime === "string" && ref.mime ? ref.mime : "image/jpeg";
  const out = {
    id: newId(),
    type: "image",
    image: {
      hash: ref.hash,
      mime,
      ext: typeof ref.ext === "string" && ref.ext ? ref.ext : extFromMime(mime),
    },
  };
  if (Number.isFinite(block.width)) out.width = block.width;
  if (Number.isFinite(block.height)) out.height = block.height;
  if (typeof block.caption === "string") out.caption = block.caption;
  if (IMAGE_ALIGNS.includes(block.align)) out.align = block.align;
  if (typeof block.size === "string" && block.size) out.size = block.size;
  return out;
}

/**
 * The lesson's sources, from input: `{ id, title?, author?, publisher?, year?,
 * url? }` each. The id is the assistant's own short key ("smith2020"), which
 * its footnotes cite as ^[@smith2020].
 *
 * `existing` is the lesson's stored list, when there is one. A source passed
 * back exactly as stored is kept as it is, unchecked: the web editor lets a
 * person save a source half filled in (an empty row, a link with no scheme),
 * and an assistant handing back the list it read must not be refused over rows
 * it never touched. A new or changed source gets every check.
 * @param {unknown} input
 * @param {{ existing?: unknown }} [options]
 * @returns {object[]}
 */
export function buildSources(input, { existing } = {}) {
  if (input == null) return [];
  if (!Array.isArray(input)) {
    throw new Error(
      '"sources" must be an array of { id, title, author, publisher, year, url }.',
    );
  }
  const stored = new Map(
    (Array.isArray(existing) ? existing : [])
      .filter((s) => s && typeof s === "object" && isSourceId(s.id))
      .map((s) => [s.id, s]),
  );
  const seen = new Set();
  return input.map((raw, i) => {
    const where = `Source ${i + 1}`;
    if (!raw || typeof raw !== "object") {
      throw new Error(`${where} must be an object.`);
    }
    if (!isSourceId(raw.id)) {
      throw new Error(
        `${where} needs an "id" of letters, digits, "-" or "_" (e.g. "smith2020"). Footnotes cite it as ^[@id].`,
      );
    }
    if (seen.has(raw.id))
      throw new Error(`${where}: the id "${raw.id}" is used twice.`);
    seen.add(raw.id);
    const before = stored.get(raw.id);
    if (before && sameSource(raw, before)) return before;
    const url = typeof raw.url === "string" ? raw.url.trim() : "";
    if (url && !isSafeLink(url)) {
      throw new Error(
        `${where}: "url" must be an http:// or https:// address.`,
      );
    }
    const source = normalizeSource(raw);
    if (!sourceHasContent(source)) {
      throw new Error(
        `${where} needs at least a "title", an "author" or a "url".`,
      );
    }
    for (const field of Object.keys(raw)) {
      if (field !== "id" && !SOURCE_FIELDS.includes(field)) {
        throw new Error(
          `${where}: unknown field "${field}". A source has ${["id", ...SOURCE_FIELDS].join(", ")}.`,
        );
      }
    }
    return source;
  });
}

// Whether an input source says exactly what a stored one does.
function sameSource(raw, stored) {
  const field = (source, key) =>
    typeof source[key] === "string" ? source[key].trim() : "";
  return (
    Object.keys(raw).every(
      (key) => key === "id" || SOURCE_FIELDS.includes(key),
    ) && SOURCE_FIELDS.every((key) => field(raw, key) === field(stored, key))
  );
}

/**
 * A stored lesson as the tools present it to an assistant: the same document,
 * with every text block as markup in `text` rather than as a stored `content`
 * tree. Plain blocks come out escaped (a literal asterisk as \*), so any of
 * them can be passed back to replace_block or update_lesson unchanged.
 * @param {any} doc
 */
export function presentDoc(doc) {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.sections))
    return doc;
  return {
    ...doc,
    sections: doc.sections.map((section) => ({
      ...section,
      blocks: (Array.isArray(section?.blocks) ? section.blocks : []).map(
        (block) =>
          block?.type === "text"
            ? { id: block.id, type: "text", text: textBlockMarkup(block) }
            : block,
      ),
    })),
  };
}

/**
 * Build a full canonical doc from lesson input.
 *
 * `existingSources` is the stored list of the lesson being replaced. With it,
 * leaving `sources` out keeps that list exactly as it is, and sources passed
 * back unchanged are accepted as stored (see buildSources).
 * @param {{ title?: string, sources?: any[], sections: Array<{ name?: string, blocks?: any[] }> }} input
 * @param {{ existingSources?: any[] }} [options]
 * @returns {{ title: string, sources?: any[], sections: any[] }}
 */
export function buildDoc(input, { existingSources } = {}) {
  if (!input || typeof input !== "object") {
    throw new Error("Lesson must be an object with a title and sections.");
  }
  const sections = Array.isArray(input.sections) ? input.sections : [];
  if (sections.length === 0) {
    throw new Error("A lesson needs at least one section.");
  }

  const title = (input.title || "Untitled Lesson").toString();

  const builtSections = sections.map((section, i) => {
    if (!section || typeof section !== "object") {
      throw new Error(
        `Section ${i + 1} must be an object with a name and blocks.`,
      );
    }
    const blocks = Array.isArray(section.blocks) ? section.blocks : [];
    const builtBlocks = blocks.map((block, j) =>
      buildBlock(block, `Section ${i + 1}, block ${j + 1}`),
    );
    return {
      id: newId(),
      name: (section.name || `Section ${i + 1}`).toString(),
      blocks: builtBlocks,
    };
  });

  const sources =
    input.sources === undefined && Array.isArray(existingSources)
      ? existingSources
      : buildSources(input.sources, { existing: existingSources });
  return {
    title,
    ...(sources.length ? { sources } : {}),
    sections: builtSections,
  };
}

// The on-disk lesson-file format produced by create_lesson_file (here) and by
// the web editor's "Export JSON". The web app's "Import JSON" button reads it
// back. Keep this format marker and shape in sync with apps/web/src/lib/
// jsonImport.js and jsonExport.js so a file from either side imports cleanly.
export const LESSON_FILE_FORMAT = "spelling-creator-lesson";
export const LESSON_FILE_VERSION = 1;

/**
 * Wrap a built doc in the importable lesson-file envelope.
 * @param {{ title: string, sections: any[] }} doc
 */
export function buildLessonFile(doc) {
  return {
    format: LESSON_FILE_FORMAT,
    version: LESSON_FILE_VERSION,
    doc,
  };
}

// Checking a built doc against the authoring standard lives in
// @spelling-creator/core/lessonChecks (reached through validate.js).
// buildDoc's job is only to reject input it cannot turn into a valid document at
// all (a text block with no text, an unknown block type), which it does by
// throwing. Everything that is well-formed but off-standard is decided there, so
// that a single pass covers create, update and patch alike.
