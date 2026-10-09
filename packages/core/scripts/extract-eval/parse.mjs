// The rule-based parser now lives in core (src/documentImport.js) because the
// import feature uses it. This keeps the experiment's entry point: a section's
// chunk in, the extraction shape out. The per-line model hook that once sat
// here was measured (docs: "Document import experiment", second pass) and lost
// to the heuristics, so it is gone.

import { parseSection as parseCore } from "../../src/documentImport.js";

/**
 * @param {{heading: string, lines: string[]}} chunk
 * @returns {{name: string, paragraphs: string[], spellingWords: string[], questions: object[], modelCalls: number}}
 */
export function parseSection(chunk) {
  const s = parseCore(chunk.lines, chunk.heading);
  return {
    name: s.name,
    paragraphs: s.paragraphs,
    spellingWords: s.spellingWords,
    questions: s.questions.map((q) => ({ ...q, type: "" })),
    modelCalls: 0,
  };
}
