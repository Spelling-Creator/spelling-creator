// A formula in lesson text, drawn with MathJax.
//
// Until MathJax has rendered it (and wherever it can't: the server, a
// notation it doesn't know, a load that failed) the formula shows as its
// source, which is what the format says to show in its place. The server
// renders the source, and the client swaps in the typeset SVG once it has it.
//
// Nothing here goes near innerHTML. MathJax hands back DOM nodes it built
// from the parsed formula, and they are put in the page as nodes; the
// author's text only ever reaches the page as text.
//
// For a screen reader, the SVG is hidden and the formula's MathML stands
// beside it, visually hidden, which readers know how to say. In the editor
// the source stands there instead (`assistive="source"`): the collaboration
// cursors count characters over the block's plain text, in which a formula is
// its source, so the editor's copy of a formula has to hold exactly that.

import { useEffect, useRef } from "react";
import { cn } from "../lib/utils.js";
import { useFormula } from "../lib/formulas.js";

// MathML as nodes, from the string MathJax serialized. It is MathJax's own
// output, built from the parse tree with every piece of text escaped.
function mathmlNode(mathml) {
  const parsed = new DOMParser().parseFromString(mathml, "application/xml");
  const math = parsed.documentElement;
  return math && math.localName === "math" ? document.adoptNode(math) : null;
}

/**
 * @param {object} props
 * @param {string} props.format
 * @param {string} props.source
 * @param {boolean} [props.display]
 * @param {"mathml" | "source"} [props.assistive]  What a screen reader is
 *   given: the MathML (the default), or the source.
 * @param {string} [props.className]
 */
export default function Formula({
  format,
  source,
  display = false,
  assistive = "mathml",
  className,
}) {
  const { status, node, mathml } = useFormula({ format, source, display });
  const holder = useRef(null);
  const reader = useRef(null);

  useEffect(() => {
    if (!holder.current) return;
    if (status !== "ready") {
      // A render on its way, or none: what the last formula left here goes,
      // so it isn't shown beside the new one's source.
      holder.current.replaceChildren();
      reader.current?.replaceChildren();
      return;
    }
    node.setAttribute("aria-hidden", "true");
    // MathJax marks where a long inline formula may wrap with elements that
    // hold a space. Text in the typeset formula would count toward the
    // block's plain text (see above), in which a formula is only its source,
    // so the spaces go; the wrap points stay.
    for (const brk of node.querySelectorAll("mjx-break")) {
      brk.textContent = "";
    }
    holder.current.replaceChildren(node);
    if (assistive === "mathml" && reader.current) {
      const math = mathmlNode(mathml);
      reader.current.replaceChildren(...(math ? [math] : []));
    }
  }, [status, node, mathml, assistive]);

  const ready = status === "ready";
  return (
    <span
      className={cn("lesson-formula", className)}
      data-display={display || undefined}
      data-status={status}
      title={source}
    >
      {/* The typeset formula, put here by the effect and by nothing else,
          so React never has to reconcile what MathJax built. */}
      <span ref={holder} className="lesson-formula-view" />
      {/* The source, until there is a typeset formula. */}
      {ready ? null : <span className="lesson-formula-source">{source}</span>}
      {/* The source behind the SVG, once there is an SVG: until then the
          visible source is the text, and it must not be there twice. */}
      {assistive === "source" ? (
        ready ? (
          <span className="sr-only">{source}</span>
        ) : null
      ) : (
        <span ref={reader} className="sr-only" />
      )}
    </span>
  );
}
