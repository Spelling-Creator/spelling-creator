// Lesson checks: the mechanically checkable half of the authoring standard
// stated in apps/mcp/src/standards.md.
//
// Two places run them, and they have to agree, which is why there is one copy
// here rather than one each:
//
//   - The MCP server (apps/mcp/src/validate.js) runs them on the way into every
//     write. standards.md carries the rules that need judgement ("a tight open
//     must be answerable instantly"), and it only reaches the model if the
//     client surfaces server instructions or tool descriptions. These hold even
//     when the model never read a word of the standard.
//   - The web editor (useLessonChecks) runs them as the author types, so a
//     person can check their own work without an assistant calling a tool.
//
// Errors reject an MCP write; warnings ride along with a successful one. In the
// editor neither blocks anything: errors are shown as problems, warnings as
// suggestions. The line between them is whether a legitimate lesson could ever
// trip the check: a green answer that is not in its own passage is always a
// defect, whereas a five-section lesson is usually a mistake and occasionally
// exactly what the user asked for.
//
// Every finding carries two descriptions of itself. `message` is prose for the
// model: it names the section, the offending value and the fix, because the
// model reads the rejection and resubmits, and "validation failed" buys a guess
// where a specific message buys a correction in one round trip. `params` is the
// same facts as data, for the editor to word in its own (translated) strings,
// since a message telling a person to "call the tool again" is no use to them.

import {
  textBlockFootnotes,
  textBlockFormattedSpans,
  textBlockPlain,
} from "@spelling-creator/core/lessonText";

/** The default lesson shape (see standards.md). Deviations are warnings. */
export const SECTION_COUNT = 6;
export const SPELLING_WORDS_PER_SECTION = 4;
export const SPELLING_MIN_LETTERS = 6;
export const SPELLING_MAX_LETTERS = 9;

// The fixed per-section question order: 3 green, 2 purple, 2 orange, 1 blue,
// then 7 pink (4 tight opens followed by 3 extended opens).
const QUESTION_ORDER = [
  "single",
  "single",
  "single",
  "number",
  "number",
  "multiple",
  "multiple",
  "background",
  "open",
  "open",
  "open",
  "open",
  "open",
  "open",
  "open",
];
const TIGHT_OPENS = 4;
const EXTENDED_OPENS = 3;
const ORANGE_MIN_ANSWERS = 2;
const ORANGE_MAX_ANSWERS = 4;

// The two orange types, and the line every check below has to decide which side
// of it falls on.
//
// The guidebook calls both SEMI-OPEN — questions with several known or
// semi-known answers rooted in the text — and describes them as a spectrum from
// tight to less tight, all printed orange. They are two types rather than one
// with a flag because `answers` means opposite things at the two ends:
//
//   `multiple`      TIGHT. `answers` is the exhaustive accepted set, and it is
//                   every item of one explicit list the passage states. Held to
//                   that hard, because a speller who names the item the question
//                   left out read the passage exactly as told.
//   `multiple_open` LESS TIGHT. `answers` is a SUGGESTION. The question is
//                   bounded by the topic or theme and leaves room to improvise
//                   ("Give a synonym for gratitude"), so an answer that isn't
//                   in the key — and by its nature isn't in the passage either —
//                   can be perfectly right.
//
// So every tight-end check below (grounding, the list checks, the blanked
// prompt) is scoped to `multiple` alone: run against the loose type they would
// reject exactly the question the standard asks for. What survives both is what
// the two ends agree on — rooted in the lesson, and short enough to spell on a
// letterboard.
const ORANGE_TIGHT = "multiple";
const ORANGE_LOOSE = "multiple_open";
const ORANGE_TYPES = new Set([ORANGE_TIGHT, ORANGE_LOOSE]);

// A private stand-in for a decimal point, so the punctuation strip can run
// without special-casing "." and without keeping sentence-ending full stops.
const DECIMAL_MARK = "\u0001";
const PUNCTUATION = new RegExp(`[^\\p{L}\\p{N}${DECIMAL_MARK}]+`, "gu");

// The orange list check needs the one piece of punctuation every other check
// throws away — the comma that turns two nouns into a series — so it gets its own
// stand-in and its own strip. See listTokens().
const COMMA_MARK = "\u0002";
const LIST_PUNCTUATION = new RegExp(
  `[^\\p{L}\\p{N}${DECIMAL_MARK}${COMMA_MARK}]+`,
  "gu",
);
// What separates one member of a list from the next: a comma or semicolon (both
// become COMMA_MARK) and the conjunctions. Anything else between two items means
// they were never written as a series.
const LIST_SEPARATORS = new Set([COMMA_MARK, "AND", "OR"]);
// How much prose may sit between two list items. "red-hot rock, choking gas, and
// clouds of ash" needs two ("clouds of"; the comma and "and" are separators);
// "a scale called the VEI, the Volcanic Explosivity Index" needs six, and is not
// a list.
const MAX_LIST_GAP_WORDS = 4;
// The blank an orange prompt puts where the passage's list was. Three underscores
// is the floor; lessons in practice write five or six.
const ORANGE_BLANK = /_{3,}/;

// Retired because it was overused to the point of becoming a tic. Matched
// loosely so rephrasings ("name a word that comes to mind") are caught too.
const RETIRED_STEM = /\bwords?\s+that\s+comes?\s+to\s+mind\b/i;

// Heuristics for telling a tight open from an extended one, used only by the
// W_OPEN_SPLIT warning. Word count alone misclassifies short extended opens
// ("In your own words, explain why."), so the stems get the first say.
const EXTENDED_STEM =
  /in your own words|defend your (answer|thinking|choice)|explain your (thinking|answer|reasoning|choice)|explain why|explain how|why do you think|describe (how|why|what)/i;
const TIGHT_STEM =
  /^\s*name\s+(a|an|one|some|something|someone|a kind|a type|a place|a way)\b/i;
const TIGHT_OPEN_MAX_WORDS = 12;

// The W_WYR_SHAPE check. A W.Y.R. choice is joined by ONE "or": "A or B", or a
// short list written "A, B, or C" (the source lessons ask "Would you rather tour
// through Paris, London, or New York?"). Chaining "A or B or C" is the shape it
// flags. Idioms whose "or" belongs to an option rather than separating two are
// set aside first, so "Would you rather wait an hour or so, or leave now?" is
// still one choice.
const WYR_STEM = /^would you rather\b/i;
const WYR_OR_IDIOMS =
  /\b(?:more or less|sooner or later|whether or not|give or take|rain or shine|one way or another|or so)\b/gi;
const WYR_SEPARATOR = /\bor\b/gi;

/** How many "or"s in a W.Y.R. prompt join one option to the next. */
function wyrSeparators(prompt) {
  return (prompt.replace(WYR_OR_IDIOMS, " ").match(WYR_SEPARATOR) || []).length;
}

/**
 * @typedef {object} Finding
 * @property {"error"|"warning"} level
 * @property {string} code            Stable machine code, e.g. "E_GROUNDING_SINGLE".
 * @property {string} key             Identity of the defect, stable across section renumbering.
 * @property {number|null} section    1-based section number, or null for lesson-wide findings.
 * @property {string|null} sectionId  That section's id, when it has one.
 * @property {string|null} blockId    The block to go to for this finding (a question or a
 *                                    spelling block), or null when it is about the section.
 * @property {string|null} itemId     Within that block, the one spelling word or answer the
 *                                    finding is about, when there is one.
 * @property {Record<string, unknown>} params
 *                                    The finding's facts as data (the answer, the word, which
 *                                    question), for a UI to word itself. See checks.json in
 *                                    apps/web for which code carries what.
 * @property {string} message         Self-correcting prose for a model: what is wrong, where, and the fix.
 */

/**
 * Normalise text for comparison: uppercase, drop punctuation, collapse
 * whitespace. Two details matter and both caused false failures before they were
 * handled — thousands separators (the passage says "3,776" while the answer field
 * holds "3776") and decimal points (which must survive the punctuation strip).
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeText(value) {
  return (
    String(value ?? "")
      // "3,776" and "3776" are the same number written two ways.
      .replace(/(\d),(?=\d{3}(?!\d))/g, "$1")
      .toUpperCase()
      // Park decimal points out of the way of the punctuation strip and put
      // them back afterwards: "112.5" must survive as one token, while the
      // full stop in "MAGMA." must not.
      .replace(/(\d)\.(\d)/g, `$1${DECIMAL_MARK}$2`)
      .replace(PUNCTUATION, " ")
      .split(DECIMAL_MARK)
      .join(".")
      .replace(/\s+/g, " ")
      .trim()
  );
}

// Whole-word containment. `" CAT "` does not match inside `" CATALOGUE "`, which
// plain substring matching would wrongly accept. Both arguments are normalised.
function containsPhrase(haystack, needle) {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

function wordsOf(normalized) {
  return normalized ? normalized.split(" ") : [];
}

function isSingleWord(normalized) {
  return wordsOf(normalized).length === 1;
}

function sectionLabel(section, index) {
  const name = typeof section?.name === "string" ? section.name.trim() : "";
  return name ? `Section ${index + 1} "${name}"` : `Section ${index + 1}`;
}

// The prose a grounding check compares against: the section's own text blocks,
// as plain words (formatting and footnote markers set aside) and normalised once.
function sectionPassage(blocks) {
  return normalizeText(
    blocks
      .filter((b) => b?.type === "text")
      .map(textBlockPlain)
      .join(" "),
  );
}

// One sentence's worth of tokens for the orange list check, with commas and
// semicolons kept as tokens of their own. Everything else matches normalizeText,
// so an option that compares equal to the passage there compares equal here.
//
// `tokens` are uppercased for comparing; `raw` holds the same tokens as the
// passage wrote them, for quoting one back. Uppercasing is the last step so the
// two line up one for one (the punctuation strip keeps letters of either case).
function listTokens(sentence) {
  const raw = sentence
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1") // "3,776" is a number, not a list
    .replace(/(\d)\.(\d)/g, `$1${DECIMAL_MARK}$2`)
    .replace(/[,;]/g, ` ${COMMA_MARK} `)
    .replace(LIST_PUNCTUATION, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.split(DECIMAL_MARK).join("."));
  return { tokens: raw.map((token) => token.toUpperCase()), raw };
}

// The section's passage as tokenised sentences. A list lives inside one sentence
// ("rock, gas, and ash"), so the split is what stops two items that merely share
// a paragraph from reading as a series. Sentence enders only count when followed
// by a space, which leaves "12.5" whole.
function passageSentences(blocks) {
  return blocks
    .filter((b) => b?.type === "text")
    .map(textBlockPlain)
    .join(" ")
    .split(/[.!?]+(?=\s|$)/)
    .map(listTokens)
    .filter((sentence) => sentence.tokens.length);
}

// Are these two token positions adjacent members of a list? They must be joined
// by a separator (a comma or an "and"/"or") and sit within a few words of each
// other. Nothing between them is what "the Pacific Ocean" looks like; a clause
// between them is what "a scale called the VEI, the Volcanic Explosivity Index"
// looks like. Neither is a list.
function listSeparated(tokens, from, to) {
  const gap = tokens.slice(from + 1, to);
  if (!gap.some((t) => LIST_SEPARATORS.has(t))) return false;
  return (
    gap.filter((t) => !LIST_SEPARATORS.has(t)).length <= MAX_LIST_GAP_WORDS
  );
}

// Do all of `options` appear in one sentence as a single explicit series? Walks
// the option occurrences in text order and breaks the walk wherever two of them
// aren't list-separated, so a run has to be a real list to survive — and returns
// the first run that covers every option, or null if none does.
function findListRun(tokens, options) {
  const wanted = new Set(options);
  const hits = [];
  tokens.forEach((token, at) => {
    if (wanted.has(token)) hits.push({ token, at });
  });
  let run = [];
  const runCoversAll = () =>
    new Set(run.map((h) => h.token)).size === wanted.size;
  for (const [i, hit] of hits.entries()) {
    if (i > 0 && listSeparated(tokens, hits[i - 1].at, hit.at)) {
      run.push(hit);
      continue;
    }
    if (run.length && runCoversAll()) return run;
    run = [hit];
  }
  return run.length > 0 && runCoversAll() ? run : null;
}

const CONJUNCTIONS = new Set(["AND", "OR"]);
// How many words a list item may run to before what follows a conjunction reads
// as a clause instead. "and silt" and "and the chough" are items; "and the
// valley went dark" is a sentence carrying on.
const MAX_ITEM_WORDS = 2;

// The next item of the series after `at`, or null if the series ends there. An
// English series closes with "and X" / "or X", so what marks a run of accepted
// answers as unfinished is a conjunction after it with an item attached:
// "boulder, cobble" is unfinished in front of "and silt".
//
// The hard part is that the same conjunction also joins clauses — "…rock, gas,
// and ash, and the valley went dark" ends its list at ASH. Nothing short of
// parsing the sentence separates the two for certain, so length decides: an item
// is a word or two before the next separator or the sentence's end, a clause
// runs on. That misses a subset whose sentence continues unpunctuated past the
// last item, which is the safe direction to miss in — a false positive here
// blocks an author who did nothing wrong.
//
// The item comes back as the passage wrote it ("silt", not "SILT"): it is quoted
// to whoever has to fix the list, and ALL CAPS in a lesson means vocabulary.
function nextListItemAfter({ tokens, raw }, at) {
  const tail = tokens.slice(at + 1, at + 4 + MAX_LIST_GAP_WORDS);
  if (!tail.length || !LIST_SEPARATORS.has(tail[0])) return null;
  const conjunction = tail.findIndex((t) => CONJUNCTIONS.has(t));
  if (conjunction === -1) return null;

  const start = at + 2 + conjunction;
  let end = start;
  while (end < tokens.length && !LIST_SEPARATORS.has(tokens[end])) end += 1;
  const length = end - start;
  if (!length || length > MAX_ITEM_WORDS) return null;
  return raw.slice(start, end).join(" ");
}

// The ALL-CAPS learning vocabulary a passage teaches. Two letters minimum so
// sentence-initial capitals are ignored; acronyms are picked up too, which is
// why reusing one as a spelling word is only a warning.
function capsVocabulary(blocks) {
  const plain = blocks
    .filter((b) => b?.type === "text")
    .map(textBlockPlain)
    .join(" ");
  const found = plain.match(/\b\p{Lu}[\p{Lu}'’-]+\b/gu) || [];
  return new Set(found.map(normalizeText).filter(Boolean));
}

// A section's spelling words, each with where it sits: its block and its own
// id, so a finding about one word points at that word's field even when the
// same word is listed twice.
function spellingWordsOf(blocks) {
  return blocks
    .filter((b) => b?.type === "spelling")
    .flatMap((b) =>
      (Array.isArray(b.words) ? b.words : []).map((w) => ({
        word: ((typeof w === "string" ? w : w?.text) || "").trim(),
        blockId: b.id,
        itemId: typeof w === "string" ? null : w?.id,
      })),
    )
    .filter((entry) => entry.word);
}

// The id of the orange answer whose text is `answer`, so a finding about one
// answer can point at its field.
function answerIdOf(block, answer) {
  const found = (Array.isArray(block?.answers) ? block.answers : []).find(
    (a) => typeof a !== "string" && (a?.text || "").trim() === answer,
  );
  return found?.id;
}

function answersOf(block) {
  if (ORANGE_TYPES.has(block?.questionType)) {
    return (Array.isArray(block.answers) ? block.answers : [])
      .map((a) => (typeof a === "string" ? a : a?.text) || "")
      .map((a) => a.trim())
      .filter(Boolean);
  }
  const answer = block?.answer;
  if (answer == null || answer === "") return [];
  return [String(answer).trim()].filter(Boolean);
}

function hasSteps(block) {
  return Array.isArray(block?.steps) && block.steps.length > 0;
}

function letterCount(word) {
  return (word.match(/\p{L}/gu) || []).length;
}

function wordCount(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function openKind(prompt) {
  const text = String(prompt || "");
  if (EXTENDED_STEM.test(text)) return "extended";
  if (TIGHT_STEM.test(text)) return "tight";
  return wordCount(text) > TIGHT_OPEN_MAX_WORDS ? "extended" : "tight";
}

function numericKey(value) {
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? String(n) : normalizeText(value);
}

// A collision names two parties, and which one the walk reaches first depends on
// section order — so moving a section would otherwise rewrite the key and make an
// untouched defect look newly introduced. Sorting makes the pair itself the
// identity, whichever end it was found from.
function pairKey(a, b) {
  return [String(a), String(b)].sort().join("|");
}

/**
 * Check a built lesson document against the authoring standard.
 *
 * Operates on the canonical doc (the shape buildDoc/applyPatch produce and the
 * hub stores), so it covers every write path — create, update and patch alike —
 * without each tool restating the rules.
 *
 * @param {{ title?: string, sections?: any[] }} doc
 * @returns {{ errors: Finding[], warnings: Finding[] }}
 */
export function validateLesson(doc) {
  const sections = Array.isArray(doc?.sections) ? doc.sections : [];
  const findings = [];
  const report = (level, code, key, section, message, detail = {}) =>
    findings.push({
      level,
      code,
      key: `${code}:${key}`,
      section,
      sectionId: section ? sections[section - 1]?.id || null : null,
      blockId: detail.blockId || null,
      itemId: detail.itemId || null,
      params: detail.params || {},
      message,
    });
  const error = (code, key, section, message, detail) =>
    report("error", code, key, section, message, detail);
  const warn = (code, key, section, message, detail) =>
    report("warning", code, key, section, message, detail);

  // Per-section context, computed once: the passage every grounding check reads,
  // the caps vocabulary, the spelling words, and the questions in order.
  const context = sections.map((section, i) => {
    const blocks = Array.isArray(section?.blocks) ? section.blocks : [];
    return {
      index: i,
      number: i + 1,
      id: section?.id || `section#${i}`,
      label: sectionLabel(section, i),
      blocks,
      passage: sectionPassage(blocks),
      // The same prose again, kept in sentences and with its commas, because the
      // orange list check needs both and no other check may have either.
      sentences: passageSentences(blocks),
      caps: capsVocabulary(blocks),
      spelling: spellingWordsOf(blocks),
      questions: blocks.filter((b) => b?.type === "question"),
    };
  });

  // Every text answer in the lesson, tagged with the question that owns it — the
  // input to the lesson-wide collision checks further down.
  const allAnswers = [];

  for (const ctx of context) {
    ctx.questions.forEach((block, qi) => {
      // Block ids are what make a finding's identity survive an edit elsewhere in
      // the lesson: they are generated once and carried through move_section,
      // move_block and replace_block alike. Position would not be.
      const questionId = block?.id || `${ctx.id}#q${qi}`;
      const answers = answersOf(block);
      const where = `${ctx.label}, question ${qi + 1}`;
      // Every finding below is about this question, and the editor numbers its
      // questions per section the same way (SectionCard's questionNumbers).
      const about = (params = {}, itemId = null) => ({
        blockId: block?.id,
        itemId,
        params: { question: qi + 1, ...params },
      });

      // A loose orange question's answers are suggestions, so they are kept out
      // of the lesson-wide pools below: a word that merely illustrates what
      // would count is not "the answer to a question", and blocking a write
      // because a warm-up word or another question's answer turns up among the
      // examples would reject a lesson with nothing wrong with it.
      if (block.questionType !== ORANGE_LOOSE) {
        for (const answer of answers) {
          allAnswers.push({
            text: answer,
            norm: normalizeText(answer),
            questionId,
            questionType: block.questionType,
            section: ctx.number,
            where,
            blockId: block?.id,
            number: qi + 1,
          });
        }
      }

      // The one rule both ends of orange agree on. A speller answers by pointing
      // out letters, so an accepted answer — or, at the loose end, a suggested
      // one — should be a single word whichever contract it is under.
      if (ORANGE_TYPES.has(block.questionType)) {
        for (const answer of answers) {
          const norm = normalizeText(answer);
          if (isSingleWord(norm)) continue;
          warn(
            "W_ORANGE_MULTIWORD",
            `${questionId}:${norm}`,
            ctx.number,
            `${where}: the answer "${answer}" is more than one word. ` +
              "Orange answers should be single words — a speller pointing to letters on a letterboard " +
              "has to spell every one of them.",
            about({ answer }, answerIdOf(block, answer)),
          );
        }
      }

      switch (block.questionType) {
        case "single": {
          for (const answer of answers) {
            if (containsPhrase(ctx.passage, normalizeText(answer))) continue;
            error(
              "E_GROUNDING_SINGLE",
              `${questionId}:${normalizeText(answer)}`,
              ctx.number,
              `${ctx.label}: the answer "${answer}" does not appear in that section's passage. ` +
                "A green (single) answer must be findable, word for word, in the section's own text — " +
                "either add the wording to the passage or change the answer to match what the passage already says.",
              about({ answer }),
            );
          }
          break;
        }

        // The loose end of orange, and almost nothing to check. Its answer key
        // is advisory, so it is held neither to the passage (a synonym is not
        // in the text — that is the point of asking for one) nor to a list (a
        // definition question has none behind it). Every tight-end check below
        // would reject exactly the question the standard asks for here. What is
        // left is that there is a key at all, plus the shared single-word
        // check above.
        case ORANGE_LOOSE: {
          if (answers.length) break;
          warn(
            "W_ORANGE_ANSWER_COUNT",
            questionId,
            ctx.number,
            `${where}: this orange (multiple_open) question suggests no answers at all. Give at least one. ` +
              "The key is a guide rather than a match target — a speller may answer something else and still " +
              "be right — but an empty one tells whoever is scoring nothing about what would count.",
            about({ count: 0, open: true }),
          );
          break;
        }

        case ORANGE_TIGHT: {
          if (
            answers.length < ORANGE_MIN_ANSWERS ||
            answers.length > ORANGE_MAX_ANSWERS
          ) {
            warn(
              "W_ORANGE_ANSWER_COUNT",
              questionId,
              ctx.number,
              `${where}: this orange (multiple) question accepts ${answers.length} answer(s). ` +
                `Aim for ${ORANGE_MIN_ANSWERS}-${ORANGE_MAX_ANSWERS}, so the speller has a real choice without hunting.`,
              about({
                count: answers.length,
                open: false,
                min: ORANGE_MIN_ANSWERS,
                max: ORANGE_MAX_ANSWERS,
              }),
            );
          }
          for (const answer of answers) {
            const norm = normalizeText(answer);
            if (containsPhrase(ctx.passage, norm)) continue;
            if (isSingleWord(norm)) {
              error(
                "E_ORANGE_PARAPHRASED",
                `${questionId}:${norm}`,
                ctx.number,
                `${ctx.label}: the accepted answer "${answer}" does not appear in that section's passage. ` +
                  "A `multiple` question retrieves a list the passage states, so its answers must be words the " +
                  'passage actually uses — do not paraphrase (if the text says "superheated", HOT is not an ' +
                  'accepted answer), and do not ask for general knowledge ("name an ocean" is a blue background ' +
                  "question). If you meant to ask for a synonym, a definition, or anything else the speller " +
                  'supplies in their own words ("Give a synonym for GRATITUDE"), that is the other orange type: ' +
                  "`multiple_open`, whose answers are suggestions and are not held to the passage.",
                about({ answer }, answerIdOf(block, answer)),
              );
            } else {
              error(
                "E_GROUNDING_MULTIPLE",
                `${questionId}:${norm}`,
                ctx.number,
                `${ctx.label}: the accepted answer "${answer}" does not appear in that section's passage. ` +
                  "Match the passage's own wording, and prefer a single concrete word the speller can find in the text.",
                about({ answer }, answerIdOf(block, answer)),
              );
            }
          }

          // The prompt is meant to quote the passage's sentence with the list
          // BLANKED OUT, so the speller recalls it. A prompt carrying its own
          // answers hands them over and tests nothing — the commonest orange
          // defect, and invisible unless something looks for it.
          const promptNorm = normalizeText(block.prompt || "");
          const given = answers.filter((a) =>
            containsPhrase(promptNorm, normalizeText(a)),
          );
          if (given.length) {
            error(
              "E_ORANGE_ANSWER_IN_PROMPT",
              `${questionId}:${given.map(normalizeText).sort().join("|")}`,
              ctx.number,
              `${where}: the prompt contains its own accepted answer${given.length === 1 ? "" : "s"} ` +
                `(${given.map((a) => `"${a}"`).join(", ")}), so there is nothing for the speller to recall. ` +
                'Blank the list out of the quoted sentence instead: not "Cats travelled with the Roman army, ' +
                'traders, and settlers — name one", but "Cats travelled with the Roman ______ — name one group."',
              about({ answers: given, count: given.length }),
            );
          }

          // The prompt is also what tells the speller WHICH of the section's two
          // lists is being asked for. Quoting the sentence with its list blanked
          // out does that; "Name one." leaves them guessing. A prompt can
          // identify its list without a literal blank ("Which three trees line
          // the bank?"), so this one advises rather than blocks.
          if (!ORANGE_BLANK.test(block.prompt || "")) {
            warn(
              "W_ORANGE_NO_BLANK",
              questionId,
              ctx.number,
              `${where}: the prompt doesn't quote the passage's sentence with its list blanked out ` +
                '("The blast sent out ______. Name one thing the eruption threw out."). A section has two orange ' +
                'questions, so a bare "Name one." doesn\'t tell the speller which list is meant.',
              about(),
            );
          }

          // An orange question is retrieval of a list the passage actually
          // contains. Options that never co-occur as a series were reverse-
          // engineered out of prose that has no list — and the fix for that is in
          // the passage, not in the question.
          const options = answers
            .map((a) => normalizeText(a))
            .filter(
              (norm) => isSingleWord(norm) && containsPhrase(ctx.passage, norm),
            );
          const distinct = [...new Set(options)];
          if (
            distinct.length < ORANGE_MIN_ANSWERS ||
            distinct.length !== answers.length
          ) {
            break;
          }

          // One question, one WHOLE list. A run that covers every accepted answer
          // but stops before the series does means the passage lists an item the
          // question won't accept — so a speller who names it, having read exactly
          // what they were told to read, is marked wrong.
          const key = [...distinct].sort().join("|");
          let partial = null;
          let complete = false;
          for (const sentence of ctx.sentences) {
            const run = findListRun(sentence.tokens, distinct);
            if (!run) continue;
            // The series has to end where the accepted answers do — checked at
            // the run's last item, wherever the conjunctions inside it fell, so
            // "cats and dogs" is caught in front of "and rabbits".
            const nextItem = nextListItemAfter(
              sentence,
              run[run.length - 1].at,
            );
            if (!nextItem) {
              complete = true;
              break;
            }
            partial ??= nextItem;
          }

          if (complete) break;
          if (partial) {
            error(
              "E_ORANGE_PARTIAL_LIST",
              `${questionId}:${key}`,
              ctx.number,
              `${ctx.label}: the passage's list runs on past the accepted answers ` +
                `${answers.map((a) => `"${a}"`).join(", ")} — it goes on to "${partial}". The accepted answers ` +
                "must be EVERY item of the one list the question blanks out, or a speller who names the item you " +
                "left out is marked wrong for reading the passage properly. Accept the remaining item(s), or take " +
                "them out of the list in the prose.",
              about({ answers, next: partial }),
            );
          } else {
            error(
              "E_ORANGE_NOT_A_LIST",
              `${questionId}:${key}`,
              ctx.number,
              `${ctx.label}: the accepted answers ${answers.map((a) => `"${a}"`).join(", ")} appear in that ` +
                "section's passage, but not together as one list. An orange question retrieves a list the prose " +
                'already states — write it in as an explicit series ("The blast sent out red-hot rock, choking ' +
                'gas, and clouds of ash"), then quote that sentence with the list blanked out. Do not build the ' +
                'question out of words that are not a series: "the Pacific Ocean" is one noun phrase, not PACIFIC ' +
                "and OCEAN. When an orange question is weak the fix is almost always to rewrite the passage, not " +
                "the question. (A question that was never about a list — a synonym, a definition, anything the " +
                "speller answers in their own words — belongs to the other orange type, `multiple_open`.)",
              about({ answers }),
            );
          }
          break;
        }

        case "number": {
          // A number question with no steps is the fill-in-the-blank one, so its
          // value has to be sitting in the passage. One with steps is the word
          // problem: its answer is computed, not quoted.
          if (hasSteps(block)) break;
          for (const answer of answers) {
            if (containsPhrase(ctx.passage, normalizeText(answer))) continue;
            error(
              "E_GROUNDING_NUMBER_FILL",
              `${questionId}:${normalizeText(answer)}`,
              ctx.number,
              `${ctx.label}: the answer ${answer} does not appear in that section's passage. ` +
                "A fill-in-the-blank purple question asks for a number the passage states. If this is meant to be " +
                "the word problem instead, add its worked solution to `steps`.",
              about({ answer }),
            );
          }
          break;
        }

        case "background": {
          for (const answer of answers) {
            if (!containsPhrase(ctx.passage, normalizeText(answer))) continue;
            error(
              "E_BACKGROUND_IN_TEXT",
              `${questionId}:${normalizeText(answer)}`,
              ctx.number,
              `${ctx.label}: the background answer "${answer}" appears in that section's passage. ` +
                "A blue question must need knowledge from outside the lesson — that is the entire point of the type. " +
                "Ask for something the passage deliberately does not say, or make this a green (single) question.",
              about({ answer }),
            );
          }
          break;
        }

        case "open": {
          if (RETIRED_STEM.test(block.prompt || "")) {
            error(
              "E_RETIRED_STEM",
              questionId,
              ctx.number,
              `${where}: the stem "…one word that comes to mind…" is retired — it was overused to the point ` +
                'of becoming a tic. For a tight open, name an everyday category instead: "Name a color of a crayon", ' +
                '"Name something found in a hospital", "Name something that uses electricity".',
              about(),
            );
          }
          break;
        }

        // A W.Y.R. question is a choice, and the stem is what makes it one.
        // Only a warning: the wording is a convention, and a choice phrased
        // some other way is still a usable question.
        case "wyr": {
          const prompt = (block.prompt || "").trim();
          const separators = wyrSeparators(prompt);
          if (!WYR_STEM.test(prompt) || separators === 0) {
            warn(
              "W_WYR_SHAPE",
              questionId,
              ctx.number,
              `${where}: this W.Y.R. prompt doesn't read as a choice. A W.Y.R. question starts ` +
                '"Would you rather…" and offers two options joined by "or": ' +
                '"Would you rather watch an opera or a movie?".',
              about({ ors: separators }),
            );
          } else if (separators > 1) {
            warn(
              "W_WYR_SHAPE",
              questionId,
              ctx.number,
              `${where}: this W.Y.R. prompt chains ${separators} "or"s, which reads as a run-on rather ` +
                'than a choice. Offer two options ("Would you rather watch an opera or a movie?"), or at ' +
                'most a short list joined by one "or" ("Would you rather tour Paris, London, or New York?").',
              about({ ors: separators }),
            );
          }
          break;
        }

        default:
          break;
      }
    });

    // --- One prompt must not hand over another question's answer -----------
    //
    // Green answers and orange options are the words the speller is meant to
    // retrieve. Writing one into a different question's prompt in the same
    // section lets them copy it across instead: a green question answered
    // BRITAIN, followed by a fill-in reading "…cats reached Britain around the
    // year ___", gives the green answer away. The fix is a rephrasing — "the
    // British Isles".
    //
    // Only recall answers count, which is why this reads green and TIGHT orange
    // and nothing else. A prompt may freely name a topic word whose own question
    // wants a number back — "more than ___ mummies at Bubastis" does not help
    // anyone produce BUBASTIS — and circumlocuting every such mention would make
    // prompts clumsy for no gain. A loose orange question's suggestions are not
    // retrieval either: nobody is being asked to remember them, so naming one
    // elsewhere gives nothing away.
    const recall = [];
    ctx.questions.forEach((block, qi) => {
      const type = block?.questionType;
      if (type !== "single" && type !== ORANGE_TIGHT) return;
      for (const answer of answersOf(block)) {
        recall.push({
          answer,
          norm: normalizeText(answer),
          owner: block?.id || `${ctx.id}#q${qi}`,
          number: qi + 1,
        });
      }
    });
    ctx.questions.forEach((block, qi) => {
      const questionId = block?.id || `${ctx.id}#q${qi}`;
      const promptNorm = normalizeText(block?.prompt || "");
      if (!promptNorm) return;
      // A prompt carrying its own orange answers is E_ORANGE_ANSWER_IN_PROMPT's
      // business, so the owning question is skipped here rather than reported
      // twice under two codes.
      const leaked = [];
      for (const entry of recall) {
        if (entry.owner === questionId) continue;
        if (!containsPhrase(promptNorm, entry.norm)) continue;
        if (leaked.some((seen) => seen.norm === entry.norm)) continue;
        leaked.push(entry);
      }
      if (!leaked.length) return;
      const named = leaked
        .map(
          (entry) =>
            `"${entry.answer}" (the answer to question ${entry.number})`,
        )
        .join(", ");
      const key = `${questionId}:${leaked
        .map((entry) => entry.norm)
        .sort()
        .join("|")}`;
      const detail = {
        blockId: block?.id,
        params: {
          question: qi + 1,
          questionType: block.questionType,
          leaks: leaked.map(({ answer, number }) => ({
            answer,
            question: number,
          })),
        },
      };
      // Some prompts are allowed to name the thing they are about, so for them
      // the leak is not always a defect. An extended open exists to make the
      // speller talk about the section's subject, and that subject is usually a
      // green answer — "In your own words, explain how a delta forms" cannot
      // avoid DELTA without going vague. A loose orange question has the same
      // problem in a sharper form: "Give a synonym for X" has to say X. And a
      // W.Y.R. question's options are often the section's own vocabulary:
      // "Would you rather be circumspect and get one wish, or bet for ten?" is
      // the question working as designed. Worth flagging in all three cases,
      // never worth blocking.
      if (
        block.questionType === "open" ||
        block.questionType === "wyr" ||
        block.questionType === ORANGE_LOOSE
      ) {
        const kind =
          block.questionType === "open"
            ? "this pink prompt"
            : block.questionType === "wyr"
              ? "this W.Y.R. (grape) prompt"
              : "this orange (multiple_open) prompt";
        const excuse =
          block.questionType === "open"
            ? "Fine when the open question genuinely has to name the section's subject; worth rewording if it doesn't."
            : block.questionType === "wyr"
              ? "Fine when the choice is genuinely about that word; worth rewording if it isn't."
              : 'Fine when the question is about that word ("Give a synonym for X" has to name X); worth ' +
                "rewording if it isn't.";
        warn(
          "W_ANSWER_REVEALED_OPEN",
          key,
          ctx.number,
          `${ctx.label}, question ${qi + 1}: ${kind} names ${named}, so the speller can read that ` +
            `answer off it. ${excuse}`,
          detail,
        );
        return;
      }
      error(
        "E_ANSWER_REVEALED_CROSS",
        key,
        ctx.number,
        `${ctx.label}, question ${qi + 1}: the prompt names ${named}. ` +
          "A prompt must not contain a word another question in the same section expects the speller to " +
          "retrieve — they can copy it across instead of recalling it. Rephrase around it: a green answer of " +
          'BRITAIN followed by a prompt reading "…cats reached Britain around the year ___" is fixed by ' +
          'writing "the British Isles".',
        detail,
      );
    });

    // --- Section shape -----------------------------------------------------

    if (!ctx.questions.length) {
      warn(
        "W_NO_QUESTION",
        ctx.id,
        ctx.number,
        `${ctx.label} has no question. Each section should end with its own questions about its own content — ` +
          "add them, or move them out of any separate quiz section at the end.",
      );
    } else {
      // The shape findings are about the section as a whole, so they point at
      // its first question: that is where the order starts going wrong.
      const firstQuestion = { blockId: ctx.questions[0]?.id };
      const shape = ctx.questions.map((q) => q.questionType);
      // Either orange type satisfies an orange slot — the standard asks for two
      // semi-open questions there, not for one of each — so the shapes are
      // compared with the two folded together and the ordering between them left
      // to W_ORANGE_ORDER below.
      const slot = (type) => (ORANGE_TYPES.has(type) ? ORANGE_TIGHT : type);
      if (shape.map(slot).join(",") !== QUESTION_ORDER.join(",")) {
        warn(
          "W_QUESTION_SHAPE",
          ctx.id,
          ctx.number,
          `${ctx.label} has ${shape.length} question(s) in the order ${shape.join(", ")}. ` +
            `The default is ${QUESTION_ORDER.length}, in this order: ${QUESTION_ORDER.join(", ")} ` +
            `(3 green, 2 purple, 2 orange, 1 blue, then ${TIGHT_OPENS} tight opens and ${EXTENDED_OPENS} extended opens). ` +
            "Either orange type counts towards an orange slot: `multiple` for a list the passage states, " +
            "`multiple_open` for the looser end.",
          { ...firstQuestion, params: { count: shape.length } },
        );
      }

      // The guidebook orders the semi-open questions TIGHT then LESS TIGHT, so a
      // section that mixes the two puts `multiple` first. Only a warning, and
      // only for a genuine inversion: the ordering is a convention about
      // increasing openness, not a rule about which types a section may hold.
      const orange = ctx.questions.filter((q) =>
        ORANGE_TYPES.has(q.questionType),
      );
      const firstLoose = orange.findIndex(
        (q) => q.questionType === ORANGE_LOOSE,
      );
      const lastTight = orange.findLastIndex(
        (q) => q.questionType === ORANGE_TIGHT,
      );
      if (firstLoose !== -1 && lastTight > firstLoose) {
        warn(
          "W_ORANGE_ORDER",
          ctx.id,
          ctx.number,
          `${ctx.label}: a loose orange question (\`multiple_open\`) comes before a tight one (\`multiple\`). ` +
            "The two are one family on a spectrum and are asked tight first, so the question retrieving a list " +
            "the passage states goes ahead of the one the speller answers in their own words.",
          { blockId: orange[firstLoose]?.id },
        );
      }

      const opens = ctx.questions.filter((q) => q.questionType === "open");
      if (opens.length === TIGHT_OPENS + EXTENDED_OPENS) {
        const kinds = opens.map((q) => openKind(q.prompt));
        const tightOk = kinds.slice(0, TIGHT_OPENS).every((k) => k === "tight");
        const extendedOk = kinds
          .slice(TIGHT_OPENS)
          .every((k) => k === "extended");
        if (!tightOk || !extendedOk) {
          warn(
            "W_OPEN_SPLIT",
            ctx.id,
            ctx.number,
            `${ctx.label}: the ${opens.length} pink questions don't read as ${TIGHT_OPENS} tight opens followed by ` +
              `${EXTENDED_OPENS} extended opens. The first ${TIGHT_OPENS} should be easy one-word recall from the ` +
              'speller\'s own world ("Name something found in a hospital"); the last ' +
              `${EXTENDED_OPENS} should invite a full sentence ("In your own words, explain…", "…Defend your answer.").`,
            {
              blockId: opens[0]?.id,
              params: { tight: TIGHT_OPENS, extended: EXTENDED_OPENS },
            },
          );
        }
      }

      const numbers = ctx.questions.filter((q) => q.questionType === "number");
      if (numbers.length >= 2 && !numbers.some(hasSteps)) {
        warn(
          "W_NUMBER_NO_STEPS",
          ctx.id,
          ctx.number,
          `${ctx.label}: no purple question carries \`steps\`. The second one is the word problem — put its ` +
            "worked solution in the `steps` array, one step per element, rather than in the prompt or nowhere at all.",
          { blockId: numbers[1]?.id },
        );
      }
    }

    if (ctx.spelling.length !== SPELLING_WORDS_PER_SECTION) {
      warn(
        "W_SPELLING_COUNT",
        ctx.id,
        ctx.number,
        `${ctx.label} has ${ctx.spelling.length} spelling word(s). The default is exactly ` +
          `${SPELLING_WORDS_PER_SECTION} per section.`,
        {
          blockId: ctx.blocks.find((b) => b?.type === "spelling")?.id,
          params: {
            count: ctx.spelling.length,
            expected: SPELLING_WORDS_PER_SECTION,
          },
        },
      );
    }

    for (const { word, blockId, itemId } of ctx.spelling) {
      const letters = letterCount(word);
      if (letters < SPELLING_MIN_LETTERS || letters > SPELLING_MAX_LETTERS) {
        error(
          "E_SPELLING_LENGTH",
          `${ctx.id}:${normalizeText(word)}`,
          ctx.number,
          `${ctx.label}: the spelling word "${word}" is ${letters} letters. Spelling words must be ` +
            `${SPELLING_MIN_LETTERS}-${SPELLING_MAX_LETTERS} letters.`,
          {
            blockId,
            itemId,
            params: {
              word,
              letters,
              min: SPELLING_MIN_LETTERS,
              max: SPELLING_MAX_LETTERS,
            },
          },
        );
      }
      if (ctx.caps.has(normalizeText(word))) {
        warn(
          "W_SPELLING_IN_CAPS",
          `${ctx.id}:${normalizeText(word)}`,
          ctx.number,
          `${ctx.label}: the spelling word "${word}" is also ALL-CAPS learning vocabulary in that section's ` +
            "passage. The two lists are meant to be separate — reusing the passage's vocabulary as a warm-up word " +
            "is redundant and too obvious. Pick a different word on the same theme.",
          { blockId, itemId, params: { word } },
        );
      }
    }
  }

  // --- Lesson-wide collisions ----------------------------------------------

  // Spelling words: unique across the lesson, and never hiding inside an answer
  // (PRISON inside "the prisoner's dilemma"), which is why this one is a raw
  // substring test rather than a whole-word one.
  const seenSpelling = new Map();
  for (const ctx of context) {
    for (const { word, blockId, itemId } of ctx.spelling) {
      const norm = normalizeText(word);
      const first = seenSpelling.get(norm);
      if (first && first.ctx.number !== ctx.number) {
        error(
          "E_SPELLING_DUPLICATE",
          `${pairKey(first.ctx.id, ctx.id)}|${norm}`,
          ctx.number,
          `The spelling word "${word}" is used in both section ${first.ctx.number} and section ${ctx.number}. ` +
            "Each section needs its own four words.",
          { blockId, itemId, params: { word, otherSection: first.ctx.number } },
        );
      } else if (first) {
        error(
          "E_SPELLING_DUPLICATE",
          `${ctx.id}|${norm}`,
          ctx.number,
          `${ctx.label} lists the spelling word "${word}" twice.`,
          { blockId, itemId, params: { word } },
        );
      } else {
        seenSpelling.set(norm, { ctx, word, blockId, itemId });
      }
    }
  }

  for (const [norm, { ctx, word, blockId, itemId }] of seenSpelling) {
    for (const answer of allAnswers) {
      if (!answer.norm.includes(norm)) continue;
      error(
        "E_SPELLING_COLLISION",
        `${pairKey(ctx.id, answer.questionId)}|${norm}|${answer.norm}`,
        ctx.number,
        `Section ${ctx.number}'s spelling word "${word}" appears inside the answer "${answer.text}" ` +
          `(${answer.where}). A spelling word must not turn up in any answer anywhere in the lesson — the ` +
          "warm-up would give the answer away. Change one or the other.",
        {
          blockId,
          itemId,
          params: {
            word,
            answer: answer.text,
            otherSection: answer.section,
            otherQuestion: answer.number,
          },
        },
      );
    }
  }

  // One answer word, one question. Whole answers are the unit, so "A SHIELD
  // VOLCANO" and "A STRATOVOLCANO" coexist happily; what this catches is the same
  // standalone word answering twice (GAS in three sections' orange lists), and a
  // one-word answer reappearing inside a longer one. Loose orange questions took
  // no part in this — their suggestions never entered `allAnswers` — because the
  // rule is about a word the speller has to produce for exactly one question, and
  // a suggestion is not one of those.
  const reusable = allAnswers.filter(
    (a) => a.questionType === "single" || a.questionType === ORANGE_TIGHT,
  );
  const byAnswer = new Map();
  for (const answer of reusable) {
    if (!answer.norm) continue;
    const seen = byAnswer.get(answer.norm);
    if (!seen) {
      byAnswer.set(answer.norm, answer);
      continue;
    }
    if (seen.questionId === answer.questionId) continue;
    error(
      "E_ANSWER_WORD_REUSED",
      `${pairKey(seen.questionId, answer.questionId)}|${answer.norm}`,
      answer.section,
      `The answer "${answer.text}" is used by more than one question (${seen.where} and ${answer.where}). ` +
        "Each answer word belongs to exactly one question, anywhere in the lesson and at any length — give this " +
        "question its own distinct word.",
      {
        blockId: answer.blockId,
        params: {
          answer: answer.text,
          question: answer.number,
          otherSection: seen.section,
          otherQuestion: seen.number,
        },
      },
    );
  }

  for (const [norm, answer] of byAnswer) {
    if (!isSingleWord(norm)) continue;
    for (const other of reusable) {
      if (other.questionId === answer.questionId) continue;
      if (isSingleWord(other.norm)) continue;
      if (!wordsOf(other.norm).includes(norm)) continue;
      error(
        "E_ANSWER_WORD_REUSED",
        `${pairKey(answer.questionId, other.questionId)}|${norm}|${other.norm}`,
        answer.section,
        `The one-word answer "${answer.text}" (${answer.where}) also appears inside the answer "${other.text}" ` +
          `(${other.where}). A word that answers one question should not turn up in another question's answer.`,
        {
          blockId: answer.blockId,
          params: {
            answer: answer.text,
            question: answer.number,
            otherAnswer: other.text,
            otherSection: other.section,
            otherQuestion: other.number,
          },
        },
      );
    }
  }

  // Numeric answers are distinct across the lesson, so no two purple questions
  // ever resolve to the same figure.
  const seenNumbers = new Map();
  for (const ctx of context) {
    ctx.questions.forEach((block, qi) => {
      if (block.questionType !== "number") return;
      const questionId = block?.id || `${ctx.id}#q${qi}`;
      for (const answer of answersOf(block)) {
        const key = numericKey(answer);
        const first = seenNumbers.get(key);
        if (first) {
          // Both purple questions in one section can land on the same figure, and
          // "section 1 and section 1" would leave the author hunting.
          const place =
            first.ctx.number === ctx.number
              ? `both in section ${ctx.number}`
              : `section ${first.ctx.number} and section ${ctx.number}`;
          error(
            "E_NUMBER_DUPLICATE",
            `${pairKey(first.questionId, questionId)}|${key}`,
            ctx.number,
            `The number ${answer} answers two different questions (${place}). ` +
              "Every numeric answer in a lesson should be distinct — rework one of the problems so it lands on a " +
              "different figure.",
            {
              blockId: block?.id,
              params: {
                answer,
                question: qi + 1,
                otherSection: first.ctx.number,
                otherQuestion: first.number,
              },
            },
          );
        } else {
          seenNumbers.set(key, { ctx, questionId, number: qi + 1 });
        }
      }
    });
  }

  // VAKT activities are optional and only added when the user asks for them, so
  // there is nothing to check about whether a section has one. Where a section
  // does, the standard puts it last — after the questions — because it is what
  // the speller does once that section's work is finished, not an interruption
  // partway through it. Only ever a warning: it's a placement convention, and a
  // user who wants a break mid-section is entitled to one.
  for (const ctx of context) {
    const misplaced = ctx.blocks.findIndex(
      (block, i) =>
        block?.type === "vakt" &&
        ctx.blocks.slice(i + 1).some((after) => after?.type !== "vakt"),
    );
    if (misplaced !== -1) {
      warn(
        "W_VAKT_NOT_LAST",
        ctx.id,
        ctx.number,
        `${ctx.label} has a VAKT activity at block ${misplaced + 1}, with other content after it. ` +
          "A VAKT activity goes last in its section, after that section's questions.",
        { blockId: ctx.blocks[misplaced]?.id },
      );
    }
  }

  checkFormatting(context, error, warn);
  checkCitations(doc, context, error);

  if (sections.length !== SECTION_COUNT) {
    warn(
      "W_SECTION_COUNT",
      String(sections.length),
      null,
      `This lesson has ${sections.length} section(s); the default is ${SECTION_COUNT}. ` +
        "That is fine if the user asked for a different length — otherwise add or remove sections.",
      { params: { count: sections.length, expected: SECTION_COUNT } },
    );
  }

  return {
    errors: findings.filter((f) => f.level === "error"),
    warnings: findings.filter((f) => f.level === "warning"),
  };
}

// ---- Formatting and footnotes ----------------------------------------------
//
// A lesson is read aloud to a speller and printed for a communication partner.
// Plain prose is what both expect, ALL CAPS already marks the vocabulary, and
// formatting scattered through a passage is the quickest way for one to read as
// machine-written. So the standard asks assistants to leave text unformatted
// unless a convention needs it (a book's title in italics, a scientific name),
// and these checks hold them to it.
//
// The limits are per section, over all its text blocks together: a short block
// that is mostly one italic title is fine, a passage that is a fifth bold is not.
// Findings are keyed on the formatting itself (which words, with which marks),
// not on where it sits or on the prose around it. patch_lesson (and, through
// tools.js, update_lesson) only holds a write to findings it introduced, so
// rewording a sentence in a section a person formatted in the web editor leaves
// the key alone and the edit through. Adding formatting to that section does
// change it, and is the write's to answer for.

/** The most formatted spans a section's prose may carry. */
export const FORMAT_MAX_SPANS = 3;
/** The share of a section's prose that may be formatted. */
export const FORMAT_MAX_SHARE = 0.1;
/** The longest bold or underlined run, in words. Longer is a shouted sentence. */
export const FORMAT_MAX_EMPHASIS_WORDS = 4;
/** The longest italic run, in words. Long enough for a book's title. */
export const FORMAT_MAX_ITALIC_WORDS = 10;

// Every formatted span in a section's text blocks (textBlockFormattedSpans),
// tagged with the block it sits in, and the length of the prose around them.
function formattedSpans(blocks) {
  const spans = [];
  let total = 0;
  for (const block of blocks.filter((b) => b?.type === "text")) {
    const found = textBlockFormattedSpans(block);
    spans.push(...found.spans.map((span) => ({ ...span, blockId: block.id })));
    total += found.totalChars;
  }
  return { spans, total };
}

// What a formatting finding hands the editor: the block of its first span, and
// the formatted words themselves.
function spanDetail(spans, params = {}) {
  return {
    blockId: spans[0]?.blockId,
    params: { spans: spans.map((s) => s.text), ...params },
  };
}

// A finding's identity: the spans it is about, as words and marks.
function spanKey(spans) {
  return spans
    .map((s) => `${s.marks.join("+")}:${normalizeText(s.text)}`)
    .sort()
    .join("|");
}

function checkFormatting(context, error, warn) {
  for (const ctx of context) {
    const { spans, total } = formattedSpans(ctx.blocks);
    if (!spans.length) continue;
    const key = spanKey(spans);
    const formatted = spans.reduce((sum, s) => sum + s.text.length, 0);
    const quoted = (s) => `"${s.text}"`;

    if (
      spans.length > FORMAT_MAX_SPANS ||
      formatted / Math.max(total, 1) > FORMAT_MAX_SHARE
    ) {
      error(
        "E_FORMAT_HEAVY",
        key,
        ctx.number,
        `${ctx.label}'s text has ${spans.length} formatted span${spans.length === 1 ? "" : "s"} ` +
          `(${spans.slice(0, 4).map(quoted).join(", ")}${spans.length > 4 ? ", ..." : ""}). ` +
          "Leave lesson prose plain: formatting scattered through a passage makes it look bloated and " +
          "machine-written, and ALL CAPS already marks the vocabulary. Keep only formatting a convention " +
          `requires (italics for a book's title or a scientific name), at most ${FORMAT_MAX_SPANS} spans a section.`,
        // Either limit trips this, and the fix differs: fewer spans, or shorter
        // ones. `tooMany` says which, so a UI doesn't cite the span limit to
        // someone already under it.
        spanDetail(spans, {
          count: spans.length,
          max: FORMAT_MAX_SPANS,
          tooMany: spans.length > FORMAT_MAX_SPANS,
        }),
      );
    }

    for (const span of spans) {
      const words = span.text.split(/\s+/).length;
      const emphatic =
        span.marks.includes("bold") || span.marks.includes("underline");
      if (emphatic && words > FORMAT_MAX_EMPHASIS_WORDS) {
        error(
          "E_FORMAT_LONG_EMPHASIS",
          spanKey([span]),
          ctx.number,
          `${ctx.label}: "${span.text}" is ${span.marks.includes("bold") ? "bold" : "underlined"} across ` +
            `${words} words. Don't bold or underline a phrase or a sentence; write it plain, and let the ` +
            "wording carry the weight.",
          spanDetail([span], {
            text: span.text,
            words,
            bold: span.marks.includes("bold"),
          }),
        );
      } else if (!emphatic && words > FORMAT_MAX_ITALIC_WORDS) {
        error(
          "E_FORMAT_LONG_ITALIC",
          spanKey([span]),
          ctx.number,
          `${ctx.label}: "${span.text}" is italic across ${words} words. Italics are for a title or a ` +
            "term, not a sentence; write it plain.",
          spanDetail([span], { text: span.text, words }),
        );
      }
    }

    const bold = spans.filter((s) => s.marks.includes("bold"));
    if (bold.length) {
      warn(
        "W_FORMAT_BOLD",
        spanKey(bold),
        ctx.number,
        `${ctx.label} uses bold (${bold.map(quoted).join(", ")}). ` +
          "Bold is almost never needed in a lesson: ALL CAPS already marks the words being learned. " +
          "Remove it unless the user asked for it.",
        spanDetail(bold),
      );
    }
    const underlined = spans.filter((s) => s.marks.includes("underline"));
    if (underlined.length) {
      warn(
        "W_FORMAT_UNDERLINE",
        spanKey(underlined),
        ctx.number,
        `${ctx.label} uses underlining (${underlined.map(quoted).join(", ")}). ` +
          "On screen it reads as a link that goes nowhere. Remove it unless the user asked for it.",
        spanDetail(underlined),
      );
    }
    const capsFormatted = spans.filter(
      (s) => /^[\p{Lu}\s'’-]+$/u.test(s.text) && /\p{Lu}{2}/u.test(s.text),
    );
    if (capsFormatted.length) {
      warn(
        "W_FORMAT_CAPS",
        spanKey(capsFormatted),
        ctx.number,
        `${ctx.label} formats ALL-CAPS vocabulary (${capsFormatted.map(quoted).join(", ")}). ` +
          "The capitals already mark it; formatting it as well is doubling up.",
        spanDetail(capsFormatted),
      );
    }
  }
}

// A footnote citing a source the lesson doesn't list would print as "Source no
// longer listed", which is never what was meant.
function checkCitations(doc, context, error) {
  const known = new Set(
    (Array.isArray(doc?.sources) ? doc.sources : []).map((s) => s?.id),
  );
  for (const ctx of context) {
    for (const block of ctx.blocks.filter((b) => b?.type === "text")) {
      for (const footnote of textBlockFootnotes(block)) {
        if (!footnote.sourceId || known.has(footnote.sourceId)) continue;
        error(
          "E_UNKNOWN_SOURCE",
          footnote.sourceId,
          ctx.number,
          `${ctx.label} cites "@${footnote.sourceId}", which is not one of the lesson's sources. ` +
            'Add it to `sources` (with that id) or fix the id in the "^[@id]" footnote.',
          { blockId: block.id, params: { sourceId: footnote.sourceId } },
        );
      }
    }
  }
}

/** Whether a finding is one of the formatting checks above. */
export function isFormattingFinding(finding) {
  return /^[EW]_FORMAT_/.test(finding.code);
}
