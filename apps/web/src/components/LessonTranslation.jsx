// The published lesson, translatable into the reader's language on their own
// device: a Translate action above the document, and the same two engines
// comment translation runs on (the browser's built-in Translator API, then an
// in-page model via transformers.js; see
// @spelling-creator/core/browser/translator). Nothing is sent to a server and
// nothing is stored: a translation is per-reader and per-visit, exactly like
// a translated comment.
//
// What differs from comments is the size of the thing being translated. A
// finished lesson runs to dozens of screens, and on the fallback engine that
// could mean minutes, so the lesson is translated a batch at a time in
// reading order (the title, then section by section; see
// lessonTranslationBatches) and every batch shows as soon as it lands. The
// reader starts reading a translated lesson from the top while the bottom is
// still arriving, instead of staring at a progress bar; the status line
// counts batches so they can see it moving, and Cancel keeps whatever point
// it reached from costing anything.
//
// Spelling words are never translated: they ARE the material (the lesson is
// "spell these words"), not prose around it. The note under a finished
// translation says so, so an untranslated word list doesn't read as a bug.
// Everything else a reader sees translates, answers and captions included,
// because this page exists for comprehension and nothing consumes what it
// shows: interactive mode and the DOCX/PDF exports always use the lesson as
// written.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { LanguagesIcon } from "lucide-react";
import { Button } from "./ui/button.jsx";
import { Progress } from "./ui/progress.jsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select.jsx";
import LessonView from "./LessonView.jsx";
import {
  SOURCE_LANGUAGE_ERROR,
  detectLanguage,
  sameTranslationLanguage,
  sourceLanguageChoices,
  translateBlocks,
  translationErrorMessage,
} from "@spelling-creator/core/browser/translator";
import {
  languageDisplayName,
  languageForTag,
} from "@spelling-creator/core/translationLanguages";
import {
  lessonLanguageSample,
  lessonTranslationBatches,
  sameTranslationSource,
} from "@spelling-creator/core/lessonTranslation";

export default function TranslatableLesson({ doc }) {
  const { t, i18n } = useTranslation("lesson");
  // The language the lesson translates into, and the one language names show
  // in: the reader's app language.
  const targetLanguage = i18n.resolvedLanguage || i18n.language || "en";
  const batches = useMemo(() => lessonTranslationBatches(doc), [doc]);
  const sourceLanguageOptions = useMemo(
    () =>
      sourceLanguageChoices(targetLanguage)
        .map((tag) => ({
          tag,
          name: languageDisplayName(tag, targetLanguage),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, targetLanguage)),
    [targetLanguage],
  );

  // The whole feature's state, one value since there is one lesson:
  //   null = untranslated (the Translate button shows)
  //   { status: "translating", map, done, total, progress, runId, previous }
  //   { status: "done", map, sourceLanguage, showOriginal, previous: null }
  //   { status: "picking", reason, previous }
  // `map` is lessonSegmentKey -> translated string, growing a batch at a time
  // while translating; LessonView renders whatever it covers so far.
  // `progress` is the 0-1 model-download fraction, 0 until a download actually
  // starts (most translations never need one). `previous` is the done-state
  // to put back when a picker is cancelled or a re-run fails, and `runId`
  // keeps a superseded run's late writes from landing (same pattern as
  // CommentsSection).
  const [state, setState] = useState(null);
  const abortRef = useRef(null);
  // Abort any in-flight translation (and its model download) on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  // A translation only means anything over the text it was made from, because
  // translated strings are keyed by position (lessonSegmentKey). Navigating to
  // another lesson unmounts this component and takes its state with it, but one
  // swap happens underneath a mounted page: LessonLayout re-fetches a
  // server-rendered lesson quietly once a signed-in reader's token resolves, and
  // hands down a brand-new document object holding the same lesson. So identity
  // can't be what decides: wiping on it would throw away the translation of a
  // reader who pressed Translate while that re-fetch was still in the air.
  // Comparing the text keeps a translation (and a run in flight) through that
  // swap, and drops one the document has moved out from under.
  const sourceRef = useRef(batches);
  useEffect(() => {
    const previous = sourceRef.current;
    sourceRef.current = batches;
    if (sameTranslationSource(previous, batches)) return;
    abortRef.current?.abort();
    abortRef.current = null;
    setState(null);
  }, [batches]);

  // Translate the lesson, batch by batch. Only ever runs from a click: the
  // built-in API wants a user gesture for downloads, and the fallback's
  // download is far too heavy to start uninvited. `pickedLanguage` (from the
  // source language picker) skips detection, which is only ever a guess.
  const handleTranslate = async (pickedLanguage = null) => {
    if (!abortRef.current) {
      abortRef.current = new AbortController();
    }
    const { signal } = abortRef.current;
    const runId = Symbol("lesson-translation");
    const patchRun = (patch) => {
      setState((prev) =>
        prev?.runId === runId ? { ...prev, ...patch } : prev,
      );
    };
    setState((prev) => {
      const previous = prev?.status === "done" ? prev : prev?.previous || null;
      return {
        status: "translating",
        map: new Map(),
        done: 0,
        total: batches.length,
        progress: 0,
        runId,
        previous,
      };
    });
    try {
      // Detection may itself download a model (the fallback's detector), so
      // it reports through the same progress line as the translation download.
      const sourceLanguage =
        pickedLanguage ||
        (await detectLanguage(lessonLanguageSample(batches), {
          signal,
          onDownloadProgress: (loaded) => patchRun({ progress: loaded }),
        }));
      if (signal.aborted) return;
      // Detection couldn't decide: ask the reader instead of giving up.
      if (!sourceLanguage) {
        patchRun({ status: "picking", reason: "undetected" });
        return;
      }
      // Already in the reader's language: say so rather than "translating" it
      // into itself. The guess may be wrong, so the toast offers the picker.
      if (sameTranslationLanguage(sourceLanguage, targetLanguage)) {
        setState((prev) =>
          prev?.runId === runId ? prev.previous || null : prev,
        );
        toast(t("lessonTranslation.alreadyInYourLanguage"), {
          action: {
            label: t("lessonTranslation.pickLanguage"),
            onClick: () => openLanguagePicker(),
          },
        });
        return;
      }
      const map = new Map();
      for (const segments of batches) {
        const { blocks } = await translateBlocks(
          segments.map((segment) => segment.text),
          {
            sourceLanguage,
            targetLanguage,
            signal,
            onDownloadProgress: (loaded) => patchRun({ progress: loaded }),
          },
        );
        if (signal.aborted) return;
        segments.forEach((segment, i) => map.set(segment.key, blocks[i]));
        // A fresh Map each batch, because React compares by identity.
        setState((prev) =>
          prev?.runId === runId
            ? { ...prev, map: new Map(map), done: prev.done + 1 }
            : prev,
        );
      }
      patchRun({
        status: "done",
        sourceLanguage,
        showOriginal: false,
        previous: null,
      });
    } catch (err) {
      // Back to the earlier translation if there was one, else untranslated.
      // Still only while the state belongs to this run.
      setState((prev) =>
        prev?.runId === runId ? prev.previous || null : prev,
      );
      // An abort is the reader cancelling or leaving, not a failure.
      if (signal.aborted || err?.name === "AbortError") return;
      // A source language translation can't use may just be a bad guess, so
      // let the reader pick the right one.
      toast(
        translationErrorMessage(err),
        err?.code === SOURCE_LANGUAGE_ERROR
          ? {
              action: {
                label: t("lessonTranslation.pickLanguage"),
                onClick: () => openLanguagePicker(),
              },
            }
          : undefined,
      );
    }
  };

  // Stop a run mid-lesson. The abort also reaches whichever model download is
  // in flight; the controller is dropped so the next run gets a fresh one.
  const cancelTranslating = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((prev) =>
      prev?.status === "translating" ? prev.previous || null : prev,
    );
  };

  // Show the source language picker in the bar. A translation already on
  // screen is kept as `previous`, so cancelling puts it back.
  const openLanguagePicker = () => {
    setState((prev) => {
      // Never interrupt a run in flight; its own outcome decides what's next.
      if (prev?.status === "translating") return prev;
      return {
        status: "picking",
        reason: "wrong",
        previous: prev?.status === "done" ? prev : null,
      };
    });
  };

  const cancelLanguagePicker = () => {
    setState((prev) =>
      prev?.status === "picking" ? prev.previous || null : prev,
    );
  };

  const translating = state?.status === "translating";
  const done = state?.status === "done";
  const picking = state?.status === "picking";
  // While translating, the partial map renders so finished sections read
  // translated already; "Show original" flips a finished translation back.
  const translation =
    translating || (done && !state.showOriginal) ? state.map : null;
  const lesson = (
    <div className="overflow-hidden rounded-panel border border-border bg-card">
      <LessonView doc={doc} translation={translation} />
    </div>
  );
  // A lesson with no translatable text (images only) gets no bar at all.
  if (!batches.length) return lesson;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
        {!state && (
          <Button variant="outline" size="sm" onClick={() => handleTranslate()}>
            <LanguagesIcon data-icon="inline-start" />
            {t("lessonTranslation.translate")}
          </Button>
        )}

        {translating && (
          <>
            <p className="text-xs text-muted-foreground">
              {t("lessonTranslation.translating", {
                done: state.done,
                total: state.total,
              })}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto min-w-0 px-1 py-0.5"
              onClick={cancelTranslating}
            >
              {t("lessonTranslation.cancel")}
            </Button>
            {/* Only appears when an engine has to fetch a model first; an
                instant translation never shows it. */}
            {state.progress > 0 && state.progress < 1 && (
              <div className="w-full">
                <p className="text-xs text-muted-foreground">
                  {t("lessonTranslation.downloadingTranslationModel", {
                    percent: Math.round(state.progress * 100),
                  })}
                </p>
                <Progress value={state.progress * 100} className="mt-1" />
              </div>
            )}
          </>
        )}

        {/* A translated lesson says what happened to it, and the toggle back.
            Both views keep the toggle, so flipping is never one-way. */}
        {done && (
          <>
            {!state.showOriginal && (
              <p className="text-xs text-muted-foreground">
                {t("lessonTranslation.translatedFrom", {
                  language: languageDisplayName(
                    state.sourceLanguage,
                    targetLanguage,
                  ),
                })}
              </p>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-auto min-w-0 px-1 py-0.5"
              onClick={() =>
                setState((prev) => ({
                  ...prev,
                  showOriginal: !prev.showOriginal,
                }))
              }
            >
              {state.showOriginal
                ? t("lessonTranslation.showTranslation")
                : t("lessonTranslation.showOriginal")}
            </Button>
            {/* Detection is a guess; the reader can overrule it. */}
            {!state.showOriginal && (
              <Button
                variant="ghost"
                size="sm"
                className="h-auto min-w-0 px-1 py-0.5"
                onClick={openLanguagePicker}
              >
                {t("lessonTranslation.wrongLanguage")}
              </Button>
            )}
          </>
        )}

        {/* Asking the reader which language the lesson is in, above the
            original text so they can see what they're choosing for. */}
        {picking && (
          <>
            <p className="text-xs text-muted-foreground">
              {state.reason === "undetected"
                ? t("lessonTranslation.couldNotDetectLanguage")
                : t("lessonTranslation.pickSourceLanguage")}
            </p>
            <Select
              value={languageForTag(state.previous?.sourceLanguage)?.tag}
              onValueChange={(tag) => handleTranslate(tag)}
            >
              <SelectTrigger
                size="sm"
                aria-label={t("lessonTranslation.sourceLanguageLabel")}
              >
                <SelectValue
                  placeholder={t("lessonTranslation.sourceLanguagePlaceholder")}
                />
              </SelectTrigger>
              <SelectContent position="popper" className="max-h-72">
                {sourceLanguageOptions.map(({ tag, name }) => (
                  <SelectItem key={tag} value={tag}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto min-w-0 px-1 py-0.5"
              onClick={cancelLanguagePicker}
            >
              {t("lessonTranslation.cancel")}
            </Button>
          </>
        )}
      </div>

      {lesson}

      {/* The reminder that the word lists and answers are meant to stay as
          written, shown only while a translation is on screen. */}
      {(done || translating) && !state.showOriginal && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("lessonTranslation.keepsOriginalWords")}
        </p>
      )}
    </div>
  );
}
