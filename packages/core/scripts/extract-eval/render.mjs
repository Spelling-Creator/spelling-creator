// The app's own Word export, read back as raw text the way a generic Word
// importer would see it: no section headings (the printed lesson runs
// straight through), question types carried only by colour (so invisible
// here), answers after a gap on the question line. The typed-up layouts live
// in layouts.mjs.

import { Packer } from "docx";
import mammoth from "mammoth";

import { buildDocument } from "../../src/browser/docxExport.js";

// Pictures need an image store or the API; the text is what we're after.
export function withoutPictures(doc) {
  return {
    ...doc,
    sections: doc.sections.map((section) => ({
      ...section,
      blocks: section.blocks
        .filter((block) => block.type !== "image")
        .map((block) =>
          block.type === "vakt"
            ? { ...block, image: undefined, src: undefined }
            : block,
        ),
    })),
  };
}

export async function renderDocxText(doc, meta = {}) {
  const document = await buildDocument(withoutPictures(doc), meta);
  const buffer = await Packer.toBuffer(document);
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}
