// The prompt and the reply handling for the on-device extraction model behind
// Import from text: LFM2-1.2B-Extract fine-tuned on lesson documents
// (huggingface.co/playforgecoding/LFM2-1.2B-Extract-lesson-ONNX). The parser
// (documentImport.js) reads any regular document; the model is for one the
// parser cannot read, and it reads one section at a time.
//
// Everything the model was trained on is reproduced here exactly: the system
// prompt (the schema and the type guide), the shape of a section's text, and
// what a reply looks like. The experiment scripts that made the training data
// (scripts/extract-eval) import these same definitions, so the prompt the app
// sends cannot drift from the one the model learned.

// In the order the training prompt listed them, which is not QUESTION_TYPES'
// order; the enum is part of the prompt the model learned, so it stays put.
export const QUESTION_TYPE_KEYS = [
  "single",
  "number",
  "multiple",
  "multiple_open",
  "background",
  "open",
  "wyr",
  "paraphrase",
];

export const SCHEMA = JSON.stringify(
  {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "The section heading, or an empty string if there is none.",
      },
      paragraphs: {
        type: "array",
        description:
          "The passage: one item per paragraph, each paragraph copied in full, word for word, starting with the very first paragraph. Paragraphs are separated by blank lines in the document; a paragraph is a whole block of several sentences, never a single sentence.",
        items: { type: "string" },
      },
      spellingWords: {
        type: "array",
        description:
          "The words on the spelling line, in order, exactly as written.",
        items: { type: "string" },
      },
      questions: {
        type: "array",
        description: "Every question, in order.",
        items: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "The question as written, without its answer.",
            },
            type: { type: "string", enum: QUESTION_TYPE_KEYS },
            answers: {
              type: "array",
              description:
                "The answer or answers printed with the question, exactly as written. Empty when none is printed.",
              items: { type: "string" },
            },
            steps: {
              type: "array",
              description:
                "Numbered working-out lines under a number question. Usually empty.",
              items: { type: "string" },
            },
          },
          required: ["prompt", "type", "answers"],
        },
      },
    },
    required: ["name", "paragraphs", "spellingWords", "questions"],
  },
  null,
  1,
);

export const TYPE_GUIDE = `Question types:
- number: the answer is a number (often a blank ___ in the prompt, or a sum).
- single: one short answer taken from the passage.
- multiple: the prompt repeats a list from the passage and asks for one item; several answers are given.
- multiple_open: like multiple, but the answers are only suggestions.
- background: needs knowledge from outside the passage; one answer is given.
- wyr: begins "Would you rather"; no answer.
- paraphrase: asks to retell the passage in your own words; no answer.
- open: any other question with no answer.`;

/** The system prompt the model was trained with. */
export function systemPrompt() {
  return `Return data as a JSON object with the following schema:\n${SCHEMA}\n\n${TYPE_GUIDE}`;
}

/**
 * A section as the model expects to see it: the heading on its own line, then
 * the lines with a blank line between them, which is also how the training
 * documents were laid out.
 * @param {{heading?: string, lines: string[]}} section
 * @returns {string}
 */
export function sectionPromptText({ heading = "", lines }) {
  return (heading ? [heading, ""] : []).concat(lines.join("\n\n")).join("\n");
}

/** The messages for one section. */
export function sectionMessages(section) {
  return [
    { role: "system", content: systemPrompt() },
    { role: "user", content: sectionPromptText(section) },
  ];
}

// The keys a model drifts to, mapped back.
const KEY_ALIASES = {
  name: [
    "name",
    "section_title",
    "sectiontitle",
    "title",
    "heading",
    "section",
  ],
  paragraphs: ["paragraphs", "passage", "text", "paragraph"],
  spellingWords: ["spellingwords", "spelling_words", "spelling", "words"],
  questions: ["questions"],
};
const QUESTION_ALIASES = {
  prompt: ["prompt", "question", "text"],
  type: ["type", "questiontype", "question_type", "kind"],
  answers: ["answers", "answer", "value", "values"],
  steps: ["steps", "working", "workings"],
};

function pick(obj, aliases) {
  const keys = Object.keys(obj);
  for (const alias of aliases) {
    const key = keys.find((k) => k.toLowerCase() === alias);
    if (key !== undefined) return obj[key];
  }
  return undefined;
}

const asList = (v) => (v == null || v === "" ? [] : Array.isArray(v) ? v : [v]);
const asText = (v) =>
  typeof v === "string"
    ? v
    : v && typeof v === "object" && typeof v.text === "string"
      ? v.text
      : String(v ?? "");

// Close a reply that was cut off at the token cap: finish an open string,
// drop a trailing comma, then close every open bracket.
function closeJson(s) {
  const stack = [];
  let inString = false;
  let escaped = false;
  for (const ch of s) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let out = s;
  if (inString) out += '"';
  out = out.replace(/,\s*$/, "");
  while (stack.length) out += stack.pop();
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/**
 * The object in a reply, or null. A reply cut off mid-way is closed up as far
 * as it goes, which keeps the sections and questions it did finish.
 * @param {string} raw
 * @returns {object|null}
 */
export function parseModelJson(raw) {
  let s = String(raw ?? "")
    .replace(/```(?:json)?/g, "")
    .trim();
  const start = s.indexOf("{");
  if (start < 0) return null;
  s = s.slice(start);
  try {
    return JSON.parse(s);
  } catch {
    // fall through
  }
  const end = s.lastIndexOf("}");
  if (end > 0) {
    try {
      return JSON.parse(s.slice(0, end + 1));
    } catch {
      // fall through
    }
  }
  return closeJson(s);
}

/**
 * A reply as a parsed section, the same shape documentImport's parseSection
 * returns, plus the model's own `type` on each question, which is kept when
 * it names a real type. Null when the reply holds no section at all.
 * @param {string} raw
 * @returns {{name: string, paragraphs: string[], spellingWords: string[], questions: Array<{prompt: string, type: string, answers: string[], steps: string[]}>, vakt: string[]}|null}
 */
export function parseModelReply(raw) {
  const json = parseModelJson(raw);
  if (!json || typeof json !== "object") return null;
  const questions = asList(pick(json, KEY_ALIASES.questions))
    .filter((q) => q && typeof q === "object")
    .map((q) => {
      const type = String(pick(q, QUESTION_ALIASES.type) ?? "");
      return {
        prompt: asText(pick(q, QUESTION_ALIASES.prompt)).trim(),
        type: QUESTION_TYPE_KEYS.includes(type) ? type : "",
        answers: asList(pick(q, QUESTION_ALIASES.answers))
          .map(asText)
          .map((a) => a.trim())
          .filter(Boolean),
        steps: asList(pick(q, QUESTION_ALIASES.steps))
          .map(asText)
          .map((s) => s.trim())
          .filter(Boolean),
      };
    })
    .filter((q) => q.prompt);
  const paragraphs = asList(pick(json, KEY_ALIASES.paragraphs))
    .map(asText)
    .map((p) => p.trim())
    .filter(Boolean);
  const spellingWords = asList(pick(json, KEY_ALIASES.spellingWords))
    .map(asText)
    .map((w) => w.trim())
    .filter(Boolean);
  if (!paragraphs.length && !questions.length && !spellingWords.length) {
    return null;
  }
  return {
    name: asText(pick(json, KEY_ALIASES.name)).trim(),
    paragraphs,
    spellingWords,
    questions,
    vakt: [],
  };
}
