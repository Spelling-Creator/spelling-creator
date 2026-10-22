// Find in lesson: the search box the editor and the lesson page put over one
// lesson, as distinct from the hub's search over many (lessonSearch.ts).
//
// A finished lesson is about a thousand words of prose and ninety short
// questions, and whoever is searching it usually knows the word they want:
// the paragraph that mentions ash, the question that asks about Pompeii, the
// spelling list with "crater" in it. So this is a plain lexical find, not a
// model. It matches the way a browser's find-in-page does (any part of a
// word, case and accents ignored), with two things find-in-page can't do:
// every term of the query has to be somewhere in the same block, and the hit
// is named ("Section 3, Q7") rather than just scrolled to, so a folded section
// or a long document doesn't hide where it is.
//
// Everything that reads words out of a lesson goes through the text helpers
// (textBlockLines, inlineTextPlain), so a formatted passage, a formula or a
// read-aloud hint matches by what shows on the page. And when the page shows
// a translation, the entries are built from the translated segments (keyed
// the way LessonView keys them, lessonSegmentKey), so a reader finds the
// words they can see.

import { headingText } from "./heading.ts";
import { imageCaptionParts } from "./imageCredit.ts";
import { inlineTextPlain } from "./inlineText.ts";
import { textBlockLines } from "./lessonText.ts";
import {
  lessonSegmentKey,
  questionStepsWithText,
} from "./lessonTranslation.ts";
import { questionAnswerItems } from "./questions.ts";
import { vaktLinks, vaktText } from "./vakt.ts";

/** How much of an entry a result shows around its first match. */
const SNIPPET_BEFORE = 40;
const SNIPPET_LENGTH = 150;

// Words one line apart read as one text to a search, and a snippet is one
// line, so every field is folded to single spaces before it is indexed.
function words(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

// Text with case and accents folded away for matching, with `map` giving,
// for each UTF-16 code unit of the folded text, the code-unit index in the
// original of the character it came from. Folding can change a character's
// length (an accented letter loses its mark, an astral character is two
// units either way, a precomposed Hangul syllable decomposes into its jamo),
// so matches found in the folded text are mapped back through it.
function fold(text) {
  let folded = "";
  const map = [];
  let at = 0;
  for (const char of text) {
    const chars = char.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    folded += chars;
    for (let i = 0; i < chars.length; i++) map.push(at);
    at += char.length;
  }
  return { text: folded, map };
}

/**
 * Every searchable place in a lesson, in reading order: each section's name
 * and each block's words. `number` counts text blocks and questions within
 * their section, from 1, the way the editor labels them (Q7); it is null for
 * the rest. `blockId` is null for a section's name. Each entry also carries
 * its text folded for matching (`folded`), so a query is matched against
 * entries built once rather than refolding the lesson per keystroke.
 *
 * With a `translation` (a Map from lessonSegmentKey keys to translated
 * strings, as LessonView takes), every segment it covers is indexed in
 * translation and the rest as written, which is exactly what the page shows.
 * @param {object} doc  The lesson body: { sections: [{ id, name, blocks }] }.
 * @param {Map<string, string>|null} [translation]
 * @returns {Array<{ kind: "section"|"heading"|"text"|"spelling"|"question"|"image"|"vakt",
 *   sectionId: string, sectionIndex: number, sectionName: string,
 *   blockId: string|null, number: number|null, text: string,
 *   folded: { text: string, map: number[] } }>}
 */
export function lessonFindEntries(doc, translation = null) {
  const translated = (key, original) => translation?.get(key) ?? original;
  const entries = [];
  (doc?.sections || []).forEach((section, si) => {
    const base = {
      sectionId: section?.id ?? "",
      sectionIndex: si,
      sectionName: words(section?.name),
    };
    const push = (kind, blockId, number, text) => {
      const joined = words(text);
      if (!joined) return;
      entries.push({
        kind,
        ...base,
        blockId,
        number,
        text: joined,
        folded: fold(joined),
      });
    };
    push("section", null, null, section?.name);
    let paragraphs = 0;
    let questions = 0;
    (section?.blocks || []).forEach((block, bi) => {
      if (!block?.id) return;
      switch (block.type) {
        case "text":
          push(
            "text",
            block.id,
            ++paragraphs,
            textBlockLines(block)
              .map((line, li) =>
                translated(lessonSegmentKey.textLine(si, bi, li), line),
              )
              .join(" "),
          );
          break;
        case "heading":
          push(
            "heading",
            block.id,
            null,
            translated(lessonSegmentKey.heading(si, bi), headingText(block)),
          );
          break;
        case "spelling":
          // Spelling words are the material being spelled and never
          // translate (see lessonTranslation.js).
          push(
            "spelling",
            block.id,
            null,
            (block.words || []).map((word) => words(word?.text)).join(" "),
          );
          break;
        case "question":
          push(
            "question",
            block.id,
            ++questions,
            [
              translated(
                lessonSegmentKey.prompt(si, bi),
                inlineTextPlain(block.prompt),
              ),
              ...questionAnswerItems(block).map((item, i) =>
                translated(lessonSegmentKey.answer(si, bi, i), item),
              ),
              ...questionStepsWithText(block).map((step, i) =>
                translated(
                  lessonSegmentKey.step(si, bi, i),
                  inlineTextPlain(step.text),
                ),
              ),
            ].join(" "),
          );
          break;
        case "image":
          // The caption, not the credit: a search for "Wikimedia" has no
          // business landing on every picture in the lesson.
          push(
            "image",
            block.id,
            null,
            translated(
              lessonSegmentKey.caption(si, bi),
              imageCaptionParts(block).caption,
            ),
          );
          break;
        case "vakt":
          // The activity translates; link labels name outside resources and
          // stay as written, as they do on the page.
          push(
            "vakt",
            block.id,
            null,
            [
              translated(lessonSegmentKey.vakt(si, bi), vaktText(block)),
              ...vaktLinks(block).map((link) => link.label),
            ].join(" "),
          );
          break;
        default:
          break;
      }
    });
  });
  return entries;
}

/**
 * The words of a query, as typed. Whitespace separates terms; there is no
 * other syntax, so a quote or an asterisk is just a character to find.
 * @param {string} query
 * @returns {string[]}
 */
export function findTerms(query) {
  return words(query).split(" ").filter(Boolean);
}

// The terms as they are matched: folded, with any that fold to nothing (a
// lone accent) left out.
function foldTerms(terms) {
  return terms.map((term) => fold(term).text).filter(Boolean);
}

// [start, end) in the original text for a match covering folded indexes
// [from, to).
function originalRange({ map }, textLength, from, to) {
  const start = map[from];
  let next = to;
  // A match may end inside a character that folded to several code units
  // (a Hangul syllable folds to its two or three jamo); the range runs to
  // the end of that character.
  while (next < map.length && map[next] === map[to - 1]) next += 1;
  const end = next < map.length ? map[next] : textLength;
  return [start, end];
}

// Where every folded term occurs in a folded text, as [start, end) ranges in
// the original text's code units, sorted and merged, or null when any term is
// missing or there are no terms.
function rangesIn(folded, textLength, needles) {
  if (!needles.length) return null;
  const ranges = [];
  for (const needle of needles) {
    let from = folded.text.indexOf(needle);
    if (from === -1) return null;
    while (from !== -1) {
      ranges.push(
        originalRange(folded, textLength, from, from + needle.length),
      );
      from = folded.text.indexOf(needle, from + 1);
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

/**
 * Where every term occurs in a text, as [start, end) ranges in the text's own
 * code units, sorted and merged, or null when any term is missing. Terms are
 * matched by their folded form (see fold), anywhere in a word. A query of
 * nothing but accents folds to nothing, and nothing is not a match.
 * @param {string} text
 * @param {string[]} terms  From findTerms(); their folding is done here.
 * @returns {Array<[number, number]>|null}
 */
export function findRanges(text, terms) {
  return rangesIn(fold(text), text.length, foldTerms(terms));
}

// The part of an entry a result shows: a window around the first match,
// started and ended at a word where it can be, as runs with the matches
// marked. `clippedStart` and `clippedEnd` say whether words were left out
// on either side, for an ellipsis.
function snippet(text, ranges) {
  const [firstStart, firstEnd] = ranges[0];
  let from = Math.max(0, firstStart - SNIPPET_BEFORE);
  if (from > 0) {
    const space = text.indexOf(" ", from);
    if (space !== -1 && space < firstStart) from = space + 1;
  }
  let to = Math.min(text.length, from + SNIPPET_LENGTH);
  if (to < text.length) {
    const space = text.lastIndexOf(" ", to);
    if (space >= firstEnd) to = space;
    else to = Math.max(to, firstEnd);
  }
  const parts = [];
  let at = from;
  for (const [start, end] of ranges) {
    if (end <= from) continue;
    if (start >= to) break;
    const hitStart = Math.max(start, from);
    const hitEnd = Math.min(end, to);
    if (hitStart > at)
      parts.push({ text: text.slice(at, hitStart), hit: false });
    parts.push({ text: text.slice(hitStart, hitEnd), hit: true });
    at = hitEnd;
  }
  if (at < to) parts.push({ text: text.slice(at, to), hit: false });
  return { parts, clippedStart: from > 0, clippedEnd: to < text.length };
}

/**
 * The entries of a lesson that match a query, in reading order. An entry
 * matches when every term of the query occurs somewhere in it. Each result
 * is the entry plus where it matched (`ranges`) and what to show for it
 * (`snippet`). An empty query matches nothing.
 * @param {object} doc
 * @param {string} query
 * @param {Array} [entries]  From lessonFindEntries(doc), when the caller keeps
 *   them between keystrokes.
 * @returns {Array<object>}
 */
export function findInLesson(doc, query, entries = lessonFindEntries(doc)) {
  const needles = foldTerms(findTerms(query));
  if (!needles.length) return [];
  const results = [];
  for (const entry of entries) {
    const ranges = rangesIn(entry.folded, entry.text.length, needles);
    if (!ranges) continue;
    results.push({ ...entry, ranges, snippet: snippet(entry.text, ranges) });
  }
  return results;
}
