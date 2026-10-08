// Import a lesson from a document that was never a lesson file: text pasted
// from anywhere, a .txt, or a Word file written by hand rather than exported
// from this app. The app's own exports have lossless paths of their own
// (jsonImport.js, browser/docxImport.js); this is for everything else.
//
// It is rules, not a model. An experiment (docs: "Document import experiment")
// put small on-device models up against these rules on seven document layouts
// and the rules won on every column, so the model stays out of the way. The
// shape it reads:
//
//   - A passage: one or more prose paragraphs.
//   - A spelling line: "Spell:", "Spelling words:", "Words:", and so on.
//   - Questions, one per line, numbered or bulleted or neither, with an answer
//     attached in any of the usual ways: after a gap (this app's own export),
//     "(Answer: ...)", "[...]", "A: ..." on the next line, ": ..." at the end,
//     or a bare run of CAPITALS.
//   - Optional working-out under a number question.
//
// A new section starts wherever a passage follows questions. A heading line
// directly before a passage names the section. The question type is never read
// from the document (nothing in a typed page says it); it is derived from the
// answers and the wording, the same way a reader would tell them apart.

import { normalizeLessonFile } from "./jsonImport.js";

export class DocumentImportError extends Error {
  constructor(message) {
    super(message);
    this.name = "DocumentImportError";
  }
}

const GAP = /\u00A0/;
const QUESTION_OPENERS =
  /^(Name|Give|List|Would you rather|In your own words|Explain|Describe|Tell|Think|Imagine|Design|Write|Say|Share|Pick|Choose|Which|Who|What|Why|How|Where|When|If|Do you|Does|Is|Are|Should|Could|Can)\b/;

/**
 * What one line of a document is: "prose", "spelling", "question", "steps",
 * "heading", "vakt", "source" or "other".
 * @param {string} line
 * @returns {string}
 */
export function classifyLine(line) {
  const t = line.trim();
  if (!t) return "other";
  if (/^(Spell(?:ing)?(?: words| list| these)?|Words)\s*[:-]/i.test(t)) {
    return "spelling";
  }
  if (/^VAKT:/i.test(t)) return "vakt";
  if (/^Working(?: out)?\s*:/i.test(t)) return "steps";
  if (/https?:\/\//.test(t)) return "source";
  if (t.length >= 280) return "prose";
  if (GAP.test(t)) return "question";
  if (/^(?:q\s*)?\d+\s*[.)]\s/i.test(t)) return "question";
  if (/^(?:[-*]\s+|[QA]\s*:\s*)/i.test(t)) return "question";
  if (t.includes("?") || t.includes("___")) return "question";
  if (/\b(in your own words|defend your|explain)\b/i.test(t)) return "question";
  if (QUESTION_OPENERS.test(t) && t.length < 260) return "question";
  // A sentence that ends mid-line with more text after it and no full stop at
  // the end: a question with its answer tacked on ("Give a synonym. HARSH").
  if (/[.!?]\s+\S/.test(t) && !/[.!?]$/.test(t)) return "question";
  if (t.length < 80 && !/[.!?]$/.test(t)) return "heading";
  return "prose";
}

// Lines of a title block that are not section names: the by-line, the age
// range and the date this app's export prints under the title, and the like.
const TITLE_BLOCK_LINE =
  /^(by|ages?|age range|for ages|grade|published|released|updated)\b/i;

/**
 * Cut a document into sections by structure: a passage paragraph that follows
 * questions (or a spelling line) begins a new section, and a short heading
 * line directly before a passage goes with it. A chunk with no questions is
 * a closing paragraph and stays with its section; anything after the last
 * real section (sources, footnote bodies) is dropped.
 * @param {string} text
 * @returns {{title: string, sections: Array<{heading: string, lines: string[]}>}}
 */
export function splitSections(text) {
  const lines = String(text ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const title = lines[0] || "";
  const sections = [];
  let current = null;
  let previous = "heading";
  let pendingHeading = "";
  for (const line of lines.slice(1)) {
    const kind = classifyLine(line);
    if (kind === "heading") {
      if (!(current === null && TITLE_BLOCK_LINE.test(line))) {
        pendingHeading = line;
      }
      previous = kind;
      continue;
    }
    const startsSection =
      kind === "prose" && (previous !== "prose" || current === null);
    if (startsSection) {
      current = { heading: pendingHeading, lines: [], questions: 0 };
      sections.push(current);
    }
    pendingHeading = "";
    if (current && kind !== "source") {
      current.lines.push(line);
      if (kind === "question") current.questions += 1;
    }
    previous = kind;
  }
  while (sections.length && sections[sections.length - 1].questions === 0) {
    sections.pop();
  }
  const merged = [];
  for (const s of sections) {
    if (s.questions === 0 && merged.length) {
      merged[merged.length - 1].lines.push(...s.lines);
    } else {
      merged.push(s);
    }
  }
  return {
    title,
    sections: merged.map(({ heading, lines: ls }) => ({ heading, lines: ls })),
  };
}

const QUESTION_PREFIX = /^(?:q\s*)?\d+\s*[.):]\s*|^[-*]\s+|^q:\s*/i;
const ANSWER_LINE = /^a(?:nswers?)?\s*:\s*/i;

function listOf(text) {
  const sep = text.includes(";") ? ";" : text.includes(" / ") ? "/" : ",";
  return text
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
}

function spellingWordsOf(line) {
  return line
    .replace(/^[^:-]*[:-]\s*/, "")
    .replace(/\u00A0/g, " ")
    .split(/[\s,]+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

// Each rule returns { prompt, answers } or null when it does not apply.
const SPLIT_RULES = [
  // This app's own export: prompt, a gap, the answers each after a gap.
  (line) => {
    if (!GAP.test(line)) return null;
    const [prompt, ...answers] = line.split(/\s*\u00A0\s*/);
    return { prompt: prompt.trim(), answers: answers.filter(Boolean) };
  },
  (line) => {
    const m = /^(.*?)\s*\((?:answers?|ans)\s*:\s*([^)]*)\)\s*$/i.exec(line);
    return m ? { prompt: m[1], answers: listOf(m[2]) } : null;
  },
  (line) => {
    const m = /^(.*?)\s*\[([^\]]*)\]\s*$/.exec(line);
    return m ? { prompt: m[1], answers: listOf(m[2]) } : null;
  },
];

// A question that ends on its question mark, or on a closing instruction, has
// no answer glued to it.
const CLEAN_END =
  /(\?|defend your (?:answer|choices|thinking)\.|explain (?:your|what|why|in)[^.]*\.|in your own words[^.]*\.)\s*$/i;

// A trailing run of capitals, or a short tail after the last colon.
function splitByHeuristic(line) {
  const capsRun =
    /^(.*?[a-z][.!?])\s+((?:[A-Z0-9][A-Z0-9',.-]*(?:\s+|\s*\/\s*)?)+)$/.exec(
      line,
    );
  if (capsRun && !/[a-z]/.test(capsRun[2])) {
    return { prompt: capsRun[1], answers: listOf(capsRun[2]) };
  }
  const colon = line.lastIndexOf(": ");
  if (
    colon > 0 &&
    line.length - colon < 60 &&
    !line.slice(colon).includes("?")
  ) {
    return {
      prompt: line.slice(0, colon),
      answers: listOf(line.slice(colon + 2)),
    };
  }
  return { prompt: line, answers: [] };
}

function splitQuestionLine(line) {
  for (const rule of SPLIT_RULES) {
    const split = rule(line);
    if (split) return split;
  }
  if (CLEAN_END.test(line)) return { prompt: line, answers: [] };
  return splitByHeuristic(line);
}

/**
 * One section's lines to the lesson shape, with no question types yet.
 * @param {string[]} lines
 * @param {string} [heading]
 * @returns {{name: string, paragraphs: string[], spellingWords: string[], questions: Array<{prompt: string, answers: string[], steps: string[]}>}}
 */
export function parseSection(lines, heading = "") {
  const out = {
    name: heading.replace(/^part \d+:\s*/i, ""),
    paragraphs: [],
    spellingWords: [],
    questions: [],
    vakt: [],
  };
  const kinds = lines.map(classifyLine);
  // Numbered lines are questions when the questions are numbered, and a
  // number question's working-out otherwise (this app's export prints no
  // question numbers, only numbered steps).
  const firstQuestion = lines.find((l, i) => kinds[i] === "question") || "";
  const numberedQuestions = /^(?:q\s*)?\d+\s*[.):]/i.test(firstQuestion);
  const last = () => out.questions[out.questions.length - 1];

  lines.forEach((line, i) => {
    const kind = kinds[i];
    if (kind === "prose") {
      out.paragraphs.push(line);
    } else if (kind === "spelling") {
      out.spellingWords.push(...spellingWordsOf(line));
    } else if (kind === "vakt") {
      out.vakt.push(line.replace(/^VAKT:\s*/i, ""));
    } else if (kind === "steps") {
      const q = last();
      if (q) {
        q.steps = line
          .replace(/^working(?: out)?\s*:\s*/i, "")
          .split(/\s+(?=\d+\.\s)/)
          .map((s) => s.replace(/^\d+\.\s*/, "").trim())
          .filter(Boolean);
      }
    } else if (kind === "question") {
      if (ANSWER_LINE.test(line)) {
        const q = last();
        if (q) q.answers = listOf(line.replace(ANSWER_LINE, ""));
        return;
      }
      if (/^\d+\s*[.)]/.test(line) && !numberedQuestions) {
        const q = last();
        if (q) q.steps.push(line.replace(/^\d+\s*[.)]\s*/, ""));
        return;
      }
      const split = splitQuestionLine(line.replace(QUESTION_PREFIX, ""));
      out.questions.push({
        prompt: split.prompt.trim(),
        answers: split.answers.map((a) => a.trim()).filter(Boolean),
        steps: [],
      });
    }
  });
  return out;
}

// Case, punctuation and the thousands separator do not count.
const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/(\d),(\d)/g, "$1$2")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The question type, from the wording and the answers: the three answerless
 * types by their wording, the rest by how many answers there are and whether
 * they are in the passage. Nothing in a typed document names the type, and in
 * the experiment a model guessing it did no better than chance.
 * @param {{prompt: string, answers: string[]}} question
 * @param {string} passage the section's passage, plain text
 * @returns {string} a key of QUESTION_TYPES
 */
export function deriveQuestionType(question, passage) {
  const prompt = norm(question.prompt);
  const answers = (question.answers || []).map(norm).filter(Boolean);
  if (prompt.startsWith("would you rather")) return "wyr";
  if (/\bin your own words\b/.test(prompt)) return "paraphrase";
  if (!answers.length) return "open";
  const text = ` ${norm(passage)} `;
  const inPassage = (a) =>
    text.includes(` ${a} `) ||
    text.includes(` ${a.replace(/^(a|an|the) /, "")} `);
  if (answers.length > 1) {
    return answers.every(inPassage) ? "multiple" : "multiple_open";
  }
  if (/^\d[\d\s.]*$/.test(answers[0])) return "number";
  return inPassage(answers[0]) ? "single" : "background";
}

function questionBlock(q, passage) {
  const questionType = deriveQuestionType(q, passage);
  const base = { type: "question", questionType, prompt: q.prompt };
  switch (questionType) {
    case "number":
      return { ...base, answer: q.answers[0] ?? "", steps: q.steps };
    case "single":
    case "background":
      return { ...base, answer: q.answers[0] ?? "" };
    case "multiple":
    case "multiple_open":
      return { ...base, answers: q.answers };
    default:
      return base;
  }
}

/**
 * How much of a lesson the text holds, for showing before importing.
 * @param {string} text
 * @returns {{title: string, sections: Array<{name: string, paragraphs: number, spellingWords: number, questions: number, answered: number}>}}
 */
export function previewLessonText(text) {
  const { title, sections } = splitSections(text);
  return {
    title,
    sections: sections.map(({ heading, lines }, i) => {
      const s = parseSection(lines, heading);
      return {
        name: s.name || `Section ${i + 1}`,
        paragraphs: s.paragraphs.length,
        spellingWords: s.spellingWords.length,
        questions: s.questions.length,
        answered: s.questions.filter((q) => q.answers.length).length,
      };
    }),
  };
}

/**
 * The text of a document as a lesson in the editor's shape, or a
 * DocumentImportError when no lesson can be found in it.
 * @param {string} text
 * @returns {{title: string, sections: object[]}}
 */
export function importLessonText(text) {
  const { title, sections } = splitSections(text);
  if (!sections.length) {
    throw new DocumentImportError(
      "No lesson was found in this text. It needs at least one passage followed by its questions, one question per line.",
    );
  }
  return normalizeLessonFile({
    title: title || "Imported lesson",
    sections: sections.map(({ heading, lines }, i) => {
      const s = parseSection(lines, heading);
      const passage = s.paragraphs.join("\n");
      return {
        name: s.name || `Section ${i + 1}`,
        blocks: [
          ...s.paragraphs.map((t) => ({ type: "text", text: t })),
          ...(s.spellingWords.length
            ? [{ type: "spelling", words: s.spellingWords }]
            : []),
          ...s.questions.map((q) => questionBlock(q, passage)),
          ...s.vakt.map((text) => ({ type: "vakt", text, links: [] })),
        ],
      };
    }),
  });
}
