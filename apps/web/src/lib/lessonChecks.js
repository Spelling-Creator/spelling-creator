// The lesson checks, as the editor shows them.
//
// The checks themselves are @spelling-creator/core/lessonChecks, the same code
// the MCP server runs on every write, so an author and an assistant are held to
// one set of rules. Each finding there carries `message`, prose written for a
// model to act on ("call the tool again", field names in backticks), and
// `params`, the same facts as data. The editor ignores the first and words the
// second itself, from the `checks` namespace, so the text reads as written for
// a person and can be translated.
//
// Nothing here blocks anything. Errors become "problems" and warnings become
// "suggestions": a person writing a three-section lesson on purpose should see
// that it's unusual, and then be left alone.

import { useEffect, useState } from "react";
import { validateLesson } from "@spelling-creator/core/lessonChecks";

const EMPTY = Object.freeze({
  problems: [],
  suggestions: [],
  bySection: new Map(),
});

/**
 * Run the checks over a document.
 * @param {{ sections?: any[] }} doc
 * @returns {{ problems: any[], suggestions: any[], bySection: Map<string, { problems: number, suggestions: number }> }}
 */
export function checkLesson(doc) {
  // An empty lesson has nothing wrong with it yet, only a "0 sections" warning
  // that would greet everyone who opens the editor.
  if (!doc?.sections?.length) return EMPTY;
  let result;
  try {
    result = validateLesson(doc);
  } catch (err) {
    // The checks run on every edit, against a document the editor may be
    // halfway through changing. A bug in one must never take the editor down
    // with it; the cost is that the panel shows nothing until the next edit.
    console.error("Lesson checks failed", err);
    return EMPTY;
  }
  const { errors: problems, warnings: suggestions } = result;
  const bySection = new Map();
  const tally = (finding, field) => {
    if (!finding.sectionId) return;
    const entry = bySection.get(finding.sectionId) || {
      problems: 0,
      suggestions: 0,
    };
    entry[field] += 1;
    bySection.set(finding.sectionId, entry);
  };
  problems.forEach((f) => tally(f, "problems"));
  suggestions.forEach((f) => tally(f, "suggestions"));
  return { problems, suggestions, bySection };
}

// Everything a finding says, in one string, so two runs can be compared.
function signature({ problems, suggestions }) {
  return [...problems, ...suggestions]
    .map((f) => `${f.key}\u0000${f.blockId}\u0000${f.itemId}\u0000${f.message}`)
    .join("\u0001");
}

/** How long editing has to pause before the checks rerun. */
const SETTLE_MS = 300;

/**
 * The checks for the document being edited.
 *
 * Every edit produces a new `doc`, and the page that calls this is the whole
 * editor, so the cost to avoid is rendering that page again per keystroke, not
 * the checks themselves (about a millisecond on a full lesson). They rerun once
 * editing pauses, and the result only replaces the last one when a finding
 * actually changed: most edits (typing inside a passage, say) change none, and
 * cost no extra render at all.
 */
export function useLessonChecks(doc) {
  const [checks, setChecks] = useState(EMPTY);
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = checkLesson(doc);
      setChecks((prev) => (signature(prev) === signature(next) ? prev : next));
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [doc]);
  return checks;
}

/**
 * The codes with more than one wording, and when each applies. i18next looks
 * for `<code>_<context>` first and falls back to `<code>`, so every code here
 * needs its base wording as well as one per context (lessonChecks.test.js
 * checks both).
 */
export const CONTEXTS = {
  E_SPELLING_DUPLICATE: { same: (p) => p.otherSection == null },
  E_ANSWER_WORD_REUSED: { inside: (p) => Boolean(p.otherAnswer) },
  E_FORMAT_LONG_EMPHASIS: { bold: (p) => Boolean(p.bold) },
  E_FORMAT_HEAVY: { share: (p) => p.tooMany === false },
  W_ORANGE_ANSWER_COUNT: { open: (p) => Boolean(p.open) },
  W_WYR_SHAPE: { many: (p) => p.ors > 1 },
};

function contextOf({ code, params }) {
  const rules = CONTEXTS[code];
  if (!rules) return undefined;
  return Object.keys(rules).find((context) => rules[context](params));
}

// One formatter per language: describeFinding runs for every finding each time
// the panel renders.
const listFormats = new Map();
function formatList(language, items) {
  if (!listFormats.has(language)) {
    let format = null;
    try {
      format = new Intl.ListFormat(language, { type: "conjunction" });
    } catch {
      // An unknown tag; fall back to commas below.
    }
    listFormats.set(language, format);
  }
  const format = listFormats.get(language);
  return format ? format.format(items) : items.join(", ");
}

/**
 * One finding in the editor's words.
 * @param {import("i18next").TFunction} t  Bound to the `checks` namespace.
 * @param {string} language                For joining lists ("A, B, and C").
 */
export function describeFinding(t, finding, language) {
  const params = finding.params || {};
  const quoted = (items = []) =>
    formatList(
      language,
      items.map((item) => `"${item}"`),
    );
  const values = { ...params, context: contextOf(finding) };
  if (params.answers) values.answers = quoted(params.answers);
  if (params.spans) values.spans = quoted(params.spans);
  if (params.leaks) {
    values.leaks = formatList(
      language,
      params.leaks.map((leak) => t("leak", leak)),
    );
  }
  // The other question a collision names. "Section 1, question 2" read from
  // inside section 1 sends you looking for a section you're already in.
  if (params.otherQuestion != null) {
    values.other =
      params.otherSection === finding.section
        ? t("otherHere", { question: params.otherQuestion })
        : t("otherElsewhere", {
            section: params.otherSection,
            question: params.otherQuestion,
          });
  }
  return t(`codes.${finding.code}`, values);
}
