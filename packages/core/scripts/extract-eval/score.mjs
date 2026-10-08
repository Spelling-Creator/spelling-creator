// How close an extraction came to the lesson it was rendered from, and whether
// a lesson rebuilt from it passes the lesson checks.

import { deriveQuestionType } from "../../src/documentImport.js";
import { normalizeLessonFile } from "../../src/jsonImport.js";
import { validateLesson } from "../../src/lessonChecks.js";
import { textBlockPlain } from "../../src/lessonText.js";
import { questionAnswerItems } from "../../src/questions.js";

export function groundTruthSection(section) {
  const blocks = section.blocks;
  return {
    name: section.name || "",
    paragraphs: blocks
      .filter((b) => b.type === "text")
      .map(textBlockPlain)
      .filter((t) => t.trim()),
    spellingWords: blocks
      .filter((b) => b.type === "spelling")
      .flatMap((b) => b.words.map((w) => w.text)),
    questions: blocks
      .filter((b) => b.type === "question")
      .map((b) => ({
        prompt: b.prompt || "",
        type: b.questionType,
        answers: questionAnswerItems(b),
        steps: (b.steps || []).map((s) => s.text),
      })),
  };
}

// Case, punctuation and the thousands separator do not count: "10,000" is "10000".
const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/(\d),(\d)/g, "$1$2")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

function dice(a, b) {
  const wa = new Set(norm(a).split(" ").filter(Boolean));
  const wb = new Set(norm(b).split(" ").filter(Boolean));
  if (!wa.size && !wb.size) return 1;
  let both = 0;
  for (const w of wa) if (wb.has(w)) both += 1;
  return (2 * both) / (wa.size + wb.size);
}

function setF1(a, b) {
  const sa = new Set(a.map(norm).filter(Boolean));
  const sb = new Set(b.map(norm).filter(Boolean));
  if (!sa.size && !sb.size) return 1;
  let both = 0;
  for (const w of sa) if (sb.has(w)) both += 1;
  const p = sb.size ? both / sb.size : 0;
  const r = sa.size ? both / sa.size : 0;
  return p + r ? (2 * p * r) / (p + r) : 0;
}

const list = (v) => (Array.isArray(v) ? v.map((x) => String(x ?? "")) : []);

// The question type, worked out from what was extracted rather than asked of
// the model. The rule is the import's own (core/documentImport.js); a small
// model guessing the type from a list of names did no better than chance.
export function deriveType(q, passage) {
  return deriveQuestionType(
    { prompt: String(q?.prompt ?? ""), answers: list(q?.answers) },
    passage,
  );
}

// Share of the passage's words that turn up anywhere in the extracted passage.
function coverage(gtParagraphs, exParagraphs) {
  const have = new Set(norm(exParagraphs.join(" ")).split(" ").filter(Boolean));
  const want = norm(gtParagraphs.join(" ")).split(" ").filter(Boolean);
  if (!want.length) return 1;
  return want.filter((w) => have.has(w)).length / want.length;
}

/**
 * @returns {object} per-section metrics, each 0-1 unless noted
 */
export function scoreSection(gt, ex) {
  if (!ex || typeof ex !== "object") {
    return {
      parsed: false,
      passageRecall: 0,
      passageCoverage: 0,
      paragraphCountOk: false,
      spellingF1: 0,
      promptRecall: 0,
      promptPrecision: 0,
      typeAccuracy: 0,
      derivedTypeAccuracy: 0,
      answerAccuracy: 0,
      composite: 0,
    };
  }
  const exParas = list(ex.paragraphs);
  const passageRecall = gt.paragraphs.length
    ? gt.paragraphs.reduce(
        (sum, p) => sum + Math.max(0, ...exParas.map((q) => dice(p, q))),
        0,
      ) / gt.paragraphs.length
    : 1;
  const passageCoverage = coverage(gt.paragraphs, exParas);
  const spellingF1 = setF1(gt.spellingWords, list(ex.spellingWords));
  const passage = exParas.join("\n");

  const exQs = (Array.isArray(ex.questions) ? ex.questions : []).filter(
    (q) => q && typeof q === "object",
  );
  const used = new Set();
  let matched = 0;
  let typeOk = 0;
  let derivedOk = 0;
  let answerOk = 0;
  for (const q of gt.questions) {
    let best = -1;
    let bestSim = 0.6;
    exQs.forEach((cand, i) => {
      if (used.has(i)) return;
      const sim = dice(q.prompt, cand.prompt);
      if (sim > bestSim) {
        bestSim = sim;
        best = i;
      }
    });
    if (best < 0) continue;
    used.add(best);
    matched += 1;
    const cand = exQs[best];
    if (String(cand.type) === q.type) typeOk += 1;
    if (deriveType(cand, passage) === q.type) derivedOk += 1;
    if (setF1(q.answers, list(cand.answers)) === 1) answerOk += 1;
  }
  const promptRecall = gt.questions.length ? matched / gt.questions.length : 1;
  const promptPrecision = exQs.length ? matched / exQs.length : 0;
  const typeAccuracy = matched ? typeOk / matched : 0;
  const derivedTypeAccuracy = matched ? derivedOk / matched : 0;
  const answerAccuracy = matched ? answerOk / matched : 0;
  const promptF1 =
    promptRecall + promptPrecision
      ? (2 * promptRecall * promptPrecision) / (promptRecall + promptPrecision)
      : 0;
  // The composite uses the derived type, since that is what an import would
  // store; the model's own guess is reported beside it.
  const composite =
    (passageCoverage +
      spellingF1 +
      promptF1 +
      derivedTypeAccuracy +
      answerAccuracy) /
    5;
  return {
    parsed: true,
    passageRecall,
    passageCoverage,
    paragraphCountOk: exParas.length === gt.paragraphs.length,
    spellingF1,
    promptRecall,
    promptPrecision,
    typeAccuracy,
    derivedTypeAccuracy,
    answerAccuracy,
    composite,
  };
}

function questionBlock(q, passage) {
  const type = deriveType(q, passage);
  const answers = list(q?.answers);
  const base = {
    type: "question",
    questionType: type,
    prompt: String(q?.prompt ?? ""),
  };
  switch (type) {
    case "number":
      return { ...base, answer: answers[0] ?? "", steps: list(q?.steps) };
    case "single":
    case "background":
      return { ...base, answer: answers[0] ?? "" };
    case "multiple":
    case "multiple_open":
      return { ...base, answers };
    default:
      return base;
  }
}

/** A lesson document built from the extracted sections, in the editor's shape. */
export function lessonFromExtraction(title, sections) {
  return normalizeLessonFile({
    title,
    sections: sections.map((s, i) => ({
      name: String(s?.name || `Section ${i + 1}`),
      blocks: [
        ...list(s?.paragraphs).map((text) => ({ type: "text", text })),
        { type: "spelling", words: list(s?.spellingWords) },
        ...(Array.isArray(s?.questions) ? s.questions : []).map((q) =>
          questionBlock(q, list(s?.paragraphs).join("\n")),
        ),
      ],
    })),
  });
}

export function checkCounts(doc) {
  const { errors, warnings } = validateLesson(doc);
  return { errors: errors.length, warnings: warnings.length };
}
