// Build the canonical editor document (`doc`) from the LLM-friendly lesson input
// the MCP server's tools accept. The Worker stores `doc` verbatim and the web
// editor renders it, so the shapes here must match the editor's exactly. They
// are kept in sync with:
//   • ./questions.ts  (question block shapes and types)
//   • ./spelling.ts   (spelling block shape)
//   • ./vakt.ts       (VAKT activity block shape)
//   • ./heading.ts    (heading block shape)
//
// The canonical doc is:
//   { title, sources?, sections: [ { id, name, blocks: [ Block, ... ] } ] }
//
// Text blocks are written in a small markup (see "Markup" in
// packages/core/src/lessonText.ts): **bold**, *italic*, <u>underline</u>, and
// footnotes as ^[a note] or ^[@sourceId, p. 12 | a note]. A block with none of
// that is stored as a plain `text` string, exactly as before; one with any of it
// is stored as a formatted `content` document. A question's prompt and a math
// question's steps take the same markup, less the footnotes, and are stored
// the way inlineText.ts says (a plain string, or a one-paragraph document).
// presentDoc turns stored blocks back into the same markup, so what get_lesson
// shows can be sent straight back.
// Blocks carry a stable `id`; we generate every id here so callers (and the AI
// assistant driving them) never have to. Input is intentionally simpler than the
// stored shape — e.g. spelling words are plain strings here, objects in the doc.

import { isObjectLike } from "./guards.ts";
import { IMAGE_ALIGNS, type ImageAlign, extFromMime } from "./image.ts";
import { withSeparateCredit } from "./imageCredit.ts";
import { inlineTextMarkup, markupToInlineText } from "./inlineText.ts";
import { isSafeLink } from "./richText.ts";
import {
  markupToContent,
  normalizeTextContent,
  textBlockMarkup,
  withTextBlockContent,
} from "./lessonText.ts";
import {
  SOURCE_FIELDS,
  type SourceField,
  isSourceId,
  normalizeSource,
  sourceHasContent,
} from "./sources.ts";
import { newId } from "./id.ts";
import type {
  Block,
  ImageBlock,
  LessonDoc,
  QuestionBlock,
  QuestionType,
  Section,
  Source,
  StepItem,
  VaktBlock,
} from "./types.ts";

export { newId };

// `open` is accepted for lessons written before tight and broad opens were
// told apart; a new question is one or the other (see questions.ts).
export const QUESTION_TYPES = [
  "number",
  "single",
  "multiple",
  "multiple_open",
  "paraphrase",
  "tight_open",
  "broad_open",
  "open",
  "wyr",
  "background",
] as const satisfies readonly QuestionType[];

function isQuestionType(value: unknown): value is QuestionType {
  return (QUESTION_TYPES as readonly unknown[]).includes(value);
}

function isImageAlign(value: unknown): value is ImageAlign {
  return (IMAGE_ALIGNS as readonly unknown[]).includes(value);
}

/**
 * One block as the MCP server's tools take it (blockSchema in
 * apps/mcp/src/tools.js). Every field but `type` is optional, and which ones a
 * block needs depends on its type: buildBlock checks that, and throws saying
 * what is missing.
 */
export interface BlockInput {
  type: string;
  /** Ignored: every built block gets a fresh id. */
  id?: string;
  /** Markup for a text block; the activity of a VAKT block; a heading's text. */
  text?: string;
  /** A text block's stored document, passed through when it comes back unchanged. */
  content?: unknown;
  links?: Array<{ url?: string; label?: string }>;
  words?: string[];
  questionType?: string;
  prompt?: string;
  answer?: string | number;
  answers?: string[];
  threeBoard?: boolean;
  besides?: string;
  steps?: string[];
  image?: { hash?: string; mime?: string; ext?: string };
  width?: number;
  height?: number;
  caption?: string;
  credit?: string;
  align?: string;
  size?: string;
}

/** A section as the tools take it. */
export interface SectionInput {
  name?: string;
  blocks?: BlockInput[];
}

/** A source as the tools take it. The id is the assistant's own short key. */
export interface SourceInput {
  id: string;
  title?: string;
  author?: string;
  publisher?: string;
  year?: string;
  url?: string;
}

/** A whole lesson as create_lesson and update_lesson take it. */
export interface LessonInput {
  title?: string;
  sources?: SourceInput[];
  sections: SectionInput[];
}

// Map one input block to its stored form. Throws a descriptive Error on bad
// input so the assistant gets actionable feedback it can correct. Exported so
// the patch logic (lessonPatch.ts) can build single blocks the same way.
export function buildBlock(block: BlockInput, where: string): Block {
  if (!block || typeof block !== "object") {
    throw new Error(`${where}: each block must be an object.`);
  }
  switch (block.type) {
    case "text": {
      // `content` is the stored form, passed through when a block read some
      // other way comes back unchanged; `text` is the markup an assistant writes.
      const stored = normalizeTextContent(block.content);
      if (stored && typeof block.text !== "string") {
        return withTextBlockContent(
          { id: newId(), type: "text" as const },
          stored,
        );
      }
      if (typeof block.text !== "string") {
        throw new Error(`${where}: a text block needs a "text" string.`);
      }
      return withTextBlockContent(
        { id: newId(), type: "text" as const },
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

    // A short heading inside the section, such as one over a run of W.Y.R.
    // questions. Its text is all it has.
    case "heading": {
      const text = typeof block.text === "string" ? block.text.trim() : "";
      if (!text) {
        throw new Error(`${where}: a heading block needs a non-empty "text".`);
      }
      return { id: newId(), type: "heading", text };
    }

    default:
      throw new Error(
        `${where}: unknown block type "${block.type}". Use one of: text, spelling, question, image, vakt, heading.`,
      );
  }
}

// A VAKT block — a regulation activity, never a question. Input is deliberately
// simpler than the stored shape: the text is the activity alone (the "VAKT:"
// label is added by whatever renders it, so writing one here would double it up)
// and links are `{ url, label? }` objects that get ids here.
function buildVaktBlock(block: BlockInput, where: string): VaktBlock {
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
    // The same rule the editor and the renderers apply (core/vakt.ts), rather
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

  const out: VaktBlock = { id: newId(), type: "vakt", text, links };

  // The picture, in exactly an image block's shape and produced the same way —
  // by add_image, never by hand. Its framing comes through too: a VAKT picture
  // takes the same "size" and "align" an image block does, only defaulting
  // smaller when neither is given (see core/vakt.ts).
  if (block.image) {
    const image = buildImageBlock(block, where);
    out.image = image.image;
    if (image.width != null) out.width = image.width;
    if (image.height != null) out.height = image.height;
    if (image.caption != null) out.caption = image.caption;
    if (image.credit != null) out.credit = image.credit;
    if (image.align != null) out.align = image.align;
    if (image.size != null) out.size = image.size;
  }

  return out;
}

function buildQuestionBlock(block: BlockInput, where: string): QuestionBlock {
  const { questionType, prompt } = block;
  if (!isQuestionType(questionType)) {
    throw new Error(
      `${where}: question block needs "questionType" of ${QUESTION_TYPES.join(", ")}.`,
    );
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new Error(`${where}: question block needs a non-empty "prompt".`);
  }
  // The prompt is markup, like a text block's words (a formula, a read-aloud
  // hint), stored in the smaller of inline text's two shapes.
  const base: QuestionBlock = {
    id: newId(),
    type: "question",
    questionType,
    prompt: markupToInlineText(prompt.trim()),
  };

  switch (questionType) {
    case "number": {
      // Stored as a string (the editor's number field), but accept a number too.
      if (block.answer == null || block.answer === "") {
        throw new Error(`${where}: a number question needs an "answer".`);
      }
      const rawSteps = Array.isArray(block.steps) ? block.steps : [];
      const steps = rawSteps
        .filter((t) => typeof t === "string" && t.trim())
        .map((text) => ({
          id: newId(),
          text: markupToInlineText(text.trim()),
        }));
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
    // it: an exhaustive accepted set for `multiple`, a set of suggestions for
    // `multiple_open`. The difference is decided in core's lessonChecks, not
    // here, and the block shape is identical.
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
      const out: QuestionBlock = { ...base, answers };
      if (questionType !== "multiple") return out;
      // The three-board mark and the Besides line belong to the tight type
      // alone: a Besides line names one accepted answer and asks for another,
      // which only means something when the list is the whole key.
      if (block.threeBoard === true) out.threeBoard = true;
      if (block.besides != null && block.besides !== "") {
        const besides = String(block.besides).trim();
        const named = answers.find(
          (a) => a.text.toLowerCase() === besides.toLowerCase(),
        );
        if (!named) {
          throw new Error(
            `${where}: "besides" must be one of the question's own answers ` +
              `(${answers.map((a) => a.text).join(", ")}), not "${besides}".`,
          );
        }
        out.besides = named.text;
      }
      return out;
    }

    // A tight open may carry a few examples of what would count. They are
    // optional, and they are examples, not a key: lessonChecks keeps them out
    // of every answer pool.
    case "tight_open": {
      const raw = Array.isArray(block.answers) ? block.answers : [];
      const answers = raw
        .filter((t) => typeof t === "string" && t.trim())
        .map((text) => ({ id: newId(), text: text.trim() }));
      return { ...base, answers };
    }

    // All free written responses: the speller answers on their own paper, so
    // none of them stores an answer.
    case "paraphrase":
    case "broad_open":
    case "open":
    case "wyr":
      return { ...base };

    case "background":
      if (typeof block.answer !== "string" || !block.answer.trim()) {
        throw new Error(
          `${where}: a background question needs an "answer" string.`,
        );
      }
      return { ...base, answer: block.answer };

    default:
      return base;
  }
}

// An image block references its bytes by content hash. The bytes are uploaded
// out of band by the MCP add_image tool (which talks to Wikimedia Commons + R2), so
// here we only validate and normalise the resulting ref — the model never
// hand-writes one. Existing image blocks (from get_lesson) round-trip through
// this unchanged.
function buildImageBlock(block: BlockInput, where: string): ImageBlock {
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
  const out: ImageBlock = {
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
  // The license credit, apart from the caption (see ./imageCredit.ts).
  if (typeof block.credit === "string") out.credit = block.credit;
  if (isImageAlign(block.align)) out.align = block.align;
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
 */
export function buildSources(
  input: unknown,
  { existing }: { existing?: readonly Source[] } = {},
): Source[] {
  if (input == null) return [];
  if (!Array.isArray(input)) {
    throw new Error(
      '"sources" must be an array of { id, title, author, publisher, year, url }.',
    );
  }
  const list: unknown[] = input;
  const stored = new Map(
    (Array.isArray(existing) ? existing : [])
      .filter((s) => s && typeof s === "object" && isSourceId(s.id))
      .map((s) => [s.id, s]),
  );
  const seen = new Set<string>();
  return list.map((raw, i) => {
    const where = `Source ${i + 1}`;
    if (!isObjectLike(raw)) {
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
    if (!source || !sourceHasContent(source)) {
      throw new Error(
        `${where} needs at least a "title", an "author" or a "url".`,
      );
    }
    for (const field of Object.keys(raw)) {
      if (
        field !== "id" &&
        !(SOURCE_FIELDS as readonly string[]).includes(field)
      ) {
        throw new Error(
          `${where}: unknown field "${field}". A source has ${["id", ...SOURCE_FIELDS].join(", ")}.`,
        );
      }
    }
    return source;
  });
}

// Whether an input source says exactly what a stored one does.
function sameSource(raw: Record<string, unknown>, stored: Source): boolean {
  const field = (
    source: { [K in SourceField]?: unknown },
    key: SourceField,
  ): string => {
    const value = source[key];
    return typeof value === "string" ? value.trim() : "";
  };
  return (
    Object.keys(raw).every(
      (key) =>
        key === "id" || (SOURCE_FIELDS as readonly string[]).includes(key),
    ) && SOURCE_FIELDS.every((key) => field(raw, key) === field(stored, key))
  );
}

// A question as presentDoc shows it: its prompt as markup, and its steps too
// once presentQuestion has rewritten them.
type PresentedQuestion = Omit<QuestionBlock, "prompt" | "steps"> & {
  prompt: string;
  steps?: StepItem[] | string[];
};

/**
 * A stored lesson as the tools present it to an assistant: the same document,
 * with every text block as markup in `text` rather than as a stored `content`
 * tree, and every question's prompt and steps as markup too. Plain blocks
 * come out escaped (a literal asterisk as \*), so any of them can be passed
 * back to replace_block or update_lesson unchanged.
 *
 * Every picture comes out with its caption and credit as separate fields, even
 * one stored from before credits had their own (see ./imageCredit.ts). The
 * tools tell the assistant to keep the attribution out of the caption and pass
 * `credit` through, which, shown the combined caption, it would do by dropping
 * the attribution for good.
 *
 * Anything that isn't a lesson comes back as it was.
 */
export function presentDoc(doc: unknown): unknown {
  if (!isObjectLike(doc) || !Array.isArray(doc.sections)) return doc;
  const sections: Array<Partial<Section> | null | undefined> = doc.sections;
  return {
    ...doc,
    sections: sections.map((section) => ({
      ...section,
      blocks: (Array.isArray(section?.blocks) ? section.blocks : []).map(
        (block) =>
          block?.type === "text"
            ? { id: block.id, type: "text", text: textBlockMarkup(block) }
            : block?.type === "question"
              ? presentQuestion(block)
              : withSeparateCredit(block),
      ),
    })),
  };
}

// A question with its prompt and steps as markup, the steps as the strings
// the input takes (buildQuestionBlock gives them ids again).
function presentQuestion(block: QuestionBlock): PresentedQuestion {
  const out: PresentedQuestion = {
    ...block,
    prompt: inlineTextMarkup(block.prompt),
  };
  if (Array.isArray(block.steps)) {
    out.steps = block.steps
      .map((step) => inlineTextMarkup(step?.text ?? step))
      .filter((text) => text.trim());
  }
  return out;
}

/**
 * Build a full canonical doc from lesson input.
 *
 * `existingSources` is the stored list of the lesson being replaced. With it,
 * leaving `sources` out keeps that list exactly as it is, and sources passed
 * back unchanged are accepted as stored (see buildSources).
 */
export function buildDoc(
  input: LessonInput,
  { existingSources }: { existingSources?: Source[] } = {},
): LessonDoc {
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

// Checking a built doc against the authoring standard lives in ./lessonChecks.ts.
// buildDoc's job is only to reject input it cannot turn into a valid document at
// all (a text block with no text, an unknown block type), which it does by
// throwing. Everything that is well-formed but off-standard is decided there, so
// that a single pass covers create, update and patch alike.
