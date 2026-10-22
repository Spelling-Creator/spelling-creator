// Formulas rendered with MathJax: a lesson's AsciiMath or TeX source into
// MathML and into SVG.
//
// This module is HEAVY: MathJax's TeX and AsciiMath parsers, its SVG output
// and the font that output draws with (about half a megabyte compressed).
// Nothing may static-import it from the app: it is reached only through the
// dynamic import() in formulas.ts, and only for a lesson that has a formula.
// vite.config.js additionally stubs it out of the Worker's SSR build.
//
// It takes a DOM adaptor rather than making one, so the same renderer serves
// the browser (formulaBrowser.ts, with the real document) and the tests (with
// MathJax's own lite DOM under Node). Each renderer makes one MathJax document,
// and converts one formula at a time with it.
//
// What a formula can do is fenced in here. The TeX parser is given only the
// `base` and `ams` packages (what the format says producers should stick to),
// plus `noundefined` and `noerrors`, which show an unknown command or a parse
// error in red in place of the formula rather than failing. Without the
// `html` and `require` packages, `\href` and `\require` are just unknown
// commands: a formula cannot make a link, load an extension or run anything,
// as the format requires.

import { mathjax } from "@mathjax/src/mjs/mathjax.js";
import { TeX } from "@mathjax/src/mjs/input/tex.js";
import { AsciiMath } from "@mathjax/src/mjs/input/asciimath.js";
import { SVG } from "@mathjax/src/mjs/output/svg.js";
import { RegisterHTMLHandler } from "@mathjax/src/mjs/handlers/html.js";
import { STATE } from "@mathjax/src/mjs/core/MathItem.js";
import { SerializedMmlVisitor } from "@mathjax/src/mjs/core/MmlTree/SerializedMmlVisitor.js";
import { MathJaxNewcmFont } from "@mathjax/mathjax-newcm-font/mjs/svg.js";
import "@mathjax/src/mjs/input/tex/ams/AmsConfiguration.js";
import "@mathjax/src/mjs/input/tex/noundefined/NoUndefinedConfiguration.js";
import "@mathjax/src/mjs/input/tex/noerrors/NoErrorsConfiguration.js";
import type { DOMAdaptor } from "@mathjax/src/mjs/core/DOMAdaptor.js";
import type { MathDocument } from "@mathjax/src/mjs/core/MathDocument.js";
import type { MmlNode } from "@mathjax/src/mjs/core/MmlTree/MmlNode.js";

/** A formula to render: its notation, its source and its placement. */
export interface FormulaInput {
  format: string;
  source: string;
  display?: boolean;
}

/**
 * A rendered formula: MathJax's internal MathML tree (`root`), the same as a
 * MathML string, and the typeset SVG as a DOM node of the adaptor's kind (an
 * `mjx-container`). `error` says the source didn't parse cleanly, in which
 * case the SVG shows the problem in red.
 */
export interface RenderedFormula<N> {
  root: MmlNode;
  mathml: string;
  node: N;
  error: boolean;
}

export interface FormulaRenderer<N> {
  /** Null for a notation this doesn't know, whose source the caller shows as it is. */
  render(formula: FormulaInput): Promise<RenderedFormula<N> | null>;
  /** The stylesheet node the SVG output wants in the page, once. */
  styleSheet(): N;
}

// The format's names for the notations, and MathJax's for its input jax.
const INPUT_JAX: Partial<Record<string, string>> = {
  asciimath: "AsciiMath",
  tex: "TeX",
};

const TEX_PACKAGES = ["base", "ams", "noundefined", "noerrors"];

let handlerRegistered = false;

/**
 * A renderer for one DOM adaptor.
 *
 * @param adaptor  A MathJax DOM adaptor (browserAdaptor() in the browser,
 *   liteAdaptor() in tests).
 * @param options.document  The document the adaptor's nodes belong to: the
 *   browser's `document`, or nothing for the lite DOM.
 * @param options.inlineBreaks  Whether an inline formula is cut into pieces
 *   where a line may wrap (the default, right for a page). Off, a formula is
 *   always one SVG, which a picture of it needs.
 */
export function createFormulaRenderer<N, T, D>(
  adaptor: DOMAdaptor<N, T, D>,
  {
    document = "",
    inlineBreaks = true,
  }: { document?: D | string; inlineBreaks?: boolean } = {},
): FormulaRenderer<N> {
  // MathJax keeps one handler list for the page; the second renderer (the
  // browser makes one for pictures, tests make several) reuses the first's.
  if (!handlerRegistered) {
    RegisterHTMLHandler(adaptor);
    handlerRegistered = true;
  }
  const svg = new SVG<N, T, D>({
    fontData: MathJaxNewcmFont,
    fontCache: "local",
    linebreaks: { inline: inlineBreaks },
  });
  const html: MathDocument<N, T, D> = mathjax.document(document, {
    InputJax: [
      new TeX<N, T, D>({ packages: TEX_PACKAGES }),
      new AsciiMath<N, T, D>({}),
    ],
    OutputJax: svg,
  });
  const visitor = new SerializedMmlVisitor();

  return {
    async render({ format, source, display = false }) {
      const jax = INPUT_JAX[format];
      if (!jax) return null;
      const options = { format: jax, display: Boolean(display) };
      // Parsed twice: once stopping at the MathML tree, once all the way to
      // the SVG. Parsing is a millisecond or two; keeping one MathItem across
      // both would mean reaching into MathJax's document internals.
      // convertPromise is typed to give either; which one depends on `end`.
      const root = (await html.convertPromise(source, {
        ...options,
        end: STATE.CONVERT,
      })) as MmlNode;
      const mathml = visitor.visitTree(root);
      const node = (await html.convertPromise(source, options)) as N;
      return { root, mathml, node, error: mathml.includes("<merror") };
    },
    styleSheet() {
      return svg.styleSheet(html);
    },
  };
}
