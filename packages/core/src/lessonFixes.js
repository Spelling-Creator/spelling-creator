// Quick fixes for lesson check findings: the ones a script can make on its own,
// with no judgement and no model call.
//
// A finding from lessonChecks.js says what is wrong and where. For a few codes
// the fix follows from that alone: bold is removed by removing the bold, a VAKT
// activity in the middle of a section is moved to its end. Those are here. A
// green answer that isn't in its passage is not one of them, since only
// someone who understands the passage can say whether the answer or the
// passage should change.
//
// Each fix takes the document and the finding, and returns a new document, or
// null when there is nothing left to do (the finding is stale, or the lesson
// has changed under it). Only the section and blocks a fix touches are new
// objects, so the editor's memoised cards for everything else stay as they are.
//
// Text blocks are written with withTextBlockDocument, the way the editor writes
// them (see lessonText.js for why a touched block always stores `content`).

import { isCapsSpan } from "./lessonChecks.js";
import {
  TEXT_MARKS,
  textBlockContent,
  withTextBlockDocument,
} from "./lessonText.js";
import { newId } from "./id.js";

const ORANGE_TIGHT = "multiple";
const ORANGE_LOOSE = "multiple_open";

// ---- helpers ----------------------------------------------------------------

/** The doc with one section replaced by `fn(section)`, or null if fn returns null. */
function updateSection(doc, sectionId, fn) {
  const index = (doc?.sections || []).findIndex((s) => s.id === sectionId);
  if (index === -1) return null;
  const next = fn(doc.sections[index]);
  if (!next) return null;
  const sections = [...doc.sections];
  sections[index] = next;
  return { ...doc, sections };
}

/** The doc with one block replaced by `fn(block)`, or null if fn returns null. */
function updateBlock(doc, blockId, fn) {
  const section = (doc?.sections || []).find((s) =>
    (s.blocks || []).some((b) => b.id === blockId),
  );
  if (!section) return null;
  return updateSection(doc, section.id, (s) => {
    const index = s.blocks.findIndex((b) => b.id === blockId);
    const next = fn(s.blocks[index]);
    if (!next) return null;
    const blocks = [...s.blocks];
    blocks[index] = next;
    return { ...s, blocks };
  });
}

// A content document with `marks` taken off the formatted spans `pick` chooses.
// A span is grouped the way textBlockFormattedSpans groups one (a run of
// formatted text with nothing plain inside it), so a fix lines up exactly with
// the finding it answers.
function withoutMarks(content, marks, pick) {
  let changed = false;
  const paragraphs = content.content.map((paragraph) => {
    if (!paragraph.content) return paragraph;
    const nodes = paragraph.content.map((node) => ({ ...node }));
    let group = [];
    const finish = () => {
      const text = group
        .map((node) => node.text)
        .join("")
        .trim();
      const present = TEXT_MARKS.filter((mark) =>
        group.some((node) => node.marks.some((m) => m.type === mark)),
      );
      if (text && pick({ text, marks: present })) {
        for (const node of group) {
          const kept = node.marks.filter((m) => !marks.includes(m.type));
          if (kept.length !== node.marks.length) changed = true;
          node.marks = kept;
        }
      }
      group = [];
    };
    for (const node of nodes) {
      if (node.type !== "text") continue;
      if (!node.marks?.length) {
        finish();
        continue;
      }
      group.push(node);
    }
    finish();
    return { ...paragraph, content: nodes };
  });
  return changed ? { ...content, content: paragraphs } : null;
}

// Take formatting off the text blocks of the finding's section.
function stripFormatting(marks, pick = () => true) {
  return (doc, finding) =>
    updateSection(doc, finding.sectionId, (section) => {
      let changed = false;
      const blocks = section.blocks.map((block) => {
        if (block?.type !== "text") return block;
        const content = withoutMarks(textBlockContent(block), marks, pick);
        if (!content) return block;
        changed = true;
        return withTextBlockDocument(block, content);
      });
      return changed ? { ...section, blocks } : null;
    });
}

// ---- the fixes ----------------------------------------------------------------

const FIXES = {
  W_FORMAT_BOLD: stripFormatting(["bold"]),
  W_FORMAT_UNDERLINE: stripFormatting(["underline"]),
  W_FORMAT_CAPS: stripFormatting(TEXT_MARKS, ({ text }) => isCapsSpan(text)),
  E_FORMAT_HEAVY: stripFormatting(TEXT_MARKS),
  // "Make it plain" means plain: every mark comes off the quoted span. A long
  // bold span can carry italics inside it, and taking only the bold off would
  // leave a long italic run, which is a new finding, not a fix.
  E_FORMAT_LONG_EMPHASIS: (doc, finding) =>
    stripFormatting(TEXT_MARKS, ({ text }) => text === finding.params?.text)(
      doc,
      finding,
    ),
  E_FORMAT_LONG_ITALIC: (doc, finding) =>
    stripFormatting(TEXT_MARKS, ({ text }) => text === finding.params?.text)(
      doc,
      finding,
    ),

  // Every VAKT activity in the section goes to its end, in the order they were in.
  W_VAKT_NOT_LAST: (doc, finding) =>
    updateSection(doc, finding.sectionId, (section) => {
      const isVakt = (b) => b?.type === "vakt";
      const blocks = [
        ...section.blocks.filter((b) => !isVakt(b)),
        ...section.blocks.filter(isVakt),
      ];
      return blocks.some((b, i) => b !== section.blocks[i])
        ? { ...section, blocks }
        : null;
    }),

  // The orange questions keep their places in the section, and the tight ones
  // take the first of those places.
  W_ORANGE_ORDER: (doc, finding) =>
    updateSection(doc, finding.sectionId, (section) => {
      const isOrange = (b) =>
        b?.type === "question" &&
        (b.questionType === ORANGE_TIGHT || b.questionType === ORANGE_LOOSE);
      const orange = section.blocks.filter(isOrange);
      const sorted = [
        ...orange.filter((b) => b.questionType === ORANGE_TIGHT),
        ...orange.filter((b) => b.questionType === ORANGE_LOOSE),
      ];
      if (sorted.every((b, i) => b === orange[i])) return null;
      let next = 0;
      const blocks = section.blocks.map((b) =>
        isOrange(b) ? sorted[next++] : b,
      );
      return { ...section, blocks };
    }),

  // The list in the passage goes on past the accepted answers, so the item it
  // goes on to is accepted too: its noun, "silt" for "fine silt".
  E_ORANGE_PARTIAL_LIST: (doc, finding) =>
    updateBlock(doc, finding.blockId, (block) => {
      const item = String(finding.params?.answer || "").trim();
      if (!item || !Array.isArray(block?.answers)) return null;
      const already = block.answers.some(
        (a) =>
          ((typeof a === "string" ? a : a?.text) || "").trim().toLowerCase() ===
          item.toLowerCase(),
      );
      if (already) return null;
      return {
        ...block,
        answers: [...block.answers, { id: newId(), text: item }],
      };
    }),
};

/** The finding codes that have a quick fix. */
export const QUICK_FIX_CODES = Object.freeze(Object.keys(FIXES));

/**
 * Whether a finding can be fixed here, without a model.
 * @param {{ code: string }} finding
 */
export function hasQuickFix(finding) {
  return Object.hasOwn(FIXES, finding?.code);
}

/**
 * The lesson with a finding's quick fix made, or null when there is none to
 * make (no quick fix for that code, or the finding no longer applies).
 * @param {object} doc
 * @param {import("./lessonChecks.js").Finding} finding
 * @returns {object|null}
 */
export function applyQuickFix(doc, finding) {
  if (!hasQuickFix(finding)) return null;
  return FIXES[finding.code](doc, finding);
}
