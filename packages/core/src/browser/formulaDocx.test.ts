// A rendered formula as a Word equation: the OMML the docx carries has to hold
// the formula's structure for what the builder knows, and its words for the
// rest.

import { describe, expect, it } from "vitest";
import { Document, Packer, Paragraph } from "docx";
import { unzipSync } from "fflate";
import { liteAdaptor } from "@mathjax/src/mjs/adaptors/liteAdaptor.js";

import { createFormulaRenderer } from "./formulaEngine.ts";
import { formulaToDocx } from "./formulaDocx.ts";

const renderer = createFormulaRenderer(liteAdaptor());

// The document's body XML, with the equation in it: a docx is a zip.
async function xmlOf(formula) {
  const { root } = await renderer.render(formula);
  const document = new Document({
    sections: [
      { children: [new Paragraph({ children: [formulaToDocx(root)] })] },
    ],
  });
  const zip = unzipSync(new Uint8Array(await Packer.toBuffer(document)));
  return new TextDecoder().decode(zip["word/document.xml"]);
}

describe("formulaToDocx", () => {
  it("writes a fraction, a power and a root as their equation parts", async () => {
    const xml = await xmlOf({
      format: "tex",
      source: "\\frac{60}{5} = 12, x^2, \\sqrt{81}",
    });
    expect(xml).toContain("<m:oMath>");
    expect(xml).toContain("<m:f>");
    expect(xml).toContain("<m:num>");
    expect(xml).toContain("<m:sSup>");
    expect(xml).toContain("<m:rad>");
    expect(xml).toContain("<m:t>60</m:t>");
    expect(xml).toContain("<m:t>=</m:t>");
  });

  it("keeps the words of what it doesn't lay out", async () => {
    const xml = await xmlOf({ format: "asciimath", source: "sum_(i=1)^n i" });
    for (const text of ["∑", "i", "=", "1", "n"]) {
      expect(xml).toContain(`<m:t>${text}</m:t>`);
    }
  });

  it("gives an empty part a space, since Word refuses an empty one", async () => {
    const xml = await xmlOf({ format: "tex", source: "\\frac{}{2}" });
    expect(xml).toContain("<m:num><m:r><m:t");
    expect(xml).not.toContain("<m:num></m:num>");
  });
});
