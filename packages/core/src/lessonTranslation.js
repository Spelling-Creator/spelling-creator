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
//   round trip through a model that would fold them into ordinary spaces
// - image captions
// - VAKT activity text
//
// And deliberately not:
//
// - spelling words: they ARE the material. The lesson is "spell these
//   words", and a translated word list would be a different lesson
// - image credits: a photographer's name and a licence, for the same reason
//   as source citations below
// - VAKT link labels: names of external resources, which stay in whatever
//   language the resource itself is in
// - source citations: an author, a title and a publisher are names, and a
//   translated title would point the reader at a book that doesn't exist
//
// Everything here is pure string work on the document model, shared by the
// web app's renderer (LessonView) and its translation runner
// (LessonTranslation), so the two agree on keys by construction.

import { imageCaptionParts } from "./imageCredit.js";
import { textBlockFootnotes, textBlockLines } from "./lessonText.js";
import { questionAnswerItems } from "./questions.js";
import { vaktText } from "./vakt.js";

/**
 * Stable lookup keys for a lesson's translatable segments. Index-based, so a
 * translated string only means anything while the document still says what it
 * said when it was translated; sameTranslationSource is what holds the
 * renderer to that.
 */
export const lessonSegmentKey = {
  title: () => "title",
  textLine: (si, bi, li) => `s${si}.b${bi}.line${li}`,
  note: (si, bi, i) => `s${si}.b${bi}.note${i}`,
  prompt: (si, bi) => `s${si}.b${bi}.prompt`,
  answer: (si, bi, i) => `s${si}.b${bi}.answer${i}`,
  step: (si, bi, i) => `s${si}.b${bi}.step${i}`,
  caption: (si, bi) => `s${si}.b${bi}.caption`,
  vakt: (si, bi) => `s${si}.b${bi}.vakt`,
};

/**
 * A question's steps as the lesson shows them: only the ones with text, in
 * order. The renderer numbers these and translation keys them by index, so
 * both must filter identically; this is the one place that filter lives.
 * @param {object} block  A question block.
 * @returns {object[]}
 */
export function questionStepsWithText(block) {
  return (block?.steps || []).filter((s) => (s.text || "").trim());
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
 * @param {object} doc  The lesson body: { title, sections: [{ blocks }] }.
 * @returns {{key: string, text: string}[][]} Batches of segments; every
 *   segment's text is non-blank.
 */
export function lessonTranslationBatches(doc) {
  const batches = [];
  if ((doc?.title || "").trim()) {
    batches.push([{ key: lessonSegmentKey.title(), text: doc.title }]);
  }
  (doc?.sections || []).forEach((section, si) => {
    const segments = [];
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
        if ((block.prompt || "").trim()) {
          segments.push({
            key: lessonSegmentKey.prompt(si, bi),
            text: block.prompt,
          });
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
            text: step.text,
          });
        });
      } else if (block.type === "image") {
        // Mirrors the renderer: an image block without a source draws nothing,
        // caption included, so there is nothing to translate for one. Only the
        // author's caption: the credit line is names and a licence.
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
 * @param {{key: string, text: string}[][]} a  From lessonTranslationBatches().
 * @param {{key: string, text: string}[][]} b
 * @returns {boolean}
 */
export function sameTranslationSource(a, b) {
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
 * @param {{text: string}[][]} batches  From lessonTranslationBatches().
 * @param {object} [options]
 * @param {number} [options.maxChars]
 * @returns {string}
 */
export function lessonLanguageSample(batches, { maxChars = 500 } = {}) {
  const parts = [];
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
