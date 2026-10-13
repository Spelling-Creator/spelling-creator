// How a formula node looks inside the text editor: the same Formula component
// the lesson page uses, with the source behind it for the collaboration
// cursors (see Formula.jsx), in a wrapper tiptap can select.

import { NodeViewWrapper } from "@tiptap/react";
import { cn } from "../../lib/utils.js";
import Formula from "../Formula.jsx";

export default function FormulaNodeView({ node, selected }) {
  const { format, source, display } = node.attrs;
  return (
    <NodeViewWrapper
      as="span"
      className={cn(
        "lesson-formula-node",
        selected && "lesson-formula-node-selected",
      )}
      data-display={display || undefined}
    >
      <Formula
        format={format}
        source={source}
        display={display}
        assistive="source"
      />
    </NodeViewWrapper>
  );
}
