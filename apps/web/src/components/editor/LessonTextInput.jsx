// The editor for a lesson text block: tiptap, with bold, italics, underlining
// and footnotes, and nothing else.
//
// The schema matches what @spelling-creator/core/lessonText stores and every
// renderer draws: paragraphs of text runs, three marks, one footnote node.
// Headings, lists, links, code and line breaks inside a paragraph are switched
// off, so pasting them in leaves only their words.
//
// It behaves like the LiveTextarea it replaced (see lib/useLiveField.js):
// typing commits upstream about 200ms after a pause rather than on every
// keystroke, because each commit is broadcast to collaborators and recorded by
// version history, and a change that arrives from elsewhere (a collaborator, a
// restored version) is held off while you're in the block and applied once you
// leave it. Leaving only writes the block back if you actually changed it, so
// clicking into a block and out again never writes your stale copy over a
// collaborator's edit that arrived in between.
//
// What it commits is always a `content` document (withTextBlockDocument), even
// for a block nobody has formatted: the collaboration document merges a block
// key by key, and two people editing one block have to be writing the same key.

import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
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
import { useLessonSources } from "../../lib/lessonSources.jsx";
import LessonTextToolbar from "./LessonTextToolbar.jsx";

const COMMIT_DELAY = 200;

function contentKey(content) {
  return JSON.stringify(normalizeTextContent(content));
}

// Refuse dropped and pasted files, as the comment editor does: a text block
// holds words, and pictures have blocks of their own.
const EDITOR_PROPS = {
  handleDrop: (_view, event) => Boolean(event.dataTransfer?.files?.length),
  handlePaste: (_view, event) => Boolean(event.clipboardData?.files?.length),
};

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

  // The latest block and callback, for the commit that fires after a pause.
  const latest = useRef({ block, onChange });
  useEffect(() => {
    latest.current = { block, onChange };
  });
  const focused = useRef(false);
  // Whether there are local edits not yet committed. Set by typing (onUpdate
  // only fires for local changes: a change from elsewhere is applied with
  // emitUpdate off), cleared by a commit.
  const dirty = useRef(false);
  // A change from elsewhere arrived while focused and was held off.
  const held = useRef(false);
  const timer = useRef(null);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
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
      }),
      Placeholder.configure({ placeholder }),
      Footnote.configure({
        HTMLAttributes: { title: t("contentBlock.text.footnoteMarkerTitle") },
      }),
    ],
    [placeholder, t],
  );

  const commit = (editor) => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!dirty.current) return;
    dirty.current = false;
    const { block: current, onChange: emit } = latest.current;
    const json = editor.getJSON();
    if (contentKey(json) === contentKey(textBlockContent(current))) return;
    emit(withTextBlockDocument(current, json));
  };

  // Show the block as it now stands, if that isn't what the editor shows.
  const syncFromBlock = (editor) => {
    const incoming = textBlockContent(latest.current.block);
    if (contentKey(editor.getJSON()) !== contentKey(incoming)) {
      editor.commands.setContent(incoming, { emitUpdate: false });
    }
  };

  const editor = useEditor(
    {
      extensions,
      content: textBlockContent(block),
      editorProps: {
        ...EDITOR_PROPS,
        attributes: {
          class:
            "prose-editor lesson-text-editor min-h-16 px-3 py-2 text-sm outline-none",
          "aria-label": t("contentBlock.text.ariaLabel"),
          ...(collabField ? { "data-collab-field": collabField } : {}),
        },
        // Clicking a footnote selects it; open its form straight away.
        handleClickOn: (_view, _pos, node) => {
          if (node.type.name === "footnote") setFootnoteOpen(true);
          return false;
        },
      },
      onFocus: () => {
        focused.current = true;
      },
      onBlur: ({ editor }) => {
        focused.current = false;
        // Your edits go up; with none, catch up with anything held off while
        // you were in the block.
        if (dirty.current) commit(editor);
        else if (held.current) syncFromBlock(editor);
        held.current = false;
      },
      onUpdate: ({ editor }) => {
        dirty.current = true;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(editor), COMMIT_DELAY);
      },
    },
    [extensions],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // A change from elsewhere. Applied only while the block isn't being typed in,
  // and only when it really differs from what the editor shows, so a commit of
  // our own coming back round is a no-op rather than a cursor jump.
  useEffect(() => {
    if (!editor) return;
    const incoming = textBlockContent(block);
    if (contentKey(editor.getJSON()) === contentKey(incoming)) return;
    if (focused.current) held.current = true;
    else editor.commands.setContent(incoming, { emitUpdate: false });
  }, [editor, block]);

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
        />
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
