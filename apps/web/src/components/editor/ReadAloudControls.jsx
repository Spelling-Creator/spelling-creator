// The Read aloud button on a lesson text block's toolbar: how the selected
// words are said, and pauses.
//
// A hint covers the selected words (or, with the cursor inside a hinted word,
// that word's whole hint) and is one of three kinds: a pronunciation in the
// IPA, other words to say instead, or spelling the word out a character at a
// time. A pause goes in after the cursor or the selection, or, when a pause is
// selected, can be made longer or shorter or taken out. See
// lib/speechExtensions.js for how the editor stores and draws them.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useEditorState } from "@tiptap/react";
import { AudioLines } from "lucide-react";
import { normalizeSpeechHint } from "@spelling-creator/core/lessonText";
import { Toggle } from "../ui/toggle.jsx";
import { Button } from "../ui/button.jsx";
import { Separator } from "../ui/separator.jsx";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.jsx";
import { Input } from "../ui/input.jsx";
import { Field, FieldDescription, FieldLabel } from "../ui/field.jsx";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.jsx";

const KINDS = ["ipa", "alias", "spell"];

function kindOf(attrs) {
  if (attrs?.ipa) return "ipa";
  if (attrs?.alias) return "alias";
  if (attrs?.sayAs) return "spell";
  return "ipa";
}

function HintForm({ initial, editing, onSave, onRemove }) {
  const { t } = useTranslation("editorSections");
  const [kind, setKind] = useState(kindOf(initial));
  const [ipa, setIpa] = useState(initial?.ipa || "");
  const [alias, setAlias] = useState(initial?.alias || "");
  const hint =
    kind === "ipa"
      ? { ipa }
      : kind === "alias"
        ? { alias }
        : { sayAs: "characters" };
  const ready = Boolean(normalizeSpeechHint(hint));

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSave(hint);
      }}
    >
      <Field>
        <FieldLabel>{t("contentBlock.readAloud.hintLabel")}</FieldLabel>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={kind}
          onValueChange={(next) => next && setKind(next)}
          aria-label={t("contentBlock.readAloud.hintLabel")}
        >
          {KINDS.map((k) => (
            <ToggleGroupItem key={k} value={k}>
              {t(`contentBlock.readAloud.kinds.${k}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>

      {kind === "ipa" && (
        <Field>
          <FieldLabel htmlFor="speech-ipa">
            {t("contentBlock.readAloud.ipaLabel")}
          </FieldLabel>
          <Input
            id="speech-ipa"
            autoFocus
            lang="und-fonipa"
            placeholder="freɪˈnɛl"
            value={ipa}
            onChange={(e) => setIpa(e.target.value)}
          />
          <FieldDescription>
            {t("contentBlock.readAloud.ipaHelp")}
          </FieldDescription>
        </Field>
      )}
      {kind === "alias" && (
        <Field>
          <FieldLabel htmlFor="speech-alias">
            {t("contentBlock.readAloud.aliasLabel")}
          </FieldLabel>
          <Input
            id="speech-alias"
            autoFocus
            placeholder={t("contentBlock.readAloud.aliasPlaceholder")}
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
          />
          <FieldDescription>
            {t("contentBlock.readAloud.aliasHelp")}
          </FieldDescription>
        </Field>
      )}
      {kind === "spell" && (
        <p className="text-sm text-muted-foreground">
          {t("contentBlock.readAloud.spellHelp")}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        {editing ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={onRemove}
          >
            {t("contentBlock.readAloud.removeHint")}
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" size="sm" disabled={!ready}>
          {editing
            ? t("contentBlock.readAloud.update")
            : t("contentBlock.readAloud.addHint")}
        </Button>
      </div>
    </form>
  );
}

export default function ReadAloudControls({ editor, open, onOpenChange }) {
  const { t } = useTranslation("editorSections");
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      hint: editor.isActive("speech"),
      hintAttrs: editor.getAttributes("speech"),
      pause: editor.isActive("pause"),
      pauseLength: editor.getAttributes("pause").length,
      empty: editor.state.selection.empty,
      // Where the selection is, so the form starts afresh when it moves.
      at: `${editor.state.selection.from}-${editor.state.selection.to}`,
    }),
  });

  // Cleaned the way it will be stored (an IPA's slashes dropped, say), so the
  // editor shows what the lesson will hold.
  const saveHint = (attrs) => {
    const hint = normalizeSpeechHint(attrs);
    if (!hint) return;
    const chain = editor.chain().focus();
    if (state.hint && state.empty) chain.extendMarkRange("speech");
    chain
      .setMark("speech", { ipa: null, alias: null, sayAs: null, ...hint })
      .run();
    onOpenChange(false);
  };

  const removeHint = () => {
    editor.chain().focus().extendMarkRange("speech").unsetMark("speech").run();
    onOpenChange(false);
  };

  const insertPause = (length) => {
    const { to } = editor.state.selection;
    editor
      .chain()
      .focus()
      .setTextSelection(to)
      .insertContent({ type: "pause", attrs: { length } })
      .run();
    onOpenChange(false);
  };

  const setPauseLength = (length) => {
    editor.chain().focus().updateAttributes("pause", { length }).run();
  };

  const removePause = () => {
    editor.chain().focus().deleteSelection().run();
    onOpenChange(false);
  };

  // Words to hint: a selection, or the cursor inside a hint already there.
  const canHint = !state.pause && (state.hint || !state.empty);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Toggle
          size="sm"
          pressed={state.hint || state.pause}
          aria-label={t("contentBlock.readAloud.button")}
        >
          <AudioLines />
          <span className="text-xs">
            {t("contentBlock.readAloud.buttonShort")}
          </span>
        </Toggle>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="flex flex-col gap-3">
          {state.pause ? (
            <>
              <Field>
                <FieldLabel>
                  {t("contentBlock.readAloud.pauseLength")}
                </FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={state.pauseLength}
                  onValueChange={(next) => next && setPauseLength(next)}
                  aria-label={t("contentBlock.readAloud.pauseLength")}
                >
                  <ToggleGroupItem value="short">
                    {t("contentBlock.readAloud.short")}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="long">
                    {t("contentBlock.readAloud.long")}
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start text-destructive hover:text-destructive"
                onClick={removePause}
              >
                {t("contentBlock.readAloud.removePause")}
              </Button>
            </>
          ) : (
            <>
              {canHint ? (
                <HintForm
                  key={state.hint ? `hint-${state.at}` : "new"}
                  initial={state.hint ? state.hintAttrs : null}
                  editing={state.hint}
                  onSave={saveHint}
                  onRemove={removeHint}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("contentBlock.readAloud.selectFirst")}
                </p>
              )}
              <Separator />
              <Field>
                <FieldLabel>{t("contentBlock.readAloud.addPause")}</FieldLabel>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => insertPause("short")}
                  >
                    {t("contentBlock.readAloud.short")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => insertPause("long")}
                  >
                    {t("contentBlock.readAloud.long")}
                  </Button>
                </div>
                <FieldDescription>
                  {t("contentBlock.readAloud.pauseHelp")}
                </FieldDescription>
              </Field>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
