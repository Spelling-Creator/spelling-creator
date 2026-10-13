// The formula node for the lesson text editor (LessonTextInput.jsx).
//
// An inline atom, like a footnote: it sits in a sentence as one thing, is
// selected and deleted as one, and has no editable text of its own. Its
// attributes are the four the stored document carries (see
// @spelling-creator/core/lessonText): `format`, `source`, `display` and
// `spoken`. It is drawn by the Formula component, through a React node view,
// so the editor shows the same typesetting the lesson page does.

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import FormulaNodeView from "../components/editor/FormulaNodeView.jsx";

export const FormulaNode = Node.create({
  name: "math",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      format: {
        default: "asciimath",
        parseHTML: (el) => el.getAttribute("data-format") || "asciimath",
        renderHTML: (attrs) => ({ "data-format": attrs.format }),
      },
      source: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-source") || "",
        renderHTML: (attrs) => ({ "data-source": attrs.source }),
      },
      display: {
        default: false,
        parseHTML: (el) => el.getAttribute("data-display") === "true",
        renderHTML: (attrs) =>
          attrs.display ? { "data-display": "true" } : {},
      },
      // Spoken text is a string or a list of runs; it travels as JSON.
      spoken: {
        default: null,
        parseHTML: (el) => {
          const raw = el.getAttribute("data-spoken");
          if (!raw) return null;
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        },
        renderHTML: (attrs) =>
          attrs.spoken ? { "data-spoken": JSON.stringify(attrs.spoken) } : {},
      },
    };
  },

  // The data attributes are what let a formula survive being copied from one
  // text block and pasted into another.
  parseHTML() {
    return [{ tag: "span[data-formula]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-formula": "",
        class: "lesson-formula",
      }),
      node.attrs.source,
    ];
  },

  // Copied as text, a formula is its source.
  renderText({ node }) {
    return node.attrs.source;
  },

  addNodeView() {
    return ReactNodeViewRenderer(FormulaNodeView);
  },
});
