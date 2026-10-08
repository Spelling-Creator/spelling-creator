// The section splitter now lives in core (src/documentImport.js) because the
// import feature uses it. This keeps the experiment's old entry point, with
// each section's lines joined back into the text the model strategy feeds in.

import {
  classifyLine,
  splitSections as splitCore,
} from "../../src/documentImport.js";

export { classifyLine };

/**
 * @param {string} text
 * @returns {{title: string, sections: Array<{heading: string, lines: string[], text: string}>}}
 */
export function splitSections(text) {
  const { title, sections } = splitCore(text);
  return {
    title,
    sections: sections.map(({ heading, lines }) => ({
      heading,
      lines,
      text: (heading ? [heading, ""] : [])
        .concat(lines.join("\n\n"))
        .join("\n"),
    })),
  };
}
