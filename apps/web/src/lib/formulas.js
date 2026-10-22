// Formulas on the page: each rendered once with MathJax, then drawn wherever
// it appears (the lesson page, the preview, interactive mode, the editor).
//
// MathJax is loaded the first time a formula is drawn, through the door in
// core/browser/formulas.ts, so a lesson without math never fetches it. A
// render is cached by the formula's key, and handed out as copies of its
// nodes, so the same formula in two places doesn't take one node from the
// other.

import { useEffect, useState } from "react";
import {
  formulaKey,
  loadFormulas,
} from "@spelling-creator/core/browser/formulas";

const cache = new Map();

/**
 * A formula rendered, from the cache or afresh: `{ node, mathml, error }`
 * (see createFormulaRenderer in core), or null for a notation MathJax
 * doesn't know, whose source is shown instead.
 * @param {{ format: string, source: string, display?: boolean }} formula
 * @returns {Promise<{ node: Element, mathml: string, error: boolean } | null>}
 */
export function renderFormula(formula) {
  const key = formulaKey(formula);
  let promise = cache.get(key);
  if (!promise) {
    promise = loadFormulas().then(({ renderFormula: render }) =>
      render(formula),
    );
    // A failed render isn't kept, so the next draw tries again.
    promise.catch(() => cache.delete(key));
    cache.set(key, promise);
  }
  return promise;
}

/**
 * The rendered formula, once MathJax has it: `{ status, node, mathml }`
 * where `status` is "loading", "ready" or "failed", and `node` a fresh copy
 * of the typeset SVG's container. Starts over when the formula changes.
 * @param {{ format: string, source: string, display?: boolean }} formula
 */
export function useFormula(formula) {
  const key = formulaKey(formula);
  const [state, setState] = useState({ key: null, status: "loading" });
  useEffect(() => {
    let active = true;
    renderFormula(formula).then(
      (rendered) => {
        if (!active) return;
        setState(
          rendered
            ? {
                key,
                status: "ready",
                node: rendered.node.cloneNode(true),
                mathml: rendered.mathml,
                error: rendered.error,
              }
            : { key, status: "failed" },
        );
      },
      (err) => {
        console.error("A formula couldn't be rendered.", err);
        if (active) setState({ key, status: "failed" });
      },
    );
    return () => {
      active = false;
    };
    // The key stands for the formula's three fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state : { key, status: "loading" };
}
