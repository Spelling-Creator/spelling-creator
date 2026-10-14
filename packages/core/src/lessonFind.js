// Find in lesson: the search box the editor and the lesson page put over one
// lesson, as distinct from the hub's search over many (lessonSearch.js).
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
// (textBlockPlain, inlineTextPlain), so a formatted passage, a formula or a
// read-aloud hint matches by what shows on the page.

import { headingText } from "./heading.js";
import { imageCaptionParts } from "./imageCredit.js";
import { inlineTextPlain } from "./inlineText.js";
import { textBlockPlain } from "./lessonText.js";
import { questionAnswerItems } from "./questions.js";
import { vaktLinks, vaktText } from "./vakt.js";

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

/**
 * Every searchable place in a lesson, in reading order: each section's name
 * and each block's words. `number` counts text blocks and questions within
 * their section, from 1, the way the editor labels them (Q7); it is null for
 * the rest. `blockId` is null for a section's name.
 * @param {object} doc  The lesson body: { sections: [{ id, name, blocks }] }.
 * @returns {Array<{ kind: "section"|"heading"|"text"|"spelling"|"question"|"image"|"vakt",
 *   sectionId: string, sectionIndex: number, sectionName: string,
 *   blockId: string|null, number: number|null, text: string }>}
 */
export function lessonFindEntries(doc) {
  const entries = [];
  (doc?.sections || []).forEach((section, sectionIndex) => {
    const base = {
      sectionId: section?.id ?? "",
      sectionIndex,
      sectionName: words(section?.name),
    };
    const push = (kind, blockId, number, text) => {
      const joined = words(text);
      if (joined)
        entries.push({ kind, ...base, blockId, number, text: joined });
    };
    push("section", null, null, section?.name);
    let paragraphs = 0;
    let questions = 0;
    for (const block of section?.blocks || []) {
      if (!block?.id) continue;
      switch (block.type) {
        case "text":
          push("text", block.id, ++paragraphs, textBlockPlain(block));
          break;
        case "heading":
          push("heading", block.id, null, headingText(block));
          break;
        case "spelling":
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
              inlineTextPlain(block.prompt),
              ...questionAnswerItems(block),
              ...(block.steps || []).map((step) => inlineTextPlain(step?.text)),
            ].join(" "),
          );
          break;
        case "image":
          // The caption, not the credit: a search for "Wikimedia" has no
          // business landing on every picture in the lesson.
          push("image", block.id, null, imageCaptionParts(block).caption);
          break;
        case "vakt":
          push(
            "vakt",
            block.id,
            null,
            [
              vaktText(block),
              ...vaktLinks(block).map((link) => link.label),
            ].join(" "),
          );
          break;
        default:
          break;
      }
    }
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

// Text with case and accents folded away for matching, with `map` giving the
// code-unit index in the original of each folded character. Folding can
// change a character's length (one letter can fold to a base letter plus
// nothing, or to two code units), so matches found in the folded text are
// mapped back through it.
function fold(text) {
  let folded = "";
  const map = [];
  let at = 0;
  for (const char of text) {
    const chars = char
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
    for (const ch of chars) {
      folded += ch;
      map.push(at);
    }
    at += char.length;
  }
  return { folded, map };
}

// [start, end) in the original text for a match covering folded indexes
// [from, to).
function originalRange({ map }, textLength, from, to) {
  const start = map[from];
  let next = to;
  // A match may end inside a character that folded to several (İ folds to
  // an i and a dot); the range runs to the end of that character.
  while (next < map.length && map[next] === map[to - 1]) next += 1;
  const end = next < map.length ? map[next] : textLength;
  return [start, end];
}

/**
 * Where every term occurs in a text, as [start, end) ranges in the text's own
 * code units, sorted and merged, or null when any term is missing. Terms are
 * matched by their folded form (see fold), anywhere in a word.
 * @param {string} text
 * @param {string[]} terms  From findTerms(); their folding is done here.
 * @returns {Array<[number, number]>|null}
 */
export function findRanges(text, terms) {
  if (!terms.length) return null;
  const folded = fold(text);
  const ranges = [];
  for (const term of terms) {
    const needle = fold(term).folded;
    if (!needle) continue;
    let from = folded.folded.indexOf(needle);
    if (from === -1) return null;
    while (from !== -1) {
      ranges.push(
        originalRange(folded, text.length, from, from + needle.length),
      );
      from = folded.folded.indexOf(needle, from + 1);
    }
  }
  // A query of nothing but accents folds to nothing, and nothing is not a
  // match.
  if (!ranges.length) return null;
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
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
  const terms = findTerms(query);
  if (!terms.length) return [];
  const results = [];
  for (const entry of entries) {
    const ranges = findRanges(entry.text, terms);
    if (!ranges) continue;
    results.push({ ...entry, ranges, snippet: snippet(entry.text, ranges) });
  }
  return results;
}
