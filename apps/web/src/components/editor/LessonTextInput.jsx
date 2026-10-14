// The editor for a lesson text block: tiptap, with bold, italics, underlining,
// footnotes, read-aloud hints and pauses, and formulas, and nothing else.
//
// The schema matches what @spelling-creator/core/lessonText stores and every
// renderer draws: paragraphs of text runs, three marks, one footnote node, the
// speech mark and pause node that only read-aloud uses, and the formula node.
// Headings, lists, links, code and line breaks inside a paragraph are switched
// off, so pasting them in leaves only their words.
//
// It commits the way the LiveTextarea it replaced did (see lib/useLiveEditor.js
// for the timing and what happens to a change from elsewhere). What it
// commits is always a `content` document (withTextBlockDocument), even for a
// block nobody has formatted: the collaboration document merges a block key
// by key, and two people editing one block have to be writing the same key.

import { useMemo, useState } from "react";
import { EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { useTranslation } from "react-i18next";
import {
  normalizeTextContent,
  textBlockContent,
  withTextBlockDocument,
} from "@spelling-creator/core/lessonText";
import { cn } from "../../lib/utils.js";
import { Footnote } from "../../lib/footnoteExtension.js";
import { Pause, SpeechHint } from "../../lib/speechExtensions.js";
import { FormulaNode } from "../../lib/formulaExtension.js";
import { useLessonSources } from "../../lib/lessonSources.jsx";
import { useLiveEditor } from "../../lib/useLiveEditor.js";
import LessonTextToolbar from "./LessonTextToolbar.jsx";

function contentKey(content) {
  return JSON.stringify(normalizeTextContent(content));
}

// Refuse dropped and pasted files, as the comment editor does: a text block
// holds words, and pictures have blocks of their own.
export const EDITOR_PROPS = {
  handleDrop: (_view, event) => Boolean(event.dataTransfer?.files?.length),
  handlePaste: (_view, event) => Boolean(event.clipboardData?.files?.length),
};

// What StarterKit is left with: paragraphs, the three marks, history and the
// keymap. Shared with the one-line editor (LessonLineInput.jsx).
export const STARTER_KIT_OPTIONS = {
  heading: false,
  blockquote: false,
  bulletList: false,
  orderedList: false,
  listItem: false,
  listKeymap: false,
  codeBlock: false,
  code: false,
  horizontalRule: false,
  hardBreak: false,
  strike: false,
  link: false,
};

/**
 * The read-aloud and formula extensions, with their labels in the editor's
 * language. Shared with the one-line editor.
 * @param {import("i18next").TFunction} t
 */
export function speechAndFormulaExtensions(t) {
  return [
    SpeechHint.configure({
      describe: (attrs) =>
        attrs.ipa
          ? t("contentBlock.readAloud.describeIpa", { ipa: attrs.ipa })
          : attrs.alias
            ? t("contentBlock.readAloud.describeAlias", {
                alias: attrs.alias,
              })
            : t("contentBlock.readAloud.describeSpell"),
    }),
    Pause.configure({
      label: (length) =>
        length === "long"
          ? t("contentBlock.readAloud.longPauseChip")
          : t("contentBlock.readAloud.shortPauseChip"),
    }),
    FormulaNode,
  ];
}

/**
 * @param {object} props
 * @param {object} props.block       The text block.
 * @param {(block: object) => void} props.onChange
 * @param {string} [props.placeholder]
 * @param {string} [props.collabField]  The block's data-collab-field.
 */
export default function LessonTextInput({
  block,
  onChange,
  placeholder = "",
  collabField,
}) {
  const { t } = useTranslation("editorSections");
  const { starts } = useLessonSources();
  const [footnoteOpen, setFootnoteOpen] = useState(false);
  const [readAloudOpen, setReadAloudOpen] = useState(false);
  const [formulaOpen, setFormulaOpen] = useState(false);

  const extensions = useMemo(
    () => [
      StarterKit.configure(STARTER_KIT_OPTIONS),
      Placeholder.configure({ placeholder }),
      Footnote.configure({
        HTMLAttributes: { title: t("contentBlock.text.footnoteMarkerTitle") },
      }),
      ...speechAndFormulaExtensions(t),
    ],
    [placeholder, t],
  );

  const content = useMemo(() => textBlockContent(block), [block]);

  const editor = useLiveEditor({
    content,
    contentKey,
    onCommit: (json) => onChange(withTextBlockDocument(block, json)),
    extensions,
    editorProps: {
      ...EDITOR_PROPS,
      attributes: {
        class:
          "prose-editor lesson-text-editor min-h-16 px-3 py-2 text-sm outline-none",
        "aria-label": t("contentBlock.text.ariaLabel"),
        ...(collabField ? { "data-collab-field": collabField } : {}),
      },
      // Clicking a footnote, a pause or a formula selects it; open its form
      // straight away.
      handleClickOn: (_view, _pos, node) => {
        if (node.type.name === "footnote") setFootnoteOpen(true);
        if (node.type.name === "pause") setReadAloudOpen(true);
        if (node.type.name === "math") setFormulaOpen(true);
        return false;
      },
    },
  });

  return (
    <div
      className={cn(
        "min-w-0 grow overflow-hidden rounded-md border border-input bg-transparent transition-[color,box-shadow] dark:bg-input/30",
        "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
      )}
      style={{ counterReset: `lesson-footnote ${starts.get(block.id) ?? 0}` }}
    >
      {editor && (
        <LessonTextToolbar
          editor={editor}
          footnoteOpen={footnoteOpen}
          onFootnoteOpenChange={setFootnoteOpen}
          readAloudOpen={readAloudOpen}
          onReadAloudOpenChange={setReadAloudOpen}
          formulaOpen={formulaOpen}
          onFormulaOpenChange={setFormulaOpen}
        />
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
