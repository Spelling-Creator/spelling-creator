// The editor for one line of lesson text: a question's prompt, or a step of a
// math question's working. The same tiptap schema as a text block's editor
// (LessonTextInput.jsx) with its footnotes left out and its document held to
// one paragraph, so Enter does nothing and a pasted passage lands as one line.
//
// It looks like the Input it replaced and commits the way that did (see
// lib/useLiveEditor.js). The toolbar is the text block's, without the
// footnote button, and it only shows while the line is being edited: a
// section has fifteen questions, and a toolbar over every one of them would
// bury the questions. Opening one of its forms counts as editing, since the
// form takes the focus with it.
//
// What it commits is the field in its stored shape (normalizeInlineText): the
// plain string when nothing in the line needs more, and the one-paragraph
// document otherwise.

import { useMemo, useState } from "react";
import { Node } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { useTranslation } from "react-i18next";
import {
  inlineTextContent,
  normalizeInlineText,
} from "@spelling-creator/core/inlineText";
import { cn } from "../../lib/utils.js";
import { useLiveEditor } from "../../lib/useLiveEditor.js";
import LessonTextToolbar from "./LessonTextToolbar.jsx";
import {
  EDITOR_PROPS,
  STARTER_KIT_OPTIONS,
  speechAndFormulaExtensions,
} from "./LessonTextInput.jsx";

// A document of exactly one paragraph, in place of StarterKit's.
const OneParagraph = Node.create({
  name: "doc",
  topNode: true,
  content: "paragraph",
});

function contentKey(value) {
  return JSON.stringify(normalizeInlineText(value));
}

/**
 * @param {object} props
 * @param {string | object} props.value  The field, in either stored shape.
 * @param {(value: string | object) => void} props.onChange  Gets the stored shape.
 * @param {string} props.label         What a screen reader calls the field.
 * @param {string} [props.placeholder]
 * @param {string} [props.id]
 * @param {string} [props.collabField]  The field's data-collab-field.
 * @param {string} [props.className]
 */
export default function LessonLineInput({
  value,
  onChange,
  label,
  placeholder = "",
  id,
  collabField,
  className,
}) {
  const { t } = useTranslation("editorSections");
  const [editing, setEditing] = useState(false);
  const [readAloudOpen, setReadAloudOpen] = useState(false);
  const [formulaOpen, setFormulaOpen] = useState(false);

  const extensions = useMemo(
    () => [
      OneParagraph,
      StarterKit.configure({ ...STARTER_KIT_OPTIONS, document: false }),
      Placeholder.configure({ placeholder }),
      ...speechAndFormulaExtensions(t),
    ],
    [placeholder, t],
  );

  const content = useMemo(() => inlineTextContent(value), [value]);

  const editor = useLiveEditor({
    content,
    contentKey,
    onCommit: (json) => onChange(normalizeInlineText(json)),
    extensions,
    editorProps: {
      ...EDITOR_PROPS,
      attributes: {
        class: "prose-editor lesson-line-editor px-3 py-1 text-sm outline-none",
        "aria-label": label,
        ...(id ? { id } : {}),
        ...(collabField ? { "data-collab-field": collabField } : {}),
      },
      // Clicking a pause or a formula selects it; open its form straight away.
      handleClickOn: (_view, _pos, node) => {
        if (node.type.name === "pause") setReadAloudOpen(true);
        if (node.type.name === "math") setFormulaOpen(true);
        return false;
      },
    },
    onFocus: () => setEditing(true),
    onBlur: () => setEditing(false),
  });

  // The toolbar stays while a form from it is open: the form is in a popover,
  // which takes the focus out of the line.
  const showToolbar = editing || readAloudOpen || formulaOpen;

  return (
    <div
      className={cn(
        "group min-w-0 grow overflow-hidden rounded-md border border-input bg-transparent transition-[color,box-shadow] dark:bg-input/30",
        "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        className,
      )}
    >
      <EditorContent editor={editor} />
      {editor && (
        <LessonTextToolbar
          editor={editor}
          footnotes={false}
          readAloudOpen={readAloudOpen}
          onReadAloudOpenChange={setReadAloudOpen}
          formulaOpen={formulaOpen}
          onFormulaOpenChange={setFormulaOpen}
          className={cn(
            "border-t border-b-0 group-focus-within:flex",
            !showToolbar && "hidden",
          )}
        />
      )}
    </div>
  );
}
