// The light half of formulas: which formulas a lesson has, and the one door to
// formulaBrowser.ts, which holds MathJax, its font and the speech rule engine
// and so is only ever fetched by a dynamic import(), the same split as
// readAloud.ts and readAloudEngine.ts.
//
// Nothing here loads anything until a lesson with a formula is drawn, exported
// or read aloud, so a lesson without math costs nothing extra.

import { inlineTextRuns } from "../inlineText.ts";
import { textBlockParagraphs, type TextBlockRun } from "../lessonText.ts";
import type { LessonDoc } from "../types.ts";
import type { FormulaImage } from "./formulaBrowser.ts";
import type { FormulaInput, RenderedFormula } from "./formulaEngine.ts";

export type { FormulaImage, FormulaInput, RenderedFormula };

/** What formulaBrowser.ts gives once it has loaded. */
export type FormulaEngine = typeof import("./formulaBrowser.ts");

/**
 * A formula of a lesson, rendered on the page for an export, with its PNG
 * when the export asked for pictures.
 */
export type LessonFormula = RenderedFormula<HTMLElement> & {
  png?: FormulaImage;
};

/**
 * A key for a formula, for caching what was made from it. Two formulas with
 * the same notation, source and placement render the same.
 */
export function formulaKey({ format, source, display }: FormulaInput): string {
  return `${format}|${display ? "display" : "inline"}|${source}`;
}

/** Every distinct formula in a lesson's text blocks, prompts and steps, by key. */
export function lessonFormulas(
  doc: Partial<LessonDoc> | null | undefined,
): Map<string, Required<FormulaInput>> {
  const out = new Map<string, Required<FormulaInput>>();
  const collect = (runs: TextBlockRun[]) => {
    for (const run of runs) {
      if (run.type !== "math") continue;
      const formula = {
        format: run.format,
        source: run.source,
        display: Boolean(run.display),
      };
      out.set(formulaKey(formula), formula);
    }
  };
  for (const section of doc?.sections || []) {
    for (const block of section.blocks || []) {
      if (block?.type === "text") {
        for (const paragraph of textBlockParagraphs(block)) collect(paragraph);
      } else if (block?.type === "question") {
        // A prompt and a step can hold a formula too (see inlineText.ts).
        collect(inlineTextRuns(block.prompt));
        for (const step of block.steps || []) {
          collect(inlineTextRuns(step?.text));
        }
      }
    }
  }
  return out;
}

let loading: Promise<FormulaEngine> | null = null;

/**
 * Load MathJax and the rest of formulaBrowser.ts. One load per page; a load
 * that fails can be tried again.
 */
export function loadFormulas(): Promise<FormulaEngine> {
  loading ??= import("./formulaBrowser.ts").catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

/**
 * Every formula in a lesson, rendered, for the Word and PDF exports. Null
 * when the lesson has none, so those exports never load MathJax for a lesson
 * without math. A formula that fails to render is left out, and the exports
 * print its source instead.
 *
 * @param options.images  Also rasterize each formula to a PNG (`png`: bytes,
 *   width and height in CSS pixels), for a file that can't hold an equation.
 */
export async function renderLessonFormulas(
  doc: Partial<LessonDoc> | null | undefined,
  { images = false }: { images?: boolean } = {},
): Promise<Map<string, LessonFormula> | null> {
  const wanted = lessonFormulas(doc);
  if (!wanted.size) return null;
  let engine: FormulaEngine;
  try {
    engine = await loadFormulas();
  } catch (err) {
    // No MathJax (offline, a chunk gone after a deploy): the file is still
    // made, with every formula as its source.
    console.warn("MathJax couldn't load; formulas are written as text.", err);
    return null;
  }
  const { renderFormula, formulaImage } = engine;
  const out = new Map<string, LessonFormula>();
  for (const [key, formula] of wanted) {
    try {
      const rendered = await renderFormula(formula);
      if (!rendered) continue;
      out.set(
        key,
        images ? { ...rendered, png: await formulaImage(formula) } : rendered,
      );
    } catch (err) {
      console.warn(`A formula couldn't be rendered: ${formula.source}`, err);
    }
  }
  return out;
}

const spoken = new Map<string, Promise<string | null>>();

/**
 * The words read-aloud says for a formula, made by the speech rule engine
 * from the MathML MathJax parses it into. Null for a formula that can't be
 * parsed, whose source is read instead. Each distinct formula is worked out
 * once per page.
 */
export function formulaWords(formula: FormulaInput): Promise<string | null> {
  const key = formulaKey(formula);
  let promise = spoken.get(key);
  if (!promise) {
    promise = loadFormulas().then(async ({ renderFormula, speakMathml }) => {
      const rendered = await renderFormula(formula);
      if (!rendered || rendered.error) return null;
      return (await speakMathml(rendered.mathml)) || null;
    });
    // A failure isn't kept, so asking again tries again.
    promise.catch(() => spoken.delete(key));
    spoken.set(key, promise);
  }
  return promise;
}
