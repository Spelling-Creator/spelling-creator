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

import { useDeferredValue, useMemo } from "react";
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
  result.errors.forEach((f) => tally(f, "problems"));
  result.warnings.forEach((f) => tally(f, "suggestions"));
  return {
    problems: result.errors,
    suggestions: result.warnings,
    bySection,
  };
}

/**
 * The checks for the document being edited. Deferred, so a long lesson never
 * makes typing wait on them: React runs them once it has nothing more urgent to
 * render.
 */
export function useLessonChecks(doc) {
  const deferred = useDeferredValue(doc);
  return useMemo(() => checkLesson(deferred), [deferred]);
}

// Which wording a code takes, for the codes with more than one. i18next looks
// for `<code>_<context>` first and falls back to `<code>`.
function contextOf({ code, params }) {
  switch (code) {
    case "E_SPELLING_DUPLICATE":
      return params.otherSection == null ? "same" : undefined;
    case "E_ANSWER_WORD_REUSED":
      return params.otherAnswer ? "inside" : undefined;
    case "E_FORMAT_LONG_EMPHASIS":
      return params.bold ? "bold" : undefined;
    case "W_ORANGE_ANSWER_COUNT":
      return params.open ? "open" : undefined;
    case "W_WYR_SHAPE":
      return params.ors > 1 ? "many" : undefined;
    default:
      return undefined;
  }
}

/**
 * One finding in the editor's words.
 * @param {import("i18next").TFunction} t  Bound to the `checks` namespace.
 * @param {string} language                For joining lists ("A, B, and C").
 */
export function describeFinding(t, finding, language) {
  const params = finding.params || {};
  const list = (items) => {
    try {
      return new Intl.ListFormat(language, { type: "conjunction" }).format(
        items,
      );
    } catch {
      return items.join(", ");
    }
  };
  const quoted = (items = []) => list(items.map((item) => `"${item}"`));
  // The other question a collision names. "Section 1, question 2" read from
  // inside section 1 sends you looking for a section you're already in.
  const other =
    params.otherSection === finding.section
      ? t("otherHere", { question: params.otherQuestion })
      : t("otherElsewhere", {
          section: params.otherSection,
          question: params.otherQuestion,
        });
  return t(`codes.${finding.code}`, {
    ...params,
    context: contextOf(finding),
    answers: quoted(params.answers),
    spans: quoted(params.spans),
    leaks: list((params.leaks || []).map((leak) => t("leak", leak))),
    other,
  });
}
