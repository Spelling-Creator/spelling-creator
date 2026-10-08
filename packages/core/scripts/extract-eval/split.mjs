// The section splitter lives in core (src/documentImport.js) because the
// import feature uses it. This keeps the experiment's entry point, with each
// section's text laid out exactly as the import hands it to the model
// (sectionPromptText), and passes on whether the rules found a lesson at all
// (`loose` is true when they did not, and the sections are the looser cut the
// model reads).

import {
  classifyLine,
  splitSections as splitCore,
} from "../../src/documentImport.js";
import { sectionPromptText } from "../../src/documentImportModel.js";

export { classifyLine };

/**
 * @param {string} text
 * @returns {{title: string, sections: Array<{heading: string, lines: string[], text: string}>, loose: boolean}}
 */
export function splitSections(text) {
  const { title, sections, loose } = splitCore(text);
  return {
    title,
    loose,
    sections: sections.map((section) => ({
      ...section,
      text: sectionPromptText(section),
    })),
  };
}
