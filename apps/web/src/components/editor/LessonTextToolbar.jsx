// The toolbar over a lesson text block: bold, italic, underline, and the
// footnote button.
//
// The footnote button inserts a footnote after the cursor (or after the
// selected words), or, when a footnote is selected, edits that one. A footnote
// can cite one of the lesson's sources, carry a note of its own, or both; a
// source that isn't in the list yet can be added from here without leaving the
// sentence you're writing.

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEditorState } from "@tiptap/react";
import { Bold, Italic, Underline, MessageSquarePlus } from "lucide-react";
import { Toggle } from "../ui/toggle.jsx";
import { Button } from "../ui/button.jsx";
import { Separator } from "../ui/separator.jsx";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.jsx";
import { Input } from "../ui/input.jsx";
import { Textarea } from "../ui/textarea.jsx";
import { Field, FieldLabel } from "../ui/field.jsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.jsx";
import { useLessonSources } from "../../lib/lessonSources.jsx";

// The Select's value for "this footnote cites nothing".
const NO_SOURCE = "__none__";

function sourceLabel(source, t) {
  return (
    (source.title || "").trim() ||
    (source.url || "").trim() ||
    (source.author || "").trim() ||
    t("contentBlock.footnote.untitledSource")
  );
}

function MarkButton({ pressed, onPressedChange, label, icon: Icon }) {
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

// The little form for adding a source from inside a footnote: the three fields
// that identify most sources. The rest can be filled in under Sources.
function NewSourceFields({ onAdd, onCancel }) {
  const { t } = useTranslation("editorSections");
  const [draft, setDraft] = useState({ title: "", author: "", url: "" });
  const set = (field) => (e) =>
    setDraft((d) => ({ ...d, [field]: e.target.value }));
  const ready = Boolean(draft.title.trim() || draft.url.trim());
  const add = () =>
    onAdd({
      title: draft.title.trim(),
      author: draft.author.trim(),
      url: draft.url.trim(),
    });

  // These fields sit inside the footnote's own form, so Enter would submit the
  // footnote and lose the half-typed source. Here it adds the source instead.
  const onKeyDown = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (ready) add();
  };

  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-border p-2"
      onKeyDown={onKeyDown}
    >
      <Input
        autoFocus
        placeholder={t("sources.fields.title")}
        aria-label={t("sources.fields.title")}
        value={draft.title}
        onChange={set("title")}
      />
      <Input
        placeholder={t("sources.fields.author")}
        aria-label={t("sources.fields.author")}
        value={draft.author}
        onChange={set("author")}
      />
      <Input
        type="url"
        inputMode="url"
        placeholder={t("sources.fields.urlPlaceholder")}
        aria-label={t("sources.fields.url")}
        value={draft.url}
        onChange={set("url")}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("contentBlock.footnote.cancel")}
        </Button>
        <Button type="button" size="sm" disabled={!ready} onClick={add}>
          {t("contentBlock.footnote.addSource")}
        </Button>
      </div>
    </div>
  );
}

function FootnoteForm({ initial, editing, onSave, onRemove }) {
  const { t } = useTranslation("editorSections");
  const { sources, addSource } = useLessonSources();
  const [sourceId, setSourceId] = useState(initial.sourceId || NO_SOURCE);
  const [locator, setLocator] = useState(initial.locator || "");
  const [note, setNote] = useState(initial.note || "");
  const [adding, setAdding] = useState(false);
  // Where focus goes once a new source is added: the fields it was in are gone.
  const sourceTrigger = useRef(null);

  const cites = sourceId !== NO_SOURCE;
  const ready = cites || Boolean(note.trim());

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        onSave({
          sourceId: cites ? sourceId : null,
          locator: cites ? locator.trim() : "",
          note: note.trim(),
        });
      }}
    >
      <Field>
        <FieldLabel>{t("contentBlock.footnote.sourceLabel")}</FieldLabel>
        {/* Empty values are ignored: picking a source the moment it is added
            (below) runs ahead of its option, Radix's hidden native <select>
            falls back to "", and Radix reports that as a change, which would
            otherwise quietly drop the source from the footnote. No real
            option is empty. */}
        <Select
          value={sourceId}
          onValueChange={(next) => next && setSourceId(next)}
        >
          <SelectTrigger
            ref={sourceTrigger}
            size="sm"
            aria-label={t("contentBlock.footnote.sourceLabel")}
          >
            {/* Named explicitly: a source added from this form is picked
                before its option exists, and Radix shows nothing for a value
                it hasn't seen an option for. */}
            <SelectValue>
              {cites
                ? sourceLabel(
                    sources.find((source) => source.id === sourceId) || {},
                    t,
                  )
                : t("contentBlock.footnote.noSource")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_SOURCE}>
              {t("contentBlock.footnote.noSource")}
            </SelectItem>
            {sources.map((source) => (
              <SelectItem key={source.id} value={source.id}>
                {sourceLabel(source, t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {adding ? (
          <NewSourceFields
            onCancel={() => setAdding(false)}
            onAdd={(fields) => {
              const id = addSource(fields);
              if (id) setSourceId(id);
              setAdding(false);
              requestAnimationFrame(() => sourceTrigger.current?.focus());
            }}
          />
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => setAdding(true)}
          >
            {t("contentBlock.footnote.newSource")}
          </Button>
        )}
      </Field>

      {cites && (
        <Field>
          <FieldLabel htmlFor="footnote-locator">
            {t("contentBlock.footnote.locatorLabel")}
          </FieldLabel>
          <Input
            id="footnote-locator"
            placeholder={t("contentBlock.footnote.locatorPlaceholder")}
            value={locator}
            onChange={(e) => setLocator(e.target.value)}
          />
        </Field>
      )}

      <Field>
        <FieldLabel htmlFor="footnote-note">
          {cites
            ? t("contentBlock.footnote.noteLabelOptional")
            : t("contentBlock.footnote.noteLabel")}
        </FieldLabel>
        <Textarea
          id="footnote-note"
          className="min-h-16"
          placeholder={t("contentBlock.footnote.notePlaceholder")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>

      <div className="flex items-center justify-between gap-2">
        {editing ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={onRemove}
          >
            {t("contentBlock.footnote.remove")}
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" size="sm" disabled={!ready}>
          {editing
            ? t("contentBlock.footnote.update")
            : t("contentBlock.footnote.insert")}
        </Button>
      </div>
    </form>
  );
}

export default function LessonTextToolbar({
  editor,
  footnoteOpen,
  onFootnoteOpenChange,
}) {
  const { t } = useTranslation("editorSections");
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      footnote: editor.isActive("footnote"),
      footnoteAttrs: editor.getAttributes("footnote"),
      // Which footnote is selected, by position, so the form below starts
      // afresh when the selection moves to another one with the form open.
      footnotePos: editor.isActive("footnote")
        ? editor.state.selection.from
        : null,
    }),
  });

  const save = (attrs) => {
    if (state.footnote) {
      editor.chain().focus().updateAttributes("footnote", attrs).run();
    } else {
      // After the selection rather than over it: selected words are where the
      // footnote belongs, not what it replaces.
      const { to } = editor.state.selection;
      editor
        .chain()
        .focus()
        .setTextSelection(to)
        .insertContent({ type: "footnote", attrs })
        .run();
    }
    onFootnoteOpenChange(false);
  };

  const remove = () => {
    editor.chain().focus().deleteSelection().run();
    onFootnoteOpenChange(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border p-1">
      <MarkButton
        pressed={state.bold}
        onPressedChange={() => editor.chain().focus().toggleBold().run()}
        label={t("contentBlock.text.bold")}
        icon={Bold}
      />
      <MarkButton
        pressed={state.italic}
        onPressedChange={() => editor.chain().focus().toggleItalic().run()}
        label={t("contentBlock.text.italic")}
        icon={Italic}
      />
      <MarkButton
        pressed={state.underline}
        onPressedChange={() => editor.chain().focus().toggleUnderline().run()}
        label={t("contentBlock.text.underline")}
        icon={Underline}
      />

      <Separator orientation="vertical" className="mx-1 h-6" />

      <Popover open={footnoteOpen} onOpenChange={onFootnoteOpenChange}>
        <PopoverTrigger asChild>
          <Toggle
            size="sm"
            pressed={state.footnote}
            aria-label={
              state.footnote
                ? t("contentBlock.footnote.editButton")
                : t("contentBlock.footnote.addButton")
            }
          >
            <MessageSquarePlus />
            <span className="text-xs">
              {state.footnote
                ? t("contentBlock.footnote.editButtonShort")
                : t("contentBlock.footnote.addButtonShort")}
            </span>
          </Toggle>
        </PopoverTrigger>
        <PopoverContent className="w-80" align="start">
          <FootnoteForm
            key={state.footnote ? `footnote-${state.footnotePos}` : "new"}
            initial={state.footnote ? state.footnoteAttrs : {}}
            editing={state.footnote}
            onSave={save}
            onRemove={remove}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
