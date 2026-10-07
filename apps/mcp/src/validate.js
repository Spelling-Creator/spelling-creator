// The MCP server's side of lesson validation.
//
// The checks themselves live in @spelling-creator/core/lessonChecks, because the
// web editor runs the same ones as the author types, and two copies would
// disagree the first time a rule changed. What is left here is what only a
// write path needs: the checks that read a tool's raw input before buildDoc
// drops fields from it, the prose a rejected write returns, and the
// before-and-after filter patch_lesson holds the caller to.
//
// Errors reject the write; warnings ride along with a successful one.
// `skipValidation: true` on the writing tools turns the errors off for the rare
// case where the user genuinely wants something the standard forbids.

/** @typedef {import("@spelling-creator/core/lessonChecks").Finding} Finding */

export {
  FORMAT_MAX_EMPHASIS_WORDS,
  FORMAT_MAX_ITALIC_WORDS,
  FORMAT_MAX_SHARE,
  FORMAT_MAX_SPANS,
  SECTION_COUNT,
  SPELLING_MAX_LETTERS,
  SPELLING_MIN_LETTERS,
  SPELLING_WORDS_PER_SECTION,
  isFormattingFinding,
  newFindings,
  normalizeText,
  validateLesson,
} from "@spelling-creator/core/lessonChecks";

// The types that store no answer at all. `paraphrase` and `wyr` are
// mechanically `open` questions (the speller writes on their own paper either
// way), so they are held to the same rule: buildBlock drops a stray answer from
// all three, and being told about it is the only thing that stops the model
// believing the lesson holds an answer it does not.
const ANSWERLESS_TYPES = new Set(["open", "paraphrase", "wyr"]);

// How validateInput names each answerless type in its rejection, colour and
// all, so the model can find the question in a rendered lesson too.
const ANSWERLESS_KIND = {
  open: "open (pink) question",
  paraphrase: "paraphrase (brown) question",
  wyr: "W.Y.R. (grape) question",
};

/**
 * Checks that can only be made against the caller's raw input, because buildBlock
 * drops the offending fields on the way into the doc — an `open` question that
 * arrives carrying an answer would otherwise be silently stripped, leaving the
 * model believing the lesson holds an answer it does not.
 *
 * @param {Array<{ block: any, where: string, section: number|null }>} entries
 * @returns {Finding[]}
 */
export function validateInput(entries) {
  const findings = [];
  for (const { block, where, section } of entries) {
    if (block?.type !== "question") continue;
    if (!ANSWERLESS_TYPES.has(block.questionType)) continue;
    const stray = ["answer", "answers", "exampleAnswer"].filter(
      (field) => block[field] != null && block[field] !== "",
    );
    if (!stray.length) continue;
    const kind = ANSWERLESS_KIND[block.questionType];
    findings.push({
      level: "error",
      code: "E_OPEN_HAS_ANSWER",
      key: `E_OPEN_HAS_ANSWER:${where}`,
      section: section ?? null,
      sectionId: null,
      blockId: null,
      params: { fields: stray, questionType: block.questionType },
      message:
        `${where}: this ${kind} carries ${stray.map((f) => `\`${f}\``).join(", ")}. ` +
        "Questions of this type have no answer of any kind, just " +
        "the `prompt`. Remove the field, or change the question type to one that does take an answer.",
    });
  }
  return findings;
}

/**
 * Flatten lesson input into the entries validateInput wants.
 * @param {Array<{ blocks?: any[] }>} sections
 */
export function inputBlocksFromSections(sections) {
  return (Array.isArray(sections) ? sections : []).flatMap((section, i) =>
    (Array.isArray(section?.blocks) ? section.blocks : []).map((block, j) => ({
      block,
      where: `Section ${i + 1}, block ${j + 1}`,
      section: i + 1,
    })),
  );
}

/**
 * The same, for the blocks carried by patch operations.
 * @param {any[]} operations
 */
export function inputBlocksFromOperations(operations) {
  return (Array.isArray(operations) ? operations : []).flatMap((op, i) => {
    const where = `Operation ${i + 1} (${op?.op || "?"})`;
    const blocks = [];
    if (op?.block) blocks.push({ block: op.block, where, section: null });
    if (Array.isArray(op?.blocks)) {
      op.blocks.forEach((block, j) =>
        blocks.push({
          block,
          where: `${where}, block ${j + 1}`,
          section: null,
        }),
      );
    }
    return blocks;
  });
}

/**
 * Render findings as the numbered list a tool result carries back. Capped, because
 * a badly-shaped lesson can produce hundreds and the first handful are the ones
 * worth reading.
 * @param {Finding[]} findings
 * @param {number} [limit]
 */
export function formatFindings(findings, limit = 25) {
  const shown = findings.slice(0, limit);
  const lines = shown.map((f, i) => `${i + 1}. [${f.code}] ${f.message}`);
  if (findings.length > shown.length) {
    lines.push(
      `…and ${findings.length - shown.length} more of the same kind. Fix these first and resubmit to see the rest.`,
    );
  }
  return lines.join("\n");
}

/**
 * The message a rejected write returns. Names the count, lists the defects, and
 * points at the escape hatch, so the model can correct and resubmit without
 * having read the standard.
 * @param {Finding[]} errors
 */
export function validationErrorMessage(errors) {
  return (
    `This lesson does not meet the authoring standard, so nothing was saved. ` +
    `${errors.length} problem${errors.length === 1 ? "" : "s"} to fix:\n\n` +
    `${formatFindings(errors)}\n\n` +
    "Correct these and call the tool again. If the user genuinely wants a lesson the standard forbids, " +
    'pass "skipValidation": true to save it as-is.'
  );
}
