// Shared definitions for the eight question types. Imported by the editor
// (SectionCard / ContentBlock) and the exporters so colours, labels, and the
// default block shape stay in sync everywhere.

export const QUESTION_TYPES = {
  number: {
    key: "number",
    label: "Number answer",
    short: "Number",
    description: "The answer is a number",
    color: "#7048e8", // purple
  },
  single: {
    key: "single",
    label: "Single answer",
    short: "Single",
    description: "One typed answer",
    color: "#2f9e44", // green
  },
  multiple: {
    key: "multiple",
    label: "Multiple answers",
    short: "Multiple",
    description: "Several accepted answers",
    // Amber. Deliberately yellower than the burnt orange this used to be
    // (#e8590c), which sat too close to `paraphrase`'s brown to tell apart in a
    // printed lesson where the colour is the only thing marking the type.
    color: "#d68f00",
  },
  multiple_open: {
    key: "multiple_open",
    label: "Suggested answers",
    short: "Suggested",
    description: "Answers bounded by the topic; the key only suggests",
    // The same amber as `multiple`, because these two are one pedagogical
    // family — the semi-open questions, which the S2C guidebook describes as a
    // spectrum from tight (a finite answer set the passage states) to less
    // tight (bounded by the topic, but open to improvisation), all formatted in
    // the one colour.
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
    description: "Restate the passage in their own words",
    color: "#a0522d", // brown
  },
  open: {
    key: "open",
    label: "Open ended",
    short: "Open",
    description: "Free written response",
    color: "#e64980", // pink
  },
  wyr: {
    key: "wyr",
    label: "Would you rather",
    short: "W.Y.R.",
    // What the printed footer legend calls it. The legend otherwise prints the
    // label, but "WOULD YOU RATHER" would crowd an eight-entry footer line, and
    // the lessons this type comes from abbreviate it there too.
    legend: "W.Y.R.",
    description: "Choose between options; no right answer",
    // Grape: a red-violet, sitting between `number`'s blue-violet and `open`'s
    // pink but readable against both. Teal was the obvious free hue, but the
    // spelling block already prints teal (see spelling.js). If the colour is
    // ever in doubt on paper, the prompt itself disambiguates: every question
    // of this type starts "Would you rather".
    color: "#9c36b5",
  },
  background: {
    key: "background",
    label: "Background knowledge",
    short: "Background",
    description: "Requires prior knowledge",
    color: "#1c7ed6", // blue
  },
};

export const QUESTION_TYPE_LIST = Object.values(QUESTION_TYPES);

// The two semi-open types, in the order a section asks them (tight first). They
// share a colour and an `answers` list, and differ in what that list means: for
// `multiple` it is the complete set of accepted answers, drawn from a list the
// passage states; for `multiple_open` it is a set of suggestions, and an answer
// that isn't among them can still be right. Consumers that care about the shape
// of the block (the editor's answer rows, the exporters) treat them alike;
// consumers that care about the contract (validation, the answer reveal) don't.
export const ORANGE_TYPE_KEYS = ["multiple", "multiple_open"];

/** Is this one of the two semi-open (orange) types? */
export function isOrangeType(questionType) {
  return ORANGE_TYPE_KEYS.includes(questionType);
}

// The order the printed footer legend lists the types in: recall first, opening
// out to free response last. This is a reading order for the legend only — the
// editor's type picker keeps QUESTION_TYPES' own order.
export const QUESTION_LEGEND = [
  QUESTION_TYPES.single,
  QUESTION_TYPES.background,
  QUESTION_TYPES.number,
  QUESTION_TYPES.multiple,
  QUESTION_TYPES.multiple_open,
  QUESTION_TYPES.wyr,
  QUESTION_TYPES.paraphrase,
  QUESTION_TYPES.open,
];

/** What the printed footer legend calls a type: the label, unless the type
 * carries a shorter legend name of its own (only `wyr` does today). */
export function questionLegendText(type) {
  return (type.legend || type.label).toUpperCase();
}

// ---------------------------------------------------------------------------
// Word character styles, one per question type.
//
// The printed lesson has no "[Number answer]" tag in front of a prompt any more
// — the prompt's own colour is what marks its type. That leaves nothing in the
// text for the DOCX importer to read the type back off, and mammoth drops run
// colours, so the PDF path loses the colour coding too.
//
// A named character style fixes both: Word carries the colour, mammoth can be
// told to map the style onto a `<span class>` (see docxImport / pdfExport), and
// the class names below are the contract the three sides share.
// ---------------------------------------------------------------------------

/** The Word style id for a question type's prompt run. */
export function questionStyleId(key) {
  return `s2cQuestion${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

/** The Word style *name* — what mammoth matches on in a style map. */
export function questionStyleName(key) {
  return `S2C Question ${questionMeta(key).label}`;
}

/** The HTML class mammoth is told to emit for that style. */
export function questionStyleClass(key) {
  return `s2c-q-${key}`;
}

/**
 * The mammoth style map that turns each question style back into a tagged span.
 * Shared by the PDF exporter (which colours the spans) and the DOCX importer
 * (which reads the type off them).
 * @returns {string[]}
 */
export function questionStyleMap() {
  return QUESTION_TYPE_LIST.map(
    (q) =>
      `r[style-name='${questionStyleName(q.key)}'] => span.${questionStyleClass(q.key)}`,
  );
}

// Types whose answer is a single value held on `block.answer`.
const SINGLE_ANSWER_TYPES = new Set(["number", "single", "background"]);

// The gap between an answer and the next thing along. Built around a
// non-breaking space on purpose: the PDF path renders the docx as HTML, which
// collapses a run of ordinary spaces down to one, and the wide gap is what
// separates several accepted answers from each other. The plain spaces on either
// side still give the line somewhere to wrap.
export const ANSWER_GAP = " \u00A0 ";

// The answer text a printed lesson shows inline, immediately after the prompt
// and in the body colour — the shape the exported lesson uses, where a question
// is one line of coloured prompt followed by its answer in black.
//
// Returns "" when there is nothing to show: an unanswered question, or an
// `open`/`paraphrase`/`wyr` one, which is answered on the speller's own paper
// and so prints as the prompt alone.
export function questionAnswerText(block) {
  if (!block) return "";
  if (SINGLE_ANSWER_TYPES.has(block.questionType)) {
    return block.answer == null ? "" : String(block.answer).trim();
  }
  if (isOrangeType(block.questionType)) {
    return (block.answers || [])
      .map((a) => (a.text || "").trim())
      .filter(Boolean)
      .join(ANSWER_GAP);
  }
  return "";
}

export function questionMeta(questionType) {
  return QUESTION_TYPES[questionType] || QUESTION_TYPES.open;
}

// Build a fresh question block of the given type. `newId` is injected so this
// stays decoupled from the id helper.
export function createQuestionBlock(newId, questionType) {
  const base = { id: newId(), type: "question", questionType, prompt: "" };
  switch (questionType) {
    case "number":
      return { ...base, answer: "", steps: [] };
    case "single":
      return { ...base, answer: "" };
    case "multiple":
    case "multiple_open":
      return { ...base, answers: [{ id: newId(), text: "" }] };
    // All free written responses with no stored answer.
    case "paraphrase":
    case "open":
    case "wyr":
      return { ...base };
    case "background":
      return { ...base, answer: "" };
    default:
      return base;
  }
}

// Build a question block from an AI suggestion (see lib/aiSuggest.js). `data`
// is the JSON the Worker returns for the given type; this maps it onto the same
// block shape `createQuestionBlock` produces. Anything missing falls back to
// sensible blanks so the resulting block is always editable, even if the model
// returns a partial answer.
export function buildQuestionBlock(newId, questionType, data = {}) {
  const prompt = typeof data.prompt === "string" ? data.prompt : "";
  const base = { id: newId(), type: "question", questionType, prompt };
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
    case "paraphrase":
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
// one editable row so an AI-suggested block matches a hand-made one.
function toAnswers(newId, raw) {
  const list = Array.isArray(raw)
    ? raw.filter((t) => typeof t === "string")
    : [];
  const answers = list.map((text) => ({ id: newId(), text }));
  if (answers.length === 0) answers.push({ id: newId(), text: "" });
  return answers;
}

// Turn an array of step strings into step rows. Unlike answers, steps are
// optional working-out lines, so an empty list is left empty rather than
// padded with a blank row.
function toSteps(newId, raw) {
  const list = Array.isArray(raw)
    ? raw.filter((t) => typeof t === "string")
    : [];
  return list.map((text) => ({ id: newId(), text }));
}
