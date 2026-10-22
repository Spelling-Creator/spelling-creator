// AI fixes for lesson check findings: the ones that need judgement.
//
// A green answer that isn't in its passage can be fixed by changing the answer
// or by changing the passage, and only someone who understands both can say
// which. The quick fixes in lessonFixes.ts can't do that, so for these codes
// the Worker asks a model (apps/api/src/lib/lessonFix.js) and the editor shows
// the result before anything changes.
//
// This module is the part the Worker and the editor share:
//
//   - which codes a model may be asked to fix (AI_FIX_CODES),
//   - the section as the model sees it (fixContext), in the same input shape
//     the MCP server's tools speak, with text blocks as markup,
//   - turning the model's edits into replace_block operations for lessonPatch
//     (aiEditsToOperations), and making them (applyFixOperations), and
//   - deciding whether a fix is good enough to offer (checkFix): the finding
//     has to be gone, and the fix may not add a problem of its own or drop a
//     footnote.
//
// The Worker runs checkFix before it answers, and asks the model again once if
// the first try fails. The editor runs it again on the lesson as it is when the
// fix comes back, since the author may have changed it in the meantime.

import {
  type PatchOperation,
  type PatchOperationInput,
  applyPatch,
} from "./lessonPatch.ts";
import type { BlockInput } from "./lessonBuild.ts";
import {
  type ErrorFinding,
  type Finding,
  type LessonCheckResult,
  type WarningFinding,
  isFormattingFinding,
  newFindings,
  validateLesson,
} from "./lessonChecks.ts";
import { inlineTextMarkup } from "./inlineText.ts";
import { questionAnswerPlain } from "./questions.ts";
import {
  textBlockContent,
  textBlockFootnotes,
  textBlockMarkup,
  withTextBlockDocument,
} from "./lessonText.ts";
import type { Block, LessonDoc, Section } from "./types.ts";

/** The operation a fix is made of: every fix only replaces blocks. */
export type ReplaceBlockOperation = Extract<
  PatchOperation,
  { op: "replace_block" }
>;

// A replace_block operation as it arrives from a model, not checked yet.
type FixOperation = Extract<PatchOperationInput, { op: "replace_block" }>;

/**
 * The finding codes a model may be asked to fix. Each is about one section,
 * and its fix is a change to that section's text, questions or spelling words.
 * Lesson-wide shape (W_SECTION_COUNT), a section's question order
 * (W_QUESTION_SHAPE), sources and the codes with quick fixes are left out.
 */
export const AI_FIX_CODES = Object.freeze([
  "E_GROUNDING_SINGLE",
  "E_GROUNDING_MULTIPLE",
  "E_ORANGE_PARAPHRASED",
  "E_GROUNDING_NUMBER_FILL",
  "E_BACKGROUND_IN_TEXT",
  "E_ORANGE_ANSWER_IN_PROMPT",
  "E_ORANGE_NOT_A_LIST",
  "E_RETIRED_STEM",
  "E_ANSWER_REVEALED_CROSS",
  "E_SPELLING_LENGTH",
  "E_SPELLING_DUPLICATE",
  "E_SPELLING_COLLISION",
  "E_ANSWER_WORD_REUSED",
  "E_NUMBER_DUPLICATE",
  "W_ORANGE_MULTIWORD",
  "W_ORANGE_ANSWER_COUNT",
  "W_ORANGE_NO_BLANK",
  "W_WYR_SHAPE",
  "W_ANSWER_REVEALED_OPEN",
  "W_NUMBER_NO_STEPS",
  "W_SPELLING_IN_CAPS",
]);

const AI_FIXABLE: ReadonlySet<string> = new Set(AI_FIX_CODES);

/** Whether a model may be asked to fix a finding. */
export function hasAiFix(finding: {
  code: string;
  sectionId?: string | null;
}): boolean {
  return AI_FIXABLE.has(finding?.code) && Boolean(finding?.sectionId);
}

// The blocks a fix may change. Images and VAKT activities are left alone.
const EDITABLE: ReadonlySet<string> = new Set(["text", "question", "spelling"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

// The text of each item in a list of strings or `{ text }` items, trimmed,
// with the empty ones left out.
const texts = (items: unknown): string[] =>
  (Array.isArray(items) ? items : [])
    .map((item: unknown) => {
      const text =
        typeof item === "string" ? item : isRecord(item) ? item.text : "";
      return typeof text === "string" ? text.trim() : "";
    })
    .filter(Boolean);

/** What blockForModel makes: buildBlock's input shape, any answer a string. */
export interface ModelBlock extends BlockInput {
  answer?: string;
}

/**
 * A block as the model sees it: the input shape create_lesson takes, every
 * list as plain strings, text as markup (so footnotes and formatting survive
 * the round trip).
 */
export function blockForModel(block: Block): ModelBlock {
  switch (block?.type) {
    case "text":
      return { id: block.id, type: "text", text: textBlockMarkup(block) };
    case "spelling":
      return { id: block.id, type: "spelling", words: texts(block.words) };
    case "question": {
      const out: ModelBlock = {
        id: block.id,
        type: "question",
        questionType: block.questionType,
        prompt: inlineTextMarkup(block.prompt),
      };
      if (block.answer != null) out.answer = questionAnswerPlain(block.answer);
      if (Array.isArray(block.answers)) out.answers = texts(block.answers);
      if (Array.isArray(block.steps)) {
        out.steps = block.steps
          .map((step) => inlineTextMarkup(step?.text).trim())
          .filter(Boolean);
      }
      return out;
    }
    default:
      return { id: block?.id, type: block?.type };
  }
}

function findSection(
  doc: LessonDoc | null | undefined,
  sectionId: string | null | undefined,
): Section | null {
  return (doc?.sections || []).find((s) => s.id === sectionId) || null;
}

/** What fixContext gives a model to fix a finding with. */
export interface FixContext {
  sectionNumber: number;
  sectionName: string;
  blocks: Array<ModelBlock & { editable: boolean }>;
  usedElsewhere: string[];
}

/**
 * What a model needs to fix a finding: the finding's section, and the
 * spelling words and answers other sections already use (a fix may not reuse
 * one). Null when the section is gone.
 */
export function fixContext(
  doc: LessonDoc,
  finding: Pick<Finding, "sectionId"> | null | undefined,
): FixContext | null {
  const section = findSection(doc, finding?.sectionId);
  if (!section) return null;
  const usedElsewhere = new Set<string>();
  for (const other of doc.sections) {
    if (other === section) continue;
    for (const block of other.blocks || []) {
      // A loose orange question's answers, and a tight open's examples, are
      // suggestions, which the checks deliberately keep out of every
      // lesson-wide pool (see lessonChecks.ts). Forbidding them here would
      // steer the model away from words the checks would accept, sometimes
      // the only word that passes.
      const words =
        block?.type === "spelling"
          ? texts(block.words)
          : block?.type === "question" &&
              !SUGGESTION_TYPES.has(block.questionType)
            ? [
                ...texts([questionAnswerPlain(block.answer)]),
                ...texts(block.answers),
              ]
            : [];
      for (const word of words) usedElsewhere.add(word);
    }
  }
  return {
    sectionNumber: doc.sections.indexOf(section) + 1,
    sectionName: section.name || "",
    blocks: (section.blocks || []).map((block) => ({
      ...blockForModel(block),
      editable: EDITABLE.has(block?.type),
    })),
    usedElsewhere: [...usedElsewhere],
  };
}

// The types that hold a list in `answers`, and the subset whose list is
// suggestions rather than a key.
const LIST_ANSWER: ReadonlySet<unknown> = new Set([
  "multiple",
  "multiple_open",
  "tight_open",
]);
const SUGGESTION_TYPES: ReadonlySet<unknown> = new Set([
  "multiple_open",
  "tight_open",
]);
const SINGLE_ANSWER: ReadonlySet<unknown> = new Set([
  "single",
  "background",
  "number",
]);

function nonEmpty(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/**
 * One block a model's fix changes, named by its id. Every other field is
 * optional, and an empty one means "keep it".
 */
export interface AiEdit {
  blockId: string;
  text?: string;
  words?: string[];
  questionType?: string;
  prompt?: string;
  answer?: string;
  answers?: string[];
  steps?: string[];
}

/**
 * A model's edits as patch operations: one replace_block per block it changed,
 * each in the input shape, with whatever the edit left out kept as it was.
 * Every field of an edit is optional; an empty one means "keep it".
 *
 * Throws an Error saying what is wrong when an edit names a block outside the
 * finding's section, or one a fix may not touch, or when nothing changes.
 * @param edits The model's reply, unchecked: AiEdit is what it should be.
 */
export function aiEditsToOperations(
  doc: LessonDoc,
  finding: Pick<Finding, "sectionId"> | null | undefined,
  edits: unknown,
): ReplaceBlockOperation[] {
  const section = findSection(doc, finding?.sectionId);
  if (!section) throw new Error("That section is no longer in the lesson.");
  const seen = new Set<string>();
  const operations: ReplaceBlockOperation[] = [];
  const list: unknown[] = Array.isArray(edits) ? edits : [];
  for (const [i, raw] of list.entries()) {
    const edit: { [K in keyof AiEdit]?: unknown } = isRecord(raw) ? raw : {};
    const block = (section.blocks || []).find((b) => b.id === edit.blockId);
    if (!block) {
      throw new Error(
        `Edit ${i + 1} names block "${edit.blockId}", which isn't in this section.`,
      );
    }
    if (!EDITABLE.has(block.type)) {
      throw new Error(`Edit ${i + 1}: a ${block.type} block can't be changed.`);
    }
    if (seen.has(block.id)) {
      throw new Error(
        `Edit ${i + 1} changes block "${block.id}" a second time.`,
      );
    }
    seen.add(block.id);

    const current = blockForModel(block);
    delete current.id;
    const next: ModelBlock = { ...current };
    if (block.type === "text") {
      const text = nonEmpty(edit.text);
      if (text) next.text = text;
    } else if (block.type === "spelling") {
      const words = texts(edit.words);
      if (words.length) next.words = words;
    } else {
      const type = nonEmpty(edit.questionType);
      if (type) next.questionType = type;
      const prompt = nonEmpty(edit.prompt);
      if (prompt) next.prompt = prompt;
      const answer = nonEmpty(edit.answer == null ? "" : String(edit.answer));
      if (answer) next.answer = answer;
      const answers = texts(edit.answers);
      if (answers.length) next.answers = answers;
      const steps = texts(edit.steps);
      if (steps.length) next.steps = steps;
      // A change of type moves the answer between the one field and the list.
      if (
        LIST_ANSWER.has(next.questionType) &&
        !next.answers?.length &&
        next.answer
      ) {
        next.answers = [next.answer];
      }
      if (
        SINGLE_ANSWER.has(next.questionType) &&
        !next.answer &&
        next.answers?.length
      ) {
        next.answer = next.answers[0];
      }
    }
    if (JSON.stringify(next) === JSON.stringify(current)) continue;
    operations.push({ op: "replace_block", blockId: block.id, block: next });
  }
  if (!operations.length) throw new Error("The fix doesn't change anything.");
  return operations;
}

// A rebuilt list keeps the ids of the items whose text didn't change, so the
// editor's fields (and anyone else's cursor in them) stay put. A step's text
// can be a document (see inlineText.ts), so the two are compared as JSON.
function keepItemIds<T extends { id: string; text: unknown }>(
  before: ReadonlyArray<{ id: string; text: unknown }> | undefined,
  after: T[],
): T[] {
  if (!Array.isArray(before) || !Array.isArray(after)) return after;
  const unused = [...before];
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a ?? "") === JSON.stringify(b ?? "");
  return after.map((item) => {
    const at = unused.findIndex((old) => same(old?.text, item.text));
    if (at === -1) return item;
    const [old] = unused.splice(at, 1);
    return { ...item, id: old.id };
  });
}

// The lists of a block whose items carry ids, on whichever block has them.
type ItemLists = { type: string } & {
  [K in "answers" | "steps" | "words"]?: Array<{ id: string; text: unknown }>;
};

function settle(before: Block | undefined, after: Block): Block {
  if (after.type === "text") {
    return withTextBlockDocument(after, textBlockContent(after));
  }
  const out = { ...after };
  const lists: ItemLists = out;
  const was: ItemLists | undefined = before;
  for (const field of ["answers", "steps", "words"] as const) {
    if (lists[field]) lists[field] = keepItemIds(was?.[field], lists[field]);
  }
  return out;
}

function isReplaceBlock(op: unknown): op is FixOperation {
  return isRecord(op) && op.op === "replace_block";
}

// A fix's operations, checked to be replace_block operations alone. Their
// fields are left to applyPatch, which checks them as it makes them.
function fixOperations(operations: unknown): FixOperation[] {
  if (!Array.isArray(operations)) throw new Error("A fix needs operations.");
  const list: unknown[] = operations;
  return list.map((op) => {
    if (!isReplaceBlock(op)) {
      const name = isRecord(op) ? op.op : undefined;
      throw new Error(`A fix can only replace blocks, not "${name}".`);
    }
    return op;
  });
}

/**
 * The lesson with a fix's operations made. Sections and blocks the fix didn't
 * touch are the very objects they were, and a changed text block is stored
 * the way the editor stores one (withTextBlockDocument).
 *
 * Throws, naming the operation, when one can't be made. A fix only ever
 * replaces blocks, so any other kind of operation is refused.
 * @param operations Unchecked, as a model (or aiEditsToOperations) gives them.
 */
export function applyFixOperations(
  doc: LessonDoc,
  operations: unknown,
): LessonDoc {
  const ops = fixOperations(operations);
  const patched = applyPatch(doc, ops);
  const changed = new Set(ops.map((op) => op.blockId));
  const original = new Map<string, Block>();
  for (const section of doc.sections) {
    for (const block of section.blocks || []) original.set(block.id, block);
  }
  const sections = patched.sections.map((section, i) => {
    const before = doc.sections[i];
    if (!section.blocks.some((block) => changed.has(block.id))) return before;
    return {
      ...before,
      blocks: section.blocks.map((block) =>
        changed.has(block.id)
          ? settle(original.get(block.id), block)
          : // Only replaced blocks are new: every other one is a copy of one
            // of doc's own.
            original.get(block.id)!,
      ),
    };
  });
  return { ...doc, sections };
}

/** What checkFix decides about a fix. */
export interface FixCheck {
  ok: boolean;
  /** The lesson with the fix made, or null when it couldn't be made. */
  doc: LessonDoc | null;
  newErrors: ErrorFinding[];
  newWarnings: WarningFinding[];
  problems: string[];
}

/**
 * Whether a fix does its job: run the checks over the lesson before and after.
 *
 * `ok` means the finding is gone, the fix added no problem (error) of its own
 * and no text block lost a footnote. New suggestions (warnings) don't stop a
 * fix; they come back in `newWarnings` for the editor to mention. `problems` is
 * what went wrong in prose a model can act on, for the Worker's second try.
 * @param operations Unchecked, as for applyFixOperations.
 * @param options `before` is validateLesson(doc) where the caller already ran
 *   it, so one request doesn't validate the same unchanged lesson again per
 *   attempt.
 */
export function checkFix(
  doc: LessonDoc,
  operations: unknown,
  finding: Pick<Finding, "key" | "message">,
  { before }: { before?: LessonCheckResult } = {},
): FixCheck {
  let ops: FixOperation[];
  let fixed: LessonDoc;
  try {
    ops = fixOperations(operations);
    fixed = applyFixOperations(doc, ops);
  } catch (err) {
    return {
      ok: false,
      doc: null,
      newErrors: [],
      newWarnings: [],
      problems: [err instanceof Error ? err.message : String(err)],
    };
  }
  const prior = before ?? validateLesson(doc);
  const after = validateLesson(fixed);
  // A formatting finding's key is the formatted words themselves, so a fix
  // that rewords a passage re-keys a defect that predates it: the same too
  // much bold, now with different words inside. Such a finding is treated as
  // pre-existing when its code already fired in the same section. Formatting
  // only: for any other code, a changed key means the fix changed the very
  // thing the check is about (a new answer, say), and it must answer for it.
  const rekeyed = (f: Finding, priors: readonly Finding[]) =>
    isFormattingFinding(f) &&
    priors.some((p) => p.code === f.code && p.sectionId === f.sectionId);
  const newErrors = newFindings(prior.errors, after.errors).filter(
    (f) => !rekeyed(f, prior.errors),
  );
  const newWarnings = newFindings(prior.warnings, after.warnings).filter(
    (f) => !rekeyed(f, prior.warnings),
  );
  const resolved = ![...after.errors, ...after.warnings].some(
    (f) => f.key === finding.key,
  );

  const blocksOf = (lesson: LessonDoc) =>
    new Map<string | undefined, Block>(
      lesson.sections.flatMap((s) =>
        (s.blocks || []).map((b): [string, Block] => [b.id, b]),
      ),
    );
  const was = blocksOf(doc);
  const now = blocksOf(fixed);
  const lostFootnote = ops.some((op) => {
    const block = was.get(op.blockId);
    return (
      block?.type === "text" &&
      textBlockFootnotes(block).length >
        // A replaced block keeps its id (see applyPatch).
        textBlockFootnotes(now.get(op.blockId)!).length
    );
  });

  const problems = [
    ...(resolved ? [] : [`The problem is still there: ${finding.message}`]),
    ...newErrors.map((f) => `The fix causes a new problem: ${f.message}`),
    ...(lostFootnote
      ? [
          "The fix drops a footnote from the passage. Keep every ^[...] footnote exactly as it was.",
        ]
      : []),
  ];
  return {
    ok: problems.length === 0,
    doc: fixed,
    newErrors,
    newWarnings,
    problems,
  };
}
