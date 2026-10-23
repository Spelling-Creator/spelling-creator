// Interactive lesson mode — turning a lesson document into an ordered walkthrough
// a learner steps through one screen at a time, typing an answer to each question.
//
// This is a *derived* view of the existing document, not a new document shape:
// nothing is added to `doc` when a lesson is authored, so every lesson ever
// published — including ones made before this feature existed, and ones written
// by the MCP server — is playable. A lesson with no questions is still playable;
// it simply has no answer fields.
//
// The walkthrough is built once per lesson and consists of two kinds of step:
//
//   content  — a section's non-question blocks (text, images, spelling words),
//              shown together as that section's material.
//   question — a single question block, with a text field for the learner's
//              answer. Questions come in document order within their section,
//              after that section's content.
//
// A section with no content blocks contributes no content step (an all-questions
// section goes straight to its first question), and a section with nothing in it
// at all contributes nothing. Question numbering restarts per section, matching
// the editor's `Q7`-style numbering.
//
// The learner's typed answers are stored privately in their account (see
// lessonResponses.ts and the Worker's /lessons/:id/responses). The limits below
// are shared with the Worker so the browser and server agree on what a valid
// submission is.

import { imageCaptionParts } from "./imageCredit.ts";
import { inlineTextPlain } from "./inlineText.ts";
import { type QuestionFields, questionAnswerPlain } from "./questions.ts";
import {
  type SpokenRun,
  inlineTextSpeech,
  speechText,
  textBlockSpeech,
} from "./speech.ts";
import { headingText } from "./heading.ts";
import { vaktText } from "./vakt.ts";
import type { Block, InlineText, QuestionType } from "./types.ts";

// Each block type with every field optional but its type.
type PartialBlock<B extends Block> = B extends Block
  ? Partial<B> & Pick<B, "type">
  : never;

/** A block of a lesson as interactive mode reads it: any field but its type may be missing. */
export type InteractiveBlock = PartialBlock<Block>;

/** A block that is part of a section's material rather than something asked. */
export type InteractiveContentBlock = Exclude<
  InteractiveBlock,
  { type: "question" }
>;

/** A question block as interactive mode reads it. */
export type InteractiveQuestionBlock = Extract<
  InteractiveBlock,
  { type: "question" }
>;

export interface InteractiveSection {
  id?: string;
  name?: string;
  blocks?: Array<InteractiveBlock | null | undefined> | null;
}

/**
 * A lesson document as interactive mode reads it. Every lesson ever published
 * has to play, including older ones and hand-written JSON, so a section or a
 * block may be missing its id and a list may be missing altogether.
 */
export interface InteractiveDoc {
  title?: string;
  sections?: Array<InteractiveSection | null | undefined> | null;
}

interface StepBase {
  key: string;
  sectionId: string;
  sectionIndex: number;
  sectionName: string;
}

/** A section's material, shown together on one screen. */
export interface ContentStep extends StepBase {
  kind: "content";
  blocks: InteractiveContentBlock[];
}

/** One question, with a field for the learner's answer. */
export interface QuestionStep extends StepBase {
  kind: "question";
  block: InteractiveQuestionBlock;
  questionNumber: number;
}

/** A step of the walkthrough, as buildInteractiveSteps makes it. */
export type InteractiveStep = ContentStep | QuestionStep;

/** The parts of a step that say what it reads aloud. */
export type SpokenStep =
  | Pick<ContentStep, "kind" | "sectionName" | "blocks">
  | Pick<QuestionStep, "kind" | "sectionName" | "block">;

/**
 * The fields of a block that the answer readers look at. Any block will do
 * (only a question has an answer to reveal), and so will a question mid-edit
 * or hand-written, with any field missing.
 */
export interface AnswerFields extends QuestionFields {
  type?: string;
  steps?: ReadonlyArray<{ text?: InlineText } | null | undefined>;
}

/** The author's answer to a question, as interactive mode reveals it. */
export interface QuestionAnswer {
  answer: string;
  answers: string[];
  steps: InlineText[];
  suggested: boolean;
}

/**
 * One question's entry in a saved run-through: the learner's answer, with a
 * snapshot of the question it answered.
 */
export interface LessonResponseAnswer {
  blockId: string;
  sectionId: string;
  sectionName: string;
  questionType: QuestionType;
  prompt: string;
  answer: string;
}

// Block types that make up a section's material, in the order the document has
// them. Everything that isn't a question block and isn't unknown to us.
//
// VAKT activities are in here rather than being steps of their own: a regulation
// break is something whoever is running the lesson does with the speller, not
// something the speller answers, so it belongs with the section's material and
// must not be counted by the progress bar.
const CONTENT_BLOCK_TYPES: ReadonlySet<string> = new Set<
  InteractiveContentBlock["type"]
>(["text", "image", "spelling", "vakt", "heading"]);

/** The longest single typed answer we accept. Long enough for an essay-style
 * open-ended response, short enough that a submission can't be a payload. */
export const MAX_RESPONSE_LENGTH = 5000;

/** The most answers one submission may carry — far above any real lesson (the
 * largest published lessons run to a few dozen questions). */
export const MAX_RESPONSES = 500;

/** How many completed run-throughs of one lesson a user may keep. Past that they
 * delete an old one first, rather than accumulating forever. */
export const MAX_STORED_RESPONSES = 20;

/**
 * Whether a block asks the learner something (and so gets its own step with an
 * answer field).
 */
export function isQuestionBlock<B extends { type?: unknown }>(
  block: B | null | undefined,
): block is B & { type: "question" } {
  return !!block && block.type === "question";
}

/**
 * Build the ordered walkthrough for a lesson document.
 *
 * @param doc  The lesson document ({ title, sections: [{ name, blocks }] }).
 * @returns The steps, in the order they are presented.
 */
export function buildInteractiveSteps(
  doc: InteractiveDoc | null | undefined,
): InteractiveStep[] {
  const steps: InteractiveStep[] = [];
  const sections = Array.isArray(doc?.sections) ? doc.sections : [];

  sections.forEach((section, sectionIndex) => {
    const blocks = Array.isArray(section?.blocks) ? section.blocks : [];
    // A block with no id of its own (older documents, hand-written JSON) still
    // needs a stable React key and a stable answer key, so fall back to its
    // position — which is stable for as long as the document is.
    const sectionId = section?.id || `section-${sectionIndex}`;
    const sectionName = (section?.name || "").trim();

    const content = blocks.filter(
      (block): block is InteractiveContentBlock =>
        !!block && CONTENT_BLOCK_TYPES.has(block.type),
    );
    if (content.length > 0) {
      steps.push({
        key: `${sectionId}:content`,
        kind: "content",
        sectionId,
        sectionIndex,
        sectionName,
        blocks: content,
      });
    }

    let questionNumber = 0;
    blocks.forEach((block, blockIndex) => {
      if (!isQuestionBlock(block)) return;
      questionNumber += 1;
      steps.push({
        key: `${sectionId}:${block.id || `block-${blockIndex}`}`,
        kind: "question",
        sectionId,
        sectionIndex,
        sectionName,
        block,
        questionNumber,
      });
    });
  });

  return steps;
}

/**
 * How many questions a lesson asks in total — what the walkthrough's progress
 * counter counts, and what tells the lesson page whether to offer interactive
 * mode as a practice run or just a read-through.
 */
export function countInteractiveQuestions(
  doc: InteractiveDoc | null | undefined,
): number {
  return (Array.isArray(doc?.sections) ? doc.sections : []).reduce(
    (total, section) =>
      total +
      (Array.isArray(section?.blocks) ? section.blocks : []).filter(
        isQuestionBlock,
      ).length,
    0,
  );
}

/**
 * Whether a lesson has anything to walk through at all — i.e. whether offering
 * interactive mode would lead anywhere. False only for a genuinely empty document
 * (no sections, or sections with no blocks in them), which the hub can hold: a
 * lesson needs one section to publish, not one block.
 */
export function isInteractivePlayable(
  doc: InteractiveDoc | null | undefined,
): boolean {
  return (Array.isArray(doc?.sections) ? doc.sections : []).some(
    (section) =>
      (Array.isArray(section?.blocks) ? section.blocks : []).length > 0,
  );
}

/**
 * What one step says, for text-to-speech (see the web app's useSpeech hook):
 * lines of spoken text (see speech.ts), one idea per line. Reading order
 * matches what's on screen: the section name first, then each block's words. A
 * text block's lines and a question's prompt carry their pronunciations,
 * substitutions, spell-outs, pauses and formulas; everything else is plain
 * words.
 *
 * Deliberately excluded: a question's *answer*. Interactive mode can show the
 * author's answer on screen when whoever is presenting turns the reveal on (see
 * questionAnswer below), but it is never spoken: speech is a learner's setting
 * as often as a presenter's, and saying the answer out loud the moment a
 * question appears would give it away to the one person meant to work it out.
 *
 * @param step  A step from buildInteractiveSteps.
 */
export function stepSpeech(
  step: SpokenStep | null | undefined,
): Array<string | SpokenRun[]> {
  if (!step) return [];
  const lines: Array<string | SpokenRun[]> = [];
  if (step.sectionName) lines.push(step.sectionName);

  if (step.kind === "question") {
    const prompt = inlineTextSpeech(step.block?.prompt);
    if (prompt.length) lines.push(prompt);
    return lines;
  }

  for (const block of step.blocks || []) {
    if (block.type === "text") {
      lines.push(...textBlockSpeech(block));
    } else if (block.type === "image") {
      // The caption, never the credit: a license read out mid-lesson is noise.
      const { caption } = imageCaptionParts(block);
      if (caption) lines.push(caption);
    } else if (block.type === "spelling") {
      const words = (block.words || [])
        .map((word) => (word.text || "").trim())
        .filter(Boolean);
      if (words.length) lines.push(words.join(", "));
    } else if (block.type === "vakt") {
      // The activity itself, without the "VAKT:" label and without its links:
      // the label is a marker for the eye and a read-out URL is unusable.
      const text = vaktText(block);
      if (text) lines.push(text);
    } else if (block.type === "heading") {
      const text = headingText(block);
      if (text) lines.push(text);
    }
  }

  return lines;
}

/**
 * What one step says, as it would read on a screen: plain text, one utterance
 * per line, with each hint's words as written.
 * @param step  A step from buildInteractiveSteps.
 */
export function stepSpeechText(step: SpokenStep | null | undefined): string {
  return speechText(stepSpeech(step));
}

/**
 * The author's answer to a question block, flattened into the one shape
 * interactive mode's "show answers" reveal renders.
 *
 * Each question type keeps its answer somewhere different — `single` and
 * `background` in `answer`, `number` in `answer` plus optional working `steps`,
 * the two semi-open types in an `answers` list, and `open` nowhere at all, by
 * design — so this is derived once here rather than re-derived per type at every
 * call site.
 *
 * `suggested` is what the two semi-open types disagree about. A `multiple`
 * question's answers are the whole accepted set; a `multiple_open` one's are
 * examples, and a learner who wrote something else that fits the topic is also
 * right. Whoever is looking at the reveal is usually the person deciding that,
 * so the distinction has to travel with the answers rather than being something
 * they are expected to remember about the question type.
 *
 * Returns null when there is nothing to reveal: an open-ended question, a type
 * we don't know, or one whose author left the answer blank. That is deliberately
 * distinct from an empty answer, so a presenter is told the question has no set
 * answer instead of being shown a gap and left wondering.
 *
 * The steps are inline text (see inlineText.ts), each as stored: the reveal
 * draws them with their formulas, and a step is shown as its plain words
 * everywhere else.
 *
 * @param block  A question block.
 */
export function questionAnswer(
  block: AnswerFields | InteractiveBlock | null | undefined,
): QuestionAnswer | null {
  if (!isQuestionBlock(block)) return null;

  const trimmed = (value: unknown) => String(value ?? "").trim();
  type Entries<T> = ReadonlyArray<{ text?: T } | null | undefined>;
  // Array.isArray narrows a readonly array to any[], so the list is typed here.
  const entries = <T>(list: Entries<T> | undefined): Entries<T> =>
    Array.isArray(list) ? list : [];
  const texts = (list: Entries<string> | undefined) =>
    entries(list)
      .map((entry) => trimmed(entry?.text))
      .filter(Boolean);
  const steps = (list: Entries<InlineText> | undefined): InlineText[] =>
    entries(list)
      .filter(
        (entry): entry is { text: InlineText } =>
          !!inlineTextPlain(entry?.text).trim(),
      )
      .map((entry) => entry.text);

  switch (block.questionType) {
    // A tight open's examples are suggestions in the same sense a loose
    // orange question's are: a reveal shows them as what would count, never
    // as the only right answers.
    case "multiple":
    case "multiple_open":
    case "tight_open": {
      const answers = texts(block.answers);
      if (!answers.length) return null;
      return {
        answer: "",
        answers,
        steps: [],
        suggested: block.questionType !== "multiple",
      };
    }
    case "number": {
      // A number question can carry its working with it, and a half-filled one
      // (working but no total, or the reverse) is still worth revealing.
      const answer = questionAnswerPlain(block.answer).trim();
      const working = steps(block.steps);
      return answer || working.length
        ? { answer, answers: [], steps: working, suggested: false }
        : null;
    }
    case "single":
    case "background": {
      const answer = questionAnswerPlain(block.answer).trim();
      return answer
        ? { answer, answers: [], steps: [], suggested: false }
        : null;
    }
    default:
      return null;
  }
}

/**
 * The author's answers to one question as a flat list — one entry per answer the
 * reveal puts on screen, in the order it shows them.
 *
 * The types differ in how many there can be, not in kind: a `single`, `number`
 * or `background` question has one answer, a semi-open one has an entry per
 * accepted (or, for `multiple_open`, suggested) answer, and an open-ended
 * question has none. Flattening that here
 * rather than at the call site is what lets the reveal draw every answer the
 * same way — one to a box, each its own thing to point at or click — instead of
 * a value for one type and a bullet list for another.
 *
 * A number question's working is deliberately not in here. It is how you get to
 * the answer, not an answer, and it is shown as working.
 *
 * @param block  A question block.
 */
export function revealedAnswers(
  block: AnswerFields | InteractiveBlock | null | undefined,
): string[] {
  const revealed = questionAnswer(block);
  if (!revealed) return [];
  if (revealed.answers.length > 0) return revealed.answers;
  return revealed.answer ? [revealed.answer] : [];
}

/**
 * Whether a walkthrough has any author's answer to reveal at all — i.e. whether
 * offering the reveal would lead anywhere. False for a lesson with no questions,
 * and for one whose questions are all open-ended or left unanswered.
 * @param steps  Steps from buildInteractiveSteps.
 */
export function hasRevealableAnswers(
  steps: Array<InteractiveStep | null | undefined> | null | undefined,
): boolean {
  return (Array.isArray(steps) ? steps : []).some(
    (step) => step?.kind === "question" && questionAnswer(step.block) !== null,
  );
}

/**
 * The answer-field key for a question step. Answers are held (and stored) keyed
 * by block id so re-ordering a lesson between run-throughs doesn't shuffle which
 * answer belongs to which question.
 */
export function answerKey(
  step: { key?: string; block?: { id?: string } | null } | null | undefined,
): string {
  return step?.block?.id || step?.key || "";
}

/**
 * Shape the learner's typed answers into the payload stored in their account.
 *
 * The question's prompt and type are snapshotted alongside the answer on
 * purpose: a saved run-through has to stay readable years later even if the
 * lesson has since been edited, re-ordered, or had that question deleted
 * outright. Blank answers are kept — "I skipped question 3" is itself a fact
 * about the run-through, and dropping them would silently renumber the rest.
 *
 * @param steps    Steps from buildInteractiveSteps.
 * @param answers  Typed answers, keyed by answerKey(step).
 */
export function collectResponses(
  steps: readonly InteractiveStep[] | null | undefined,
  answers: Readonly<Record<string, string>> | null | undefined,
): LessonResponseAnswer[] {
  return (steps || [])
    .filter((step): step is QuestionStep => step.kind === "question")
    .map((step) => ({
      blockId: answerKey(step),
      sectionId: step.sectionId,
      sectionName: step.sectionName,
      questionType: step.block?.questionType || "open",
      prompt: inlineTextPlain(step.block?.prompt).trim(),
      answer: (answers?.[answerKey(step)] || "").slice(0, MAX_RESPONSE_LENGTH),
    }));
}

/**
 * Validate a submission the way the Worker does, so the browser can refuse an
 * impossible save before making the round trip and the two agree on the reason.
 * Returns null when the payload is fine, or a short human-readable problem.
 */
export function validateResponses(responses: unknown): string | null {
  if (!Array.isArray(responses)) return "Answers must be a list.";
  if (responses.length > MAX_RESPONSES) {
    return `A lesson run-through can hold at most ${MAX_RESPONSES} answers.`;
  }
  // Array.isArray narrows `unknown` to any[]; each entry is unchecked.
  for (const response of responses as readonly unknown[]) {
    if (!response || typeof response !== "object") {
      return "Each answer must be an object.";
    }
    if (!("answer" in response) || typeof response.answer !== "string") {
      return "Each answer must be text.";
    }
    if (response.answer.length > MAX_RESPONSE_LENGTH) {
      return `Answers are limited to ${MAX_RESPONSE_LENGTH} characters.`;
    }
  }
  return null;
}
