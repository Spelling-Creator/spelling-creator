// The Formula button on a lesson text block's toolbar.
//
// A formula is written in AsciiMath or LaTeX, sits in the sentence or on a
// line of its own, and can carry the words read-aloud should say for it when
// the speech made from it isn't right. The form shows the formula as it will
// look while it is typed. A new formula goes in after the cursor or the
// selected words; with a formula selected, the form edits that one.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useEditorState } from "@tiptap/react";
import { Sigma } from "lucide-react";
import { FORMULA_FORMATS } from "@spelling-creator/core/lessonText";
import { Toggle } from "../ui/toggle.jsx";
import { Button } from "../ui/button.jsx";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.jsx";
import { Input } from "../ui/input.jsx";
import { Textarea } from "../ui/textarea.jsx";
import { Field, FieldDescription, FieldLabel } from "../ui/field.jsx";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.jsx";
import Formula from "../Formula.jsx";

const PLACEHOLDERS = { asciimath: "120 xx 3 = 360", tex: "\\frac{60}{5} = 12" };

function spokenWords(spoken) {
  if (typeof spoken === "string") return spoken;
  if (!Array.isArray(spoken)) return "";
  return spoken
    .map((run) => (typeof run === "string" ? run : run?.text || ""))
    .join("");
}

function FormulaForm({ initial, editing, onSave, onRemove }) {
  const { t } = useTranslation("editorSections");
  const [format, setFormat] = useState(
    FORMULA_FORMATS.includes(initial?.format) ? initial.format : "asciimath",
  );
  const [source, setSource] = useState(initial?.source || "");
  const [display, setDisplay] = useState(Boolean(initial?.display));
  const [spoken, setSpoken] = useState(spokenWords(initial?.spoken));
  const trimmed = source.trim();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!trimmed) return;
        onSave({
          format,
          source: trimmed,
          display,
          spoken: spoken.trim() || null,
        });
      }}
    >
      <Field>
        <FieldLabel>{t("contentBlock.formula.formatLabel")}</FieldLabel>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={format}
          onValueChange={(next) => next && setFormat(next)}
          aria-label={t("contentBlock.formula.formatLabel")}
        >
          {FORMULA_FORMATS.map((f) => (
            <ToggleGroupItem key={f} value={f}>
              {t(`contentBlock.formula.formats.${f}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>

      <Field>
        <FieldLabel htmlFor="formula-source">
          {t("contentBlock.formula.sourceLabel")}
        </FieldLabel>
        <Textarea
          id="formula-source"
          autoFocus
          className="min-h-16 font-mono"
          placeholder={PLACEHOLDERS[format]}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          onKeyDown={(e) => {
            // Enter saves; a formula is one line.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <FieldDescription>
          {t(`contentBlock.formula.help.${format}`)}
        </FieldDescription>
      </Field>

      <div
        className="min-h-10 rounded-md border border-border px-3 py-2 text-base"
        aria-live="polite"
      >
        {trimmed ? (
          <Formula
            format={format}
            source={trimmed}
            display={display}
            assistive="source"
          />
        ) : (
          <span className="text-sm text-muted-foreground">
            {t("contentBlock.formula.previewEmpty")}
          </span>
        )}
      </div>

      <Field>
        <FieldLabel>{t("contentBlock.formula.placementLabel")}</FieldLabel>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={display ? "display" : "inline"}
          onValueChange={(next) => next && setDisplay(next === "display")}
          aria-label={t("contentBlock.formula.placementLabel")}
        >
          <ToggleGroupItem value="inline">
            {t("contentBlock.formula.inline")}
          </ToggleGroupItem>
          <ToggleGroupItem value="display">
            {t("contentBlock.formula.display")}
          </ToggleGroupItem>
        </ToggleGroup>
      </Field>

      <Field>
        <FieldLabel htmlFor="formula-spoken">
          {t("contentBlock.formula.spokenLabel")}
        </FieldLabel>
        <Input
          id="formula-spoken"
          placeholder={t("contentBlock.formula.spokenPlaceholder")}
          value={spoken}
          onChange={(e) => setSpoken(e.target.value)}
        />
        <FieldDescription>
          {t("contentBlock.formula.spokenHelp")}
        </FieldDescription>
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
            {t("contentBlock.formula.remove")}
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" size="sm" disabled={!trimmed}>
          {editing
            ? t("contentBlock.formula.update")
            : t("contentBlock.formula.insert")}
        </Button>
      </div>
    </form>
  );
}

export default function FormulaControls({ editor, open, onOpenChange }) {
  const { t } = useTranslation("editorSections");
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      formula: editor.isActive("math"),
      attrs: editor.getAttributes("math"),
      // Which formula is selected, by position, so the form starts afresh
      // when the selection moves to another one with the form open.
      at: editor.isActive("math") ? editor.state.selection.from : null,
    }),
  });

  const save = (attrs) => {
    if (state.formula) {
      editor.chain().focus().updateAttributes("math", attrs).run();
    } else {
      // After the selection rather than over it, as a footnote goes in.
      const { to } = editor.state.selection;
      editor
        .chain()
        .focus()
        .setTextSelection(to)
        .insertContent({ type: "math", attrs })
        .run();
    }
    onOpenChange(false);
  };

  const remove = () => {
    editor.chain().focus().deleteSelection().run();
    onOpenChange(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Toggle
          size="sm"
          pressed={state.formula}
          aria-label={
            state.formula
              ? t("contentBlock.formula.editButton")
              : t("contentBlock.formula.addButton")
          }
        >
          <Sigma />
          <span className="text-xs">
            {state.formula
              ? t("contentBlock.formula.editButtonShort")
              : t("contentBlock.formula.addButtonShort")}
          </span>
        </Toggle>
      </PopoverTrigger>
      <PopoverContent className="w-96" align="start">
        <FormulaForm
          key={state.formula ? `formula-${state.at}` : "new"}
          initial={state.formula ? state.attrs : null}
          editing={state.formula}
          onSave={save}
          onRemove={remove}
        />
      </PopoverContent>
    </Popover>
  );
}
