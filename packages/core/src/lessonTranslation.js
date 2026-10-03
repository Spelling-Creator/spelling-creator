// What on-device translation covers in a lesson document, and the keys the
// read-only renderer looks translated text up by.
//
// A lesson translates with the same two engines as a comment (see
// browser/translator.js): plain strings in, plain strings out. What differs is
// what a lesson is for. A comment is all prose, but part of a lesson's content
// is the language being taught: the spelling words are the material, and a
// question's accepted answer is what the speller spells out. Translating
// either would change the lesson instead of making it readable. So the
// segments here are what a reader reads around the teaching material:
//
// - the document title
// - text blocks, one segment per line (the renderer and the docx export both
//   treat each line as its own paragraph)
// - question prompts and their numbered steps
// - VAKT activity text
//
// And deliberately not:
//
// - spelling words: they are the content being spelled
// - question answers: interactive mode scores what the speller types against
//   them, and the printed answer is the word to spell
// - image captions: mostly attribution boilerplate ("Image by ... via
//   Wikimedia Commons"), noise once translated (the same call
//   lessonPlainText makes for the SEO description)
// - VAKT link labels: names of external resources, which stay in whatever
//   language the resource itself is in
//
// Everything here is pure string work on the document model, shared by the
// web app's renderer (LessonView) and its translation runner
// (LessonTranslation), so the two agree on keys by construction.

import { vaktText } from "./vakt.js";

/**
 * Stable lookup keys for a lesson's translatable segments. Index-based, which
 * is safe because translation only ever runs against a published document
 * that cannot change under it; a re-render always sees the same doc the
 * segments were built from.
 */
export const lessonSegmentKey = {
  title: () => "title",
  textLine: (si, bi, li) => `s${si}.b${bi}.line${li}`,
  prompt: (si, bi) => `s${si}.b${bi}.prompt`,
  step: (si, bi, i) => `s${si}.b${bi}.step${i}`,
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
        (block.text || "").split("\n").forEach((line, li) => {
          if (line.trim()) {
            segments.push({
              key: lessonSegmentKey.textLine(si, bi, li),
              text: line,
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
        questionStepsWithText(block).forEach((step, i) => {
          segments.push({
            key: lessonSegmentKey.step(si, bi, i),
            text: step.text,
          });
        });
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
