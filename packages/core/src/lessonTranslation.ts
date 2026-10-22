// What on-device translation covers in a lesson document, and the keys the
// read-only renderer looks translated text up by.
//
// A lesson translates with the same two engines as a comment (see
// browser/translator.js): plain strings in, plain strings out. What differs is
// what a lesson is for. A comment is all prose, but part of a lesson's content
// is the language being taught, and translating that part would change the
// lesson instead of making it readable. The line sits exactly there, and
// nowhere wider: the reading page exists for comprehension, and nothing
// downstream consumes what it shows (interactive mode and the DOCX/PDF
// exports both read the original document), so everything a reader reads
// translates:
//
// - the document title
// - text blocks, one segment per paragraph (the renderer and the docx export
//   both draw each paragraph on its own). A segment is the paragraph's plain
//   words: bold and italics don't survive a model, so a translated paragraph
//   renders unformatted, with its footnote markers kept at its end
// - footnote notes, one segment each
// - question prompts, their printed answers and their numbered steps, with
//   each accepted answer as its own segment (questionAnswerItems), so the
//   non-breaking gaps that separate several accepted answers survive the
//   round trip through a model that would fold them into ordinary spaces. A
//   prompt or a step is its plain words, like a paragraph: a translated one
//   renders unformatted, with a formula as its source
// - image captions
// - VAKT activity text
//
// And deliberately not:
//
// - spelling words: they ARE the material. The lesson is "spell these
//   words", and a translated word list would be a different lesson
// - image credits: a photographer's name and a license, for the same reason
//   as source citations below
// - VAKT link labels: names of external resources, which stay in whatever
//   language the resource itself is in
// - source citations: an author, a title and a publisher are names, and a
//   translated title would point the reader at a book that doesn't exist
//
// Everything here is pure string work on the document model, shared by the
// web app's renderer (LessonView) and its translation runner
// (LessonTranslation), so the two agree on keys by construction.

import { imageCaptionParts } from "./imageCredit.ts";
import { inlineTextPlain } from "./inlineText.ts";
import { textBlockFootnotes, textBlockLines } from "./lessonText.ts";
import { questionAnswerItems } from "./questions.ts";
import { headingText } from "./heading.ts";
import { vaktText } from "./vakt.ts";
import type { Block } from "./types.ts";

// Each block type with every field optional but its type.
type PartialBlock<B extends Block> = B extends Block
  ? Partial<B> & Pick<B, "type">
  : never;

/** A block as the lesson readers here take it: any field but its type may be missing. */
export type LessonBodyBlock = PartialBlock<Block>;

/**
 * A lesson body as the translation and find readers take it: hand-written,
 * older or mid-edit, so a section or a block may be missing any field but a
 * block's type.
 */
export interface LessonBody {
  title?: string;
  sections?: Array<{ id?: string; name?: string; blocks?: LessonBodyBlock[] }>;
}

/** One translatable piece of a lesson, under its lessonSegmentKey key. */
export interface TranslationSegment {
  key: string;
  text: string;
}

/**
 * Stable lookup keys for a lesson's translatable segments. Index-based, so a
 * translated string only means anything while the document still says what it
 * said when it was translated; sameTranslationSource is what holds the
 * renderer to that.
 */
export const lessonSegmentKey = {
  title: () => "title",
  textLine: (si: number, bi: number, li: number) => `s${si}.b${bi}.line${li}`,
  note: (si: number, bi: number, i: number) => `s${si}.b${bi}.note${i}`,
  prompt: (si: number, bi: number) => `s${si}.b${bi}.prompt`,
  answer: (si: number, bi: number, i: number) => `s${si}.b${bi}.answer${i}`,
  step: (si: number, bi: number, i: number) => `s${si}.b${bi}.step${i}`,
  caption: (si: number, bi: number) => `s${si}.b${bi}.caption`,
  vakt: (si: number, bi: number) => `s${si}.b${bi}.vakt`,
  heading: (si: number, bi: number) => `s${si}.b${bi}.heading`,
};

/**
 * A question's steps as the lesson shows them: only the ones with text, in
 * order. The renderer numbers these and translation keys them by index, so
 * both must filter identically; this is the one place that filter lives.
 * @param block  A question block.
 */
export function questionStepsWithText<Step extends { text?: unknown }>(
  block: { steps?: readonly Step[] } | null | undefined,
): Step[] {
  return (block?.steps || []).filter((s) => inlineTextPlain(s?.text).trim());
}

/**
 * The lesson's translatable segments, batched for incremental translation:
 * the title first on its own, then one batch per section that has any text.
 *
 * A finished lesson is long, and the slowest engine (NLLB in the page) can
 * take a while on one, so the runner translates a batch at a time and shows
 * each section as it lands rather than holding the whole lesson back for the
 * last one. Batches arrive in reading order, which means the reader can start
 * at the top while the rest catches up.
 *
 * @param doc  The lesson body: { title, sections: [{ blocks }] }.
 * @returns Batches of segments; every segment's text is non-blank.
 */
export function lessonTranslationBatches(
  doc: LessonBody | null | undefined,
): TranslationSegment[][] {
  const batches: TranslationSegment[][] = [];
  const title = doc?.title || "";
  if (title.trim()) {
    batches.push([{ key: lessonSegmentKey.title(), text: title }]);
  }
  (doc?.sections || []).forEach((section, si) => {
    const segments: TranslationSegment[] = [];
    (section.blocks || []).forEach((block, bi) => {
      if (block.type === "text") {
        textBlockLines(block).forEach((line, li) => {
          if (line.trim()) {
            segments.push({
              key: lessonSegmentKey.textLine(si, bi, li),
              text: line,
            });
          }
        });
        textBlockFootnotes(block).forEach((footnote, i) => {
          if (footnote.note) {
            segments.push({
              key: lessonSegmentKey.note(si, bi, i),
              text: footnote.note,
            });
          }
        });
      } else if (block.type === "question") {
        const prompt = inlineTextPlain(block.prompt);
        if (prompt.trim()) {
          segments.push({ key: lessonSegmentKey.prompt(si, bi), text: prompt });
        }
        questionAnswerItems(block).forEach((answer, i) => {
          segments.push({
            key: lessonSegmentKey.answer(si, bi, i),
            text: answer,
          });
        });
        questionStepsWithText(block).forEach((step, i) => {
          segments.push({
            key: lessonSegmentKey.step(si, bi, i),
            text: inlineTextPlain(step.text),
          });
        });
      } else if (block.type === "image") {
        // Mirrors the renderer: an image block without a source draws nothing,
        // caption included, so there is nothing to translate for one. Only the
        // author's caption: the credit line is names and a license.
        const { caption } = imageCaptionParts(block);
        if ((block.image || block.src) && caption) {
          segments.push({
            key: lessonSegmentKey.caption(si, bi),
            text: caption,
          });
        }
      } else if (block.type === "vakt") {
        const text = vaktText(block);
        if (text) {
          segments.push({ key: lessonSegmentKey.vakt(si, bi), text });
        }
      } else if (block.type === "heading") {
        const text = headingText(block);
        if (text) {
          segments.push({ key: lessonSegmentKey.heading(si, bi), text });
        }
      }
    });
    if (segments.length) batches.push(segments);
  });
  return batches;
}

/**
 * Do two batch lists describe the same text, segment for segment?
 *
 * Translated strings are keyed by position, so one must never outlive the text
 * it was made from. Object identity can't decide that on its own: the lesson
 * page re-fetches a server-rendered lesson quietly once a signed-in reader's
 * token resolves, which hands the renderer a brand-new document object holding
 * the same lesson. Comparing the segments keeps a reader's translation through
 * that swap, and drops one that would otherwise be laid over text it doesn't
 * describe.
 *
 * @param a  From lessonTranslationBatches().
 */
export function sameTranslationSource(
  a: ReadonlyArray<readonly TranslationSegment[]> | null | undefined,
  b: ReadonlyArray<readonly TranslationSegment[]> | null | undefined,
): boolean {
  if (a === b) return true;
  const left = (a || []).flat();
  const right = (b || []).flat();
  if (left.length !== right.length) return false;
  return left.every(
    (segment, i) =>
      segment.key === right[i].key && segment.text === right[i].text,
  );
}

/**
 * Enough of the lesson's own prose, from the top, for language detection.
 * Detection doesn't need 37 screens of text, and on the fallback path every
 * character fed to the detector model costs time, so this stops once it has
 * a solid sample.
 *
 * @param batches  From lessonTranslationBatches().
 */
export function lessonLanguageSample(
  batches: ReadonlyArray<readonly TranslationSegment[]>,
  { maxChars = 500 }: { maxChars?: number } = {},
): string {
  const parts: string[] = [];
  let length = 0;
  for (const batch of batches) {
    for (const segment of batch) {
      parts.push(segment.text);
      length += segment.text.length + 1;
      if (length >= maxChars) return parts.join("\n");
    }
  }
  return parts.join("\n");
}
