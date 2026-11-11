// The formatting toolbar for RichTextInput.tsx: marks, two list types,
// blockquote, a link editor, and remove-formatting.
//
// The toolbar's link button opens a small popover to add, edit or remove a
// link for the current selection (or the link under the cursor, since
// Link.extendMarkRange covers that). Clicking a link in the text just places
// the cursor (openOnClick is false), so editing always goes through this one
// button.

import { useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  List,
  ListOrdered,
  Quote,
  Link2,
  RemoveFormatting,
} from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";

function useToolbarState(editor: Editor) {
  return useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      code: editor.isActive("code"),
      bulletList: editor.isActive("bulletList"),
      orderedList: editor.isActive("orderedList"),
      blockquote: editor.isActive("blockquote"),
      link: editor.isActive("link"),
      linkHref: String(editor.getAttributes("link").href ?? ""),
    }),
  });
}

function MarkButton({
  pressed,
  onPressedChange,
  label,
  icon: Icon,
}: {
  pressed: boolean;
  onPressedChange: () => void;
  label: string;
  icon: ComponentType;
}) {
  return (
    <Toggle
      size="sm"
      pressed={pressed}
      onPressedChange={onPressedChange}
      aria-label={label}
    >
      <Icon />
    </Toggle>
  );
}

function LinkButton({
  editor,
  active,
  href,
}: {
  editor: Editor;
  active: boolean;
  href: string;
}) {
  const { t } = useTranslation("richText");
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(href);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setUrl(href);
      }}
    >
      <PopoverTrigger asChild>
        <Toggle size="sm" pressed={active} aria-label={t("toolbar.link")}>
          <Link2 />
        </Toggle>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="start">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) {
              editor
                .chain()
                .focus()
                .extendMarkRange("link")
                .setLink({ href: url.trim() })
                .run();
            }
            setOpen(false);
          }}
        >
          <Input
            autoFocus
            type="url"
            placeholder={t("toolbar.linkUrlPlaceholder")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button type="submit" size="sm">
            {active ? t("toolbar.updateLink") : t("toolbar.addLink")}
          </Button>
        </form>
        {active && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 w-full text-destructive hover:text-destructive"
            onClick={() => {
              editor.chain().focus().extendMarkRange("link").unsetLink().run();
              setOpen(false);
            }}
          >
            {t("toolbar.removeLink")}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default function RichTextToolbar({ editor }: { editor: Editor }) {
  const { t } = useTranslation("richText");
  const state = useToolbarState(editor);

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border p-1.5">
      <MarkButton
        pressed={state.bold}
        onPressedChange={() => editor.chain().focus().toggleBold().run()}
        label={t("toolbar.bold")}
        icon={Bold}
      />
      <MarkButton
        pressed={state.italic}
        onPressedChange={() => editor.chain().focus().toggleItalic().run()}
        label={t("toolbar.italic")}
        icon={Italic}
      />
      <MarkButton
        pressed={state.underline}
        onPressedChange={() => editor.chain().focus().toggleUnderline().run()}
        label={t("toolbar.underline")}
        icon={UnderlineIcon}
      />
      <MarkButton
        pressed={state.strike}
        onPressedChange={() => editor.chain().focus().toggleStrike().run()}
        label={t("toolbar.strikethrough")}
        icon={Strikethrough}
      />
      <MarkButton
        pressed={state.code}
        onPressedChange={() => editor.chain().focus().toggleCode().run()}
        label={t("toolbar.code")}
        icon={Code}
      />

      <Separator orientation="vertical" className="mx-1 h-6" />

      <MarkButton
        pressed={state.bulletList}
        onPressedChange={() => editor.chain().focus().toggleBulletList().run()}
        label={t("toolbar.bulletList")}
        icon={List}
      />
      <MarkButton
        pressed={state.orderedList}
        onPressedChange={() => editor.chain().focus().toggleOrderedList().run()}
        label={t("toolbar.orderedList")}
        icon={ListOrdered}
      />
      <MarkButton
        pressed={state.blockquote}
        onPressedChange={() => editor.chain().focus().toggleBlockquote().run()}
        label={t("toolbar.quote")}
        icon={Quote}
      />

      <Separator orientation="vertical" className="mx-1 h-6" />

      {/* A link is the only thing a user may embed. The sanitizer keeps only
          http, https and mailto targets, and marks every one nofollow. */}
      <LinkButton editor={editor} active={state.link} href={state.linkHref} />

      <Separator orientation="vertical" className="mx-1 h-6" />

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("toolbar.removeFormatting")}
        onClick={() =>
          editor.chain().focus().unsetAllMarks().clearNodes().run()
        }
      >
        <RemoveFormatting />
      </Button>
    </div>
  );
}
