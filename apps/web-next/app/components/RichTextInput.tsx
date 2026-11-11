// The rich-text editor used to write comments and bios, built on
// @tiptap/react. Both call sites get the same toolbar, the same limits and
// the same rules.
//
// No media, by design, and enforced three ways here:
//   - the toolbar has no image or media button, so nothing offers it;
//   - no Image (or other media) extension is registered, so the tiptap schema
//     has no node to put one in: a pasted <img> is dropped on the way in;
//   - EDITOR_PROPS refuses dropped and pasted files, which is what stops the
//     browser's default "inline this screenshot as a data: URI" behavior.
//
// None of that is the real boundary: a determined client can POST whatever
// HTML it likes. The Worker's sanitizer is what enforces the rule
// (apps/api/src/lib/richtext.js). This is the honest-user half, and exists so
// the UI never offers something the server would only strip back out.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useEditor, EditorContent, type EditorOptions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { cn } from "@/lib/utils";
import {
  isSafeLinkCandidate,
  richTextLength,
} from "@spelling-creator/core/richText";
import RichTextToolbar from "@/components/RichTextToolbar";

// The editable feature set: everything the sanitizer's allow-list keeps, and
// nothing it would only strip again on the way to the database.
//   - headings and horizontal rules are off: a comment is a paragraph
//   - code blocks are off; the inline `code` mark stays
//   - no media extension is registered at all (see the file header)
const BASE_EXTENSIONS = [
  StarterKit.configure({
    heading: false,
    horizontalRule: false,
    codeBlock: false,
    // Underline and Link ship inside StarterKit since tiptap v3; underline
    // needs no config, the link rules live here.
    link: {
      // Editing a link always goes through the toolbar's link popover;
      // clicking one inside the editor should place the cursor, not
      // navigate away mid-sentence.
      openOnClick: false,
      autolink: true,
      protocols: ["http", "https", "mailto"],
      // `protocols` only teaches autolink extra schemes, it restricts
      // nothing. This does: a link is only created if the server-side
      // policy would keep it, so the editor never shows a link (an ftp:
      // target, say) that the sanitizer would strip on save.
      isAllowedUri: (url, ctx) =>
        ctx.defaultValidate(url) &&
        isSafeLinkCandidate(url, ctx.defaultProtocol),
      HTMLAttributes: {
        target: "_blank",
        rel: "nofollow ugc noopener noreferrer",
      },
    },
  }),
];

// Refuse dropped and pasted files. Returning true tells ProseMirror the
// event is handled, so nothing is inserted and the browser doesn't fall back
// to its default.
const EDITOR_PROPS: EditorOptions["editorProps"] = {
  handleDrop: (_view, event) => Boolean(event.dataTransfer?.files?.length),
  handlePaste: (_view, event) => Boolean(event.clipboardData?.files?.length),
};

export default function RichTextInput({
  value,
  onChange,
  maxLength,
  label,
  placeholder = "",
  disabled = false,
  autoFocus = false,
}: {
  /**
   * Current HTML. Seeds the editor's initial content; tiptap owns the content
   * after mount, so remount (through a changing `key`) to force it back in
   * sync, which is how the comment box clears after posting.
   */
  value: string;
  onChange: (html: string) => void;
  /** Character budget, counted over the text the user wrote rather than the markup, so it matches what the server enforces. */
  maxLength: number;
  /** Accessible name for the editable area. */
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation("richText");

  // Count what the server counts, so the number the user sees is the number
  // that decides whether their comment is accepted.
  const length = richTextLength(value);
  const overLimit = length > maxLength;

  const extensions = useMemo(
    () => [...BASE_EXTENSIONS, Placeholder.configure({ placeholder })],
    [placeholder],
  );

  const editorProps = useMemo(
    () => ({
      ...EDITOR_PROPS,
      attributes: {
        class: "prose-editor min-h-24 px-3 py-2 text-sm outline-none",
        ...(label ? { "aria-label": label } : {}),
      },
    }),
    [label],
  );

  const editor = useEditor({
    extensions,
    content: value,
    editable: !disabled,
    editorProps,
    autofocus: autoFocus,
    // The editor renders in the browser only: its DOM is not server-rendered,
    // and a hydrating client has to agree with the server.
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  return (
    <div>
      <div
        className={cn(
          "overflow-hidden rounded-md border border-input transition-[color,box-shadow]",
          "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
          disabled && "opacity-50",
        )}
      >
        {editor && !disabled && <RichTextToolbar editor={editor} />}
        <EditorContent editor={editor} />
      </div>

      <p
        className={cn(
          "mt-1 text-right text-xs",
          overLimit ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {t("input.characterCount", { length, maxLength })}
      </p>
    </div>
  );
}
