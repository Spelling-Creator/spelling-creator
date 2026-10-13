// The read-aloud pieces of the lesson text editor (LessonTextInput.jsx): the
// speech mark and the pause node, stored as @spelling-creator/core/lessonText
// describes.
//
// The speech mark says how the words under it are read aloud: in IPA, as
// other words (an alias), or one character at a time. It changes nothing about
// how they look in the lesson, so in the editor it is only a dotted underline
// with a tooltip, enough to show a hint is there and what it says. It is not
// inclusive, so typing at the end of a hinted word doesn't stretch the hint
// over the next one.
//
// A pause is an inline atom, like a footnote: selected and deleted as one, with
// no text of its own. It draws as an empty <span> labelled by CSS (see
// .lesson-pause in styles/globals.css), so its label never counts as text. The
// collaboration cursors count characters over the block's plain text
// (core/browser/presence.js), and a pause has none.

import { Mark, Node, mergeAttributes } from "@tiptap/core";

function dataAttribute(name) {
  return {
    default: null,
    parseHTML: (el) => el.getAttribute(`data-${name}`) || null,
    renderHTML: (attrs) => {
      const key = name.replace(/-(\w)/g, (_, c) => c.toUpperCase());
      return attrs[key] ? { [`data-${name}`]: attrs[key] } : {};
    },
  };
}

export const SpeechHint = Mark.create({
  name: "speech",
  inclusive: false,

  addOptions() {
    // describe(attrs) gives the tooltip, in the editor's language.
    return { describe: () => "" };
  },

  addAttributes() {
    return {
      ipa: dataAttribute("ipa"),
      alias: dataAttribute("alias"),
      sayAs: dataAttribute("say-as"),
    };
  },

  parseHTML() {
    return [{ tag: "span[data-speech]" }];
  },

  renderHTML({ mark, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-speech": "",
        class: "lesson-speech",
        title: this.options.describe(mark.attrs),
      }),
      0,
    ];
  },
});

export const Pause = Node.create({
  name: "pause",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    // label(length) gives what the chip says, in the editor's language.
    return { label: (length) => length };
  },

  addAttributes() {
    return {
      length: {
        default: "short",
        parseHTML: (el) =>
          el.getAttribute("data-pause") === "long" ? "long" : "short",
        renderHTML: (attrs) => ({ "data-pause": attrs.length }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-pause]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = this.options.label(node.attrs.length);
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "lesson-pause",
        "data-label": label,
        title: label,
      }),
    ];
  },

  // Copied as text, a pause is nothing: it only means something to a voice.
  renderText() {
    return "";
  },
});
