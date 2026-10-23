// Shared definitions for the question types. Imported by the editor
// (SectionCard / ContentBlock) and the exporters so colours, labels, and the
// default block shape stay in sync everywhere.
//
// The keys follow the Open Spelling Lesson Format's types, under the names
// this app has always stored: single is OSLF's known, background its prior
// knowledge, number its math, multiple and multiple_open its semi-open (with
// an exhaustive and a suggested key), tight_open, broad_open, paraphrase and
// wyr themselves. `open` is the type lessons were saved with before tight and
// broad opens were told apart; it stays readable (see `legacy` below).
//
// `tag` is the short mark printed in front of every prompt (K, PK, M, ...),
// the Open Spelling Lesson Format's default tags. Colour alone can't carry a
// question's type: printers run dry, photocopies are grey, and some readers
// can't tell the colours apart. The tag is the second marking the format asks
// every renderer for, and the legend explains it.
//
// `label` is the name the format and the lessons use. The labels the app
// shipped with before it followed the format (Single answer, Number answer,
// Multiple answers, Background knowledge) live on as `styleAliases`: a Word
// style is matched by NAME, and the name carries the label (questionStyleName),
// so every document exported under the old labels needs its old style name
// mapped too or it imports as plain text.

import { ownValue } from "./guards.ts";
import { inlineTextPlain } from "./inlineText.ts";
import type {
  QuestionBlock,
  QuestionType,
  StepItem,
  TextItem,
} from "./types.ts";

export interface QuestionTypeMeta {
  key: QuestionType;
  label: string;
  short: string;
  tag: string;
  description: string;
  color: string;
  /** The labels the type shipped with before it took the format's name. */
  styleAliases?: string[];
  italic?: boolean;
  legacy?: boolean;
  /** A shorter name for the printed footer legend than `label`. */
  legend?: string;
}

/**
 * A question block as the readers here take it: possibly mid-edit, or not yet
 * through the importer, so every field may be missing.
 */
export interface QuestionFields {
  questionType?: string;
  prompt?: unknown;
  threeBoard?: unknown;
  besides?: unknown;
  answer?: unknown;
  answers?: ReadonlyArray<{ text?: string }>;
}

export const QUESTION_TYPES: {
  readonly [K in QuestionType]: QuestionTypeMeta & { key: K };
} = {
  number: {
    key: "number",
    label: "Math",
    short: "Math",
    tag: "M",
    description: "The answer is a number",
    color: "#7048e8", // purple
    styleAliases: ["Number answer"],
  },
  single: {
    key: "single",
    label: "Known",
    short: "Known",
    tag: "K",
    description: "One answer, stated in the passage",
    color: "#2f9e44", // green
    styleAliases: ["Single answer"],
  },
  multiple: {
    key: "multiple",
    label: "Semi-open",
    short: "Semi-open",
    tag: "SO",
    description: "Several accepted answers, usually a list in the passage",
    styleAliases: ["Multiple answers"],
    // Amber. Deliberately yellower than the burnt orange this used to be
    // (#e8590c), which sat too close to `paraphrase`'s brown to tell apart in a
    // printed lesson where the colour is the only thing marking the type.
    color: "#d68f00",
  },
  multiple_open: {
    key: "multiple_open",
    label: "Suggested answers",
    short: "Suggested",
    // The same tag as `multiple`: on paper the two are one semi-open family,
    // and the italic below is what marks this one's key as advisory.
    tag: "SO",
    description: "Answers bounded by the topic; the key only suggests",
    // The same amber as `multiple`, because these two are one pedagogical
    // family: the semi-open questions, which this app's default treats as a
    // spectrum from tight (a finite answer set the passage states) to less
    // tight (bounded by the topic, but open to improvisation), all formatted in
    // the one colour. The family is the app's own default, not a rule from any
    // one method; see the Open Spelling Lesson Format's open question on it.
    color: "#d68f00",
    // Which leaves nothing to tell them apart where the colour is the only
    // marking — the printed lesson and its footer legend. So the loose end is
    // set in italic there. It is not decoration: it is the only thing telling
    // whoever is scoring that this question's answer key is a SUGGESTION and a
    // speller who wrote something else may still be right. The remaining hues
    // are all spoken for (see the note above — the orange next door to amber is
    // brown's), so the second mark had to be something other than a colour.
    italic: true,
  },
  paraphrase: {
    key: "paraphrase",
    label: "Paraphrase",
    short: "Paraphrase",
    tag: "P",
    description: "Restate the passage in their own words",
    color: "#a0522d", // brown
  },
  tight_open: {
    key: "tight_open",
    label: "Tight open",
    short: "Tight open",
    tag: "TO",
    description: "A quick one-word answer from the speller's own world",
    color: "#e64980", // pink
  },
  broad_open: {
    key: "broad_open",
    label: "Broad open",
    short: "Broad open",
    tag: "BO",
    description: "Their own reasoning, opinion or imagination",
    // The same pink as `tight_open`: on paper the two open kinds are told
    // apart by their tag and by what they ask, not by colour.
    color: "#e64980",
  },
  open: {
    key: "open",
    label: "Open ended",
    short: "Open",
    tag: "O",
    description: "Saved before tight and broad opens were separate",
    color: "#e64980", // pink
    // Lessons stored before the split carry this type, and the app never
    // rewrites a stored block on load (that would show up as an edit in
    // version history and broadcast to a live session; see imageCredit.ts). So
    // it stays a type every reader understands, printed and checked as the
    // kind its wording suggests (resolveOpenType), but the menus no longer
    // offer it: a new question is tight or broad.
    legacy: true,
  },
  wyr: {
    key: "wyr",
    label: "Would you rather",
    short: "W.Y.R.",
    tag: "WYR",
    // What the printed footer legend calls it. The legend otherwise prints the
    // label, but "WOULD YOU RATHER" would crowd an eight-entry footer line, and
    // the lessons this type comes from abbreviate it there too.
    legend: "W.Y.R.",
    description: "Choose between options; no right answer",
    // Grape: a red-violet, sitting between `number`'s blue-violet and `open`'s
    // pink but readable against both. Teal was the obvious free hue, but the
    // spelling block already prints teal (see spelling.ts). If the colour is
    // ever in doubt on paper, the prompt itself disambiguates: every question
    // of this type starts "Would you rather".
    color: "#9c36b5",
  },
  background: {
    key: "background",
    label: "Prior knowledge",
    short: "Prior",
    tag: "PK",
    description: "Needs knowledge the passage doesn't give",
    color: "#1c7ed6", // blue
    styleAliases: ["Background knowledge"],
  },
};

export const QUESTION_TYPE_LIST: QuestionTypeMeta[] =
  Object.values(QUESTION_TYPES);

/** The types a menu offers for a new question: every type but the legacy one. */
export const QUESTION_TYPE_MENU = QUESTION_TYPE_LIST.filter((q) => !q.legacy);

// The open types: the two kinds a new question can be, and the one older
// lessons were saved with. All print pink, carry no answer key (a tight open
// may carry examples), and are the questions a speller answers from their own
// world rather than from the passage.
export const OPEN_TYPE_KEYS = [
  "tight_open",
  "broad_open",
  "open",
] as const satisfies readonly QuestionType[];

/** Is this one of the open (pink) types, the legacy one included? */
export function isOpenType(
  questionType: unknown,
): questionType is (typeof OPEN_TYPE_KEYS)[number] {
  return OPEN_TYPE_KEYS.some((key) => key === questionType);
}

// Sorting a legacy `open` question, which never said what kind it was, by its
// wording. Lessons written before the split asked all seven pink questions as
// `open`, the retelling among them, so the wording can name any of three
// types: a tight open, the paraphrase or a broad open. Word count alone
// misclassifies short broad opens ("Explain why you think so."), so the stems
// get the first say, in this order:
//
//   1. A prompt that opens "Name a..." or "Give one..." is a tight open
//      whatever follows ("Name something you should bring camping", "Give one
//      word to summarize the passage" both want one word). The tight stem is
//      anchored at the start; the others match anywhere, so it goes first.
//   2. A retelling of the passage ("In your own words, explain...",
//      "Summarize...") is the paraphrase, unless it asks for the speller's
//      own view: "In your own words, explain why you prefer rivers" wants an
//      opinion, not the passage back, so it is a broad open.
//   3. A prompt asking for the speller's own thinking is a broad open.
//
// Only ever a guess, which is why a stored question's own type always wins
// and why the menus ask the author to choose. The checks, the OSLF export and
// document import all read an old question through resolveOpenType, so they
// agree on what it is.
const TIGHT_STEM =
  /^\s*(name|give)\s+(a|an|one|some|something|someone|a kind|a type|a place|a way|a synonym|a word)\b/i;
const PARAPHRASE_STEM = /in your own words|summari[sz]e\b|retell\b/i;
const OPINION_CUE =
  /\byou (prefer|think|feel|believe|like|love|want|would|wish|enjoy|choose|pick)\b|\byour (opinion|favorite|view|choice)\b/i;
const BROAD_STEM =
  /defend your (answer|thinking|choice)|explain your (thinking|answer|reasoning|choice)|explain why|explain how|why do you think|how do you think|what do you think|do you think|describe (how|why|what)|if you (could|were)|what (would|could|might|does it take)|would you (want|have|volunteer)|should\b/i;
const TIGHT_OPEN_MAX_WORDS = 12;

/**
 * The type a question reads as: its own type for anything but a legacy
 * `open` block, and for one of those the type its wording reads as (a tight
 * open, the paraphrase or a broad open).
 */
export function resolveOpenType(
  block: Pick<QuestionFields, "questionType" | "prompt"> | null | undefined,
): string | undefined {
  if (block?.questionType !== "open") return block?.questionType;
  const prompt = inlineTextPlain(block.prompt);
  if (TIGHT_STEM.test(prompt)) return "tight_open";
  if (PARAPHRASE_STEM.test(prompt)) {
    return OPINION_CUE.test(prompt) ? "broad_open" : "paraphrase";
  }
  if (BROAD_STEM.test(prompt)) return "broad_open";
  const words = prompt.trim().split(/\s+/).filter(Boolean).length;
  return words > TIGHT_OPEN_MAX_WORDS ? "broad_open" : "tight_open";
}

// ---------------------------------------------------------------------------
// Three-board semi-opens.
//
// A `multiple` question can be marked for the three boards (the lesson prints
// "(3B)" in front of it), and can carry a "Besides" line: a follow-up printed
// under the question that names one of its answers and asks for another
// ('Besides "rocks"' leaves REEFS and SANDBARS). Both are the Open Spelling
// Lesson Format's `threeBoard` and `besides`, stored under the same names.
// What the three-board mark asks of the speller is the format's own open
// question; this app records it and prints it, and defines nothing more.
// ---------------------------------------------------------------------------

/** What a printed lesson writes in front of a three-board question. */
export const THREE_BOARD_MARK = "(3B)";

/** The word a Besides line opens with, in print. */
export const BESIDES_LABEL = "Besides";

/** Whether a block carries the three-board mark. Only a `multiple` can. */
export function isThreeBoard(
  block: Pick<QuestionFields, "questionType" | "threeBoard"> | null | undefined,
): boolean {
  return block?.questionType === "multiple" && block.threeBoard === true;
}

/**
 * The answer a block's Besides line names, as the answer list spells it, or
 * null when the block has no Besides line or names an answer that is no
 * longer in the list (an answer edited or removed after the line was set).
 * Matched without regard to case, as the format compares answers.
 */
export function questionBesides(
  block: QuestionFields | null | undefined,
): string | null {
  if (block?.questionType !== "multiple") return null;
  const wanted = String(block.besides ?? "")
    .trim()
    .toLowerCase();
  if (!wanted) return null;
  const match = (block.answers || [])
    .map((a) => (typeof a === "string" ? a : a?.text) || "")
    .map((text) => text.trim())
    .find((text) => text && text.toLowerCase() === wanted);
  return match ?? null;
}

/**
 * What a Besides line asks for: every accepted answer but the one it names.
 * Empty when the block has no usable Besides line.
 */
export function besidesAnswers(
  block: QuestionFields | null | undefined,
): string[] {
  const named = questionBesides(block);
  if (named == null) return [];
  return questionAnswerItems(block).filter(
    (text) => text.toLowerCase() !== named.toLowerCase(),
  );
}

// The Besides line gets a Word paragraph style of its own, so the DOCX
// importer can attach it to the question above it rather than read it as a
// question in its own right, and so the PDF can indent it.
export const BESIDES_LINE_STYLE_ID = "s2cBesidesLine";
export const BESIDES_LINE_STYLE_NAME = "S2C Besides Line";
export const BESIDES_LINE_CLASS = "s2c-besides-line";

/** The mammoth style-map entry turning the Besides style back into a class. */
export function besidesStyleMap(): string[] {
  return [
    `p[style-name='${BESIDES_LINE_STYLE_NAME}'] => p.${BESIDES_LINE_CLASS}:fresh`,
  ];
}

// The two semi-open types, in the order a section asks them (tight first). They
// share a colour and an `answers` list, and differ in what that list means: for
// `multiple` it is the complete set of accepted answers, drawn from a list the
// passage states; for `multiple_open` it is a set of suggestions, and an answer
// that isn't among them can still be right. Consumers that care about the shape
// of the block (the editor's answer rows, the exporters) treat them alike;
// consumers that care about the contract (validation, the answer reveal) don't.
export const ORANGE_TYPE_KEYS = [
  "multiple",
  "multiple_open",
] as const satisfies readonly QuestionType[];

/** Is this one of the two semi-open (orange) types? */
export function isOrangeType(
  questionType: unknown,
): questionType is (typeof ORANGE_TYPE_KEYS)[number] {
  return ORANGE_TYPE_KEYS.some((key) => key === questionType);
}

// The order the printed footer legend lists the types in: the order a section
// asks them, each asking a little more of the speller than the one before,
// which is the order the Open Spelling Lesson Format lists its types in and
// asks a legend to keep. This is a reading order for the legend only; the editor's type
// picker keeps QUESTION_TYPES' own order. The legacy open type comes last,
// since it only appears under lessons saved before the split.
export const QUESTION_LEGEND: QuestionTypeMeta[] = [
  QUESTION_TYPES.single,
  QUESTION_TYPES.background,
  QUESTION_TYPES.number,
  QUESTION_TYPES.multiple,
  QUESTION_TYPES.multiple_open,
  QUESTION_TYPES.tight_open,
  QUESTION_TYPES.wyr,
  QUESTION_TYPES.paraphrase,
  QUESTION_TYPES.broad_open,
  QUESTION_TYPES.open,
];

/** What the printed footer legend calls a type: its tag, then the label,
 * unless the type carries a shorter legend name of its own (only `wyr` does
 * today). The tag comes first because the legend is where a reader looks up
 * the mark in front of a prompt. */
export function questionLegendText(
  type: Pick<QuestionTypeMeta, "tag" | "label" | "legend">,
): string {
  return `${type.tag} ${(type.legend || type.label).toUpperCase()}`;
}

// The tag in front of a prompt, as the renderers print it: the tag and a gap,
// so "K Alexandria's lighthouse stood on...". Shared so the text importer can
// strip exactly what the exporters wrote.
export const QUESTION_TAG_GAP = "  ";

/**
 * A question tag at the start of a line, as a printed lesson writes it, with
 * the three-board mark when the tag carries one ("SO (3B)") and the
 * whitespace after it. For readers taking a lesson back in from text.
 * Case-sensitive on purpose: "So the..." opens a sentence, "SO " marks a
 * question.
 */
export const QUESTION_TAG_PREFIX = new RegExp(
  `^(?:${[...new Set(QUESTION_TYPE_LIST.map((q) => q.tag))].join("|")})` +
    `(?:\\s+${THREE_BOARD_MARK.replace(/[()]/g, "\\$&")})?\\s+(?=\\S)`,
);

/**
 * A line of text with its printed tag taken off, and whether that tag carried
 * the three-board mark. The mark is part of the marking, not the wording, so
 * a reader taking a printed lesson back in puts it on the block rather than
 * leaving "(3B)" at the front of the prompt.
 */
export function readQuestionTag(line: string): {
  text: string;
  threeBoard: boolean;
} {
  const match = QUESTION_TAG_PREFIX.exec(line);
  if (!match) return { text: line, threeBoard: false };
  return {
    text: line.slice(match[0].length),
    threeBoard: match[0].includes(THREE_BOARD_MARK),
  };
}

/**
 * The legend entries a printed lesson needs: QUESTION_LEGEND's order, cut down
 * to the types the lesson actually asks. A legend naming eight types under a
 * lesson that uses five explains three colours the reader will never see, and
 * crowds the one footer line the eight only just fit on.
 *
 * Unknown types count as `open`, the same fallback questionMeta applies when
 * colouring the prompt, so the legend always names the colour that was printed.
 */
export function questionLegendFor(
  doc:
    | {
        sections?: ReadonlyArray<{
          blocks?: ReadonlyArray<{
            type?: string;
            questionType?: string;
          } | null> | null;
        } | null>;
      }
    | null
    | undefined,
): QuestionTypeMeta[] {
  const used = new Set<QuestionType>();
  for (const section of doc?.sections || []) {
    for (const block of section?.blocks || []) {
      if (block?.type === "question")
        used.add(questionMeta(block.questionType).key);
    }
  }
  return QUESTION_LEGEND.filter((type) => used.has(type.key));
}

// ---------------------------------------------------------------------------
// Word character styles, one per question type.
//
// The printed lesson has no "[Math]" label in front of a prompt, only
// the short tag and the prompt's own colour. The tag is shared by two types
// (SO), so it can't carry the type back through the DOCX importer on its own,
// and mammoth drops run colours, so the PDF path would lose the colour coding.
//
// A named character style fixes both: Word carries the colour, mammoth can be
// told to map the style onto a `<span class>` (see docxImport / pdfExport), and
// the class names below are the contract the three sides share.
// ---------------------------------------------------------------------------

/** The Word style id for a question type's prompt run. */
export function questionStyleId(key: string): string {
  return `s2cQuestion${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

/** The Word style *name* — what mammoth matches on in a style map. */
export function questionStyleName(key: string): string {
  return `S2C Question ${questionMeta(key).label}`;
}

/** The HTML class mammoth is told to emit for that style. */
export function questionStyleClass(key: string): string {
  return `s2c-q-${key}`;
}

/**
 * The mammoth style map that turns each question style back into a tagged span.
 * Shared by the PDF exporter (which colours the spans) and the DOCX importer
 * (which reads the type off them).
 */
export function questionStyleMap(): string[] {
  return QUESTION_TYPE_LIST.flatMap((q) =>
    [questionStyleName(q.key), ...questionStyleAliases(q.key)].map(
      (name) => `r[style-name='${name}'] => span.${questionStyleClass(q.key)}`,
    ),
  );
}

/**
 * The style names a type's prompt run carried in documents exported before
 * its label changed, so those documents still import with their types.
 */
export function questionStyleAliases(key: string): string[] {
  return (questionMeta(key).styleAliases || []).map(
    (label) => `S2C Question ${label}`,
  );
}

// The type tag printed in front of a prompt gets a character style of its own,
// for the same reason the prompt has one: mammoth keeps the style, so the PDF
// can set the tag apart and the importer can tell it from the prompt. One
// style for every type, since the tag's text already says which type it is.
export const QUESTION_TAG_STYLE_ID = "s2cQuestionTag";
export const QUESTION_TAG_STYLE_NAME = "S2C Question Tag";
export const QUESTION_TAG_STYLE_CLASS = "s2c-q-tag";

/** The mammoth style-map entry turning the tag style back into a tagged span. */
export function questionTagStyleMap(): string[] {
  return [
    `r[style-name='${QUESTION_TAG_STYLE_NAME}'] => span.${QUESTION_TAG_STYLE_CLASS}`,
  ];
}

// Types whose answer is a single value held on `block.answer`.
const SINGLE_ANSWER_TYPES: ReadonlySet<unknown> = new Set<QuestionType>([
  "number",
  "single",
  "background",
]);

/**
 * A single answer (`block.answer`) as plain words. An answer is a plain
 * string, and a number question's may have been stored as a number. But a
 * lesson can also arrive with an answer in the prompt's rich inline-text
 * shape (a one-paragraph document; see inlineText.ts), written by a client
 * that gave the answer field the same editor as the prompt. Read as a
 * string that would be "[object Object]", which the number field then tries
 * to parse. So every reader of a single answer, and the importer, takes the
 * words of whatever shape is there.
 */
export function questionAnswerPlain(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") return inlineTextPlain(value);
  return String(value);
}

// The gap between an answer and the next thing along. Built around a
// non-breaking space on purpose: the PDF path renders the docx as HTML, which
// collapses a run of ordinary spaces down to one, and the wide gap is what
// separates several accepted answers from each other. The plain spaces on either
// side still give the line somewhere to wrap.
export const ANSWER_GAP = " \u00A0 ";

// Types that hold a list of answers in `answers`: the two semi-open types, and
// a tight open, whose list (when it has one) is examples of what would count.
const LIST_ANSWER_TYPES: ReadonlySet<unknown> = new Set<QuestionType>([
  "multiple",
  "multiple_open",
  "tight_open",
]);

// What a printed lesson writes in front of a tight open's examples, so whoever
// is scoring reads them as examples rather than as the answer key. The DOCX
// importer strips exactly this.
export const EXAMPLE_ANSWER_PREFIX = "e.g. ";

/**
 * Whether a block's answers are examples rather than an answer key. True for
 * a tight open with examples; the suggested-answers type marks its key as
 * advisory with the italic on its prompt instead, and prints its list plain.
 */
export function questionAnswersAreExamples(
  block: Pick<QuestionFields, "questionType"> | null | undefined,
): boolean {
  return block?.questionType === "tight_open";
}

// The answer strings a printed lesson shows, one per accepted answer: at most
// one for the single-answer types, one per non-blank answer for the orange
// (multiple-answer) types and a tight open's examples, and none for an
// unanswered question or a `broad_open`/`paraphrase`/`wyr` one, which is
// answered on the speller's own paper and so prints as the prompt alone.
//
// Separate from questionAnswerText so each accepted answer stays its own
// string where that matters: lesson translation translates them one at a
// time, since a model fed the joined line would fold the non-breaking gaps
// between answers into ordinary spaces and blur the list into one phrase.
export function questionAnswerItems(
  block: QuestionFields | null | undefined,
): string[] {
  if (!block) return [];
  if (SINGLE_ANSWER_TYPES.has(block.questionType)) {
    const answer = questionAnswerPlain(block.answer).trim();
    return answer ? [answer] : [];
  }
  if (LIST_ANSWER_TYPES.has(block.questionType)) {
    return (block.answers || [])
      .map((a) => (a.text || "").trim())
      .filter(Boolean);
  }
  return [];
}

// The answer text a printed lesson shows inline, immediately after the prompt
// and in the body colour — the shape the exported lesson uses, where a question
// is one line of coloured prompt followed by its answer in black. A tight
// open's examples come after "e.g.".
//
// Returns "" when there is nothing to show (see questionAnswerItems).
export function questionAnswerText(
  block: QuestionFields | null | undefined,
): string {
  const items = questionAnswerItems(block);
  if (!items.length) return "";
  const prefix = questionAnswersAreExamples(block) ? EXAMPLE_ANSWER_PREFIX : "";
  return prefix + items.join(ANSWER_GAP);
}

export function questionMeta(
  questionType: string | null | undefined,
): QuestionTypeMeta {
  return ownValue(QUESTION_TYPES, questionType) ?? QUESTION_TYPES.open;
}

// Build a fresh question block of the given type. `newId` is injected so this
// stays decoupled from the id helper.
export function createQuestionBlock(
  newId: () => string,
  questionType: QuestionType,
): QuestionBlock {
  const base: QuestionBlock = {
    id: newId(),
    type: "question",
    questionType,
    prompt: "",
  };
  switch (questionType) {
    case "number":
      return { ...base, answer: "", steps: [] };
    case "single":
      return { ...base, answer: "" };
    case "multiple":
    case "multiple_open":
      return { ...base, answers: [{ id: newId(), text: "" }] };
    // A tight open may carry examples of what would count, but needn't, so it
    // starts with none rather than with an empty row asking to be filled.
    case "tight_open":
      return { ...base, answers: [] };
    // All free written responses with no stored answer.
    case "paraphrase":
    case "broad_open":
    case "open":
    case "wyr":
      return { ...base };
    case "background":
      return { ...base, answer: "" };
    default:
      return base;
  }
}

// Build a question block from an AI suggestion (see ./aiSuggest.ts). `data`
// is the JSON the Worker returns for the given type; this maps it onto the same
// block shape `createQuestionBlock` produces. Anything missing falls back to
// sensible blanks so the resulting block is always editable, even if the model
// returns a partial answer.
export function buildQuestionBlock(
  newId: () => string,
  questionType: QuestionType,
  data: {
    prompt?: unknown;
    answer?: unknown;
    answers?: unknown;
    steps?: unknown;
  } = {},
): QuestionBlock {
  const prompt = typeof data.prompt === "string" ? data.prompt : "";
  const base: QuestionBlock = {
    id: newId(),
    type: "question",
    questionType,
    prompt,
  };
  switch (questionType) {
    case "number":
      return {
        ...base,
        answer: data.answer != null ? String(data.answer) : "",
        steps: toSteps(newId, data.steps),
      };
    case "single":
      return {
        ...base,
        answer: typeof data.answer === "string" ? data.answer : "",
      };
    case "multiple":
    case "multiple_open":
      return { ...base, answers: toAnswers(newId, data.answers) };
    case "tight_open":
      return {
        ...base,
        answers: toAnswers(newId, data.answers, { pad: false }),
      };
    case "paraphrase":
    case "broad_open":
    case "open":
    case "wyr":
      return { ...base };
    case "background":
      return {
        ...base,
        answer: typeof data.answer === "string" ? data.answer : "",
      };
    default:
      return base;
  }
}

// Turn an array of answer strings into answer objects, guaranteeing at least
// one editable row so an AI-suggested block matches a hand-made one. A tight
// open's examples are optional, so it asks for no padding.
function toAnswers(
  newId: () => string,
  raw: unknown,
  { pad = true }: { pad?: boolean } = {},
): TextItem[] {
  const list = Array.isArray(raw) ? raw.filter(isString) : [];
  const answers = list.map((text) => ({ id: newId(), text }));
  if (pad && answers.length === 0) answers.push({ id: newId(), text: "" });
  return answers;
}

// Turn an array of step strings into step rows. Unlike answers, steps are
// optional working-out lines, so an empty list is left empty rather than
// padded with a blank row.
function toSteps(newId: () => string, raw: unknown): StepItem[] {
  const list = Array.isArray(raw) ? raw.filter(isString) : [];
  return list.map((text) => ({ id: newId(), text }));
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
