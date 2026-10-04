// The footnote node for the lesson text editor (LessonTextInput.jsx).
//
// An inline atom: it sits in a sentence like a character, is selected and
// deleted as one, and has no editable text of its own. What it says lives in
// its attributes, the same three the stored document carries (see
// @spelling-creator/core/lessonText): `sourceId`, `locator` and `note`.
//
// It draws as an empty <sup>. Its number comes from a CSS counter (see
// .lesson-footnote in styles/globals.css) that each text block's editor starts
// at the count of footnotes before it, so the markers read 1, 2, 3 across the
// whole lesson and renumber themselves the moment one is added or removed,
// with no code walking the document to work the numbers out.

import { Node, mergeAttributes } from "@tiptap/core";

function dataAttribute(name, fallback) {
  return {
    default: fallback,
    parseHTML: (el) => el.getAttribute(`data-${name}`) || fallback,
    renderHTML: (attrs) => {
      const key = name.replace(/-(\w)/g, (_, c) => c.toUpperCase());
      return attrs[key] ? { [`data-${name}`]: attrs[key] } : {};
    },
  };
}

export const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      sourceId: dataAttribute("source-id", null),
      locator: dataAttribute("locator", ""),
      note: dataAttribute("note", ""),
    };
  },

  // The data attributes are what let a footnote survive being copied from one
  // text block and pasted into another.
  parseHTML() {
    return [{ tag: "sup[data-footnote]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "sup",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-footnote": "",
        class: "lesson-footnote",
      }),
    ];
  },

  // Copied as text, a footnote is nothing: its number means nothing outside
  // the lesson.
  renderText() {
    return "";
  },
});
