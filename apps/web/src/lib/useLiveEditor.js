// A tiptap editor that commits the way the plain fields do (see
// useLiveField.js), for the lesson text editor (LessonTextInput.jsx) and the
// one-line editor a prompt or a step gets (LessonLineInput.jsx).
//
// Typing commits upstream about 200ms after a pause rather than on every
// keystroke, because each commit is broadcast to collaborators and recorded by
// version history, and a change that arrives from elsewhere (a collaborator, a
// restored version) is held off while you're in the field and applied once
// you leave it. Leaving only writes the field back if you actually changed it,
// so clicking into a field and out again never writes your stale copy over a
// collaborator's edit that arrived in between.
//
// `content` is the field as it now stands, as a document, and `contentKey`
// turns a document into the string two documents are compared by, so a commit
// of our own coming back round is a no-op rather than a cursor jump. `onCommit`
// gets the editor's JSON; what to store it as is the caller's business.

import { useEffect, useRef } from "react";
import { useEditor } from "@tiptap/react";

const COMMIT_DELAY = 200;

/**
 * @param {object} options
 * @param {object} options.content  The field's current document.
 * @param {(doc: object) => string} options.contentKey
 * @param {(json: object) => void} options.onCommit
 * @param {object[]} options.extensions
 * @param {object} [options.editorProps]
 * @param {Function} [options.onFocus]
 * @param {Function} [options.onBlur]
 * @returns {import("@tiptap/react").Editor | null}
 */
export function useLiveEditor({
  content,
  contentKey,
  onCommit,
  extensions,
  editorProps,
  onFocus,
  onBlur,
}) {
  // The latest content and callback, for the commit that fires after a pause.
  const latest = useRef({ content, onCommit });
  useEffect(() => {
    latest.current = { content, onCommit };
  });
  const focused = useRef(false);
  // Whether there are local edits not yet committed. Set by typing (onUpdate
  // only fires for local changes: a change from elsewhere is applied with
  // emitUpdate off), cleared by a commit.
  const dirty = useRef(false);
  // A change from elsewhere arrived while focused and was held off.
  const held = useRef(false);
  const timer = useRef(null);

  const commit = (editor) => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!dirty.current) return;
    dirty.current = false;
    const { content: current, onCommit: emit } = latest.current;
    const json = editor.getJSON();
    if (contentKey(json) === contentKey(current)) return;
    emit(json);
  };

  // Show the field as it now stands, if that isn't what the editor shows.
  const syncFromContent = (editor) => {
    const incoming = latest.current.content;
    if (contentKey(editor.getJSON()) !== contentKey(incoming)) {
      editor.commands.setContent(incoming, { emitUpdate: false });
    }
  };

  const editor = useEditor(
    {
      extensions,
      content,
      editorProps,
      onFocus: (props) => {
        focused.current = true;
        onFocus?.(props);
      },
      onBlur: (props) => {
        focused.current = false;
        // Your edits go up; with none, catch up with anything held off while
        // you were in the field.
        if (dirty.current) commit(props.editor);
        else if (held.current) syncFromContent(props.editor);
        held.current = false;
        onBlur?.(props);
      },
      onUpdate: ({ editor }) => {
        dirty.current = true;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(editor), COMMIT_DELAY);
      },
    },
    [extensions],
  );

  // Typing within the last 200ms is still waiting on its commit when the
  // editor goes away: the field unmounts (the page is left, a section folds)
  // or the editor is rebuilt (its extensions change with the language). Commit
  // it then rather than drop it. tiptap destroys an editor on a timeout, so
  // this instance can still be read here.
  useEffect(() => {
    if (!editor) return undefined;
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      if (dirty.current) commit(editor);
    };
    // commit reads everything it needs through refs, so the one captured with
    // this editor is never stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // A change from elsewhere. Applied only while the field isn't being typed
  // in, and only when it really differs from what the editor shows.
  useEffect(() => {
    if (!editor) return;
    if (contentKey(editor.getJSON()) === contentKey(content)) return;
    if (focused.current) held.current = true;
    else editor.commands.setContent(content, { emitUpdate: false });
    // contentKey is a pure function of its argument.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, content]);

  return editor;
}
