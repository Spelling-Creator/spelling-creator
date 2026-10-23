// MathJax on its own lite DOM: both notations into MathML and SVG, with the
// fence the format asks for (no links, no extensions, no code).

import { describe, expect, it } from "vitest";
import { liteAdaptor } from "@mathjax/src/mjs/adaptors/liteAdaptor.js";
import type {
  LiteElement,
  LiteNode,
} from "@mathjax/src/mjs/adaptors/lite/Element.js";

import {
  createFormulaRenderer,
  type FormulaInput,
  type RenderedFormula,
} from "./formulaEngine.ts";

const adaptor = liteAdaptor();
const renderer = createFormulaRenderer(adaptor);
// Every formula here is in a notation the renderer knows.
const render = async (formula: FormulaInput) =>
  (await renderer.render(formula))!;
// The lite adaptor's nodes are typed as LiteNode; a rendered one is the
// `mjx-container` element.
const svgOf = (rendered: RenderedFormula<LiteNode>) =>
  adaptor.outerHTML(rendered.node as LiteElement);
// MathJax serializes MathML pretty-printed; one line is easier to match.
const mathmlOf = (rendered: RenderedFormula<LiteNode>) =>
  rendered.mathml.replace(/\n\s*/g, "");

describe("createFormulaRenderer", () => {
  it("renders AsciiMath to MathML and an SVG", async () => {
    const rendered = await render({
      format: "asciimath",
      source: "120 xx 3 = 360",
    });
    expect(rendered.error).toBe(false);
    expect(mathmlOf(rendered)).toContain(
      "<mn>120</mn><mo>&#xD7;</mo><mn>3</mn>",
    );
    expect(svgOf(rendered)).toMatch(/^<mjx-container[^>]*><svg /);
    expect(rendered.root.kind).toBe("math");
  });

  it("renders TeX, on its own line when asked", async () => {
    const rendered = await render({
      format: "tex",
      source: "\\frac{60}{5} = 12",
      display: true,
    });
    expect(rendered.mathml).toContain('display="block"');
    expect(rendered.mathml).toContain("<mfrac");
    expect(svgOf(rendered)).toContain('display="true"');
  });

  it("knows no other notation", async () => {
    expect(
      await renderer.render({ format: "mathml", source: "<mi>x</mi>" }),
    ).toBe(null);
  });

  it("shows a TeX error in place of the formula, and says so", async () => {
    const rendered = await render({
      format: "tex",
      source: "\\frac{1}",
    });
    expect(rendered.error).toBe(true);
    expect(rendered.mathml).toContain("<merror");
  });

  it("gives a link or an extension no way in", async () => {
    const rendered = await render({
      format: "tex",
      source: "\\href{javascript:alert(1)}{x} \\require{html}",
    });
    const svg = svgOf(rendered);
    // The SVG's own xlink:href attributes point at its glyphs; no element in
    // it is a link, and nothing points at the script.
    expect(svg).not.toMatch(/<a[\s>]/);
    expect(svg).not.toMatch(/href="(?!#)/);
    expect(mathmlOf(rendered)).not.toMatch(/<a[\s>]/);
    // Both commands come through as what they are: unknown, in red.
    expect(mathmlOf(rendered)).toContain('mathcolor="red"');
  });
});
