// Ask AI to fix one lesson check finding, and show the fix before making it.
//
// The Worker does the asking (apps/api/src/lib/lessonFix.js) and only answers
// with a fix that passes the checks. The fix comes back as replace_block
// operations, and is checked again here against the lesson as it is now
// (checkFix in core's lessonAiFixes.js), since the author may have edited it
// while the fix was being made. Nothing changes until they press Apply.
//
// The preview shows each changed block as a word diff: a one-word change in a
// long passage is easy to miss side by side, and the author has to be able to
// see exactly what a model did to their lesson before they accept it.
//
// Like the other AI dialogs it renders a Turnstile widget, and the token is
// good for one request, so the widget is reset after each one for "Try again".

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { diffWordsWithSpace } from "diff";
import { RotateCcwIcon, SparklesIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.jsx";
import { Button } from "../ui/button.jsx";
import { Alert, AlertDescription } from "../ui/alert.jsx";
import { Skeleton } from "../ui/skeleton.jsx";
import { suggestFix } from "@spelling-creator/core/aiSuggest";
import { checkFix } from "@spelling-creator/core/lessonAiFixes";
import { textBlockPlain } from "@spelling-creator/core/lessonText";
import { QUESTION_TYPES } from "@spelling-creator/core/questions";
import { turnstileSiteKey } from "@spelling-creator/core/config";
import { whenTurnstileReady } from "@spelling-creator/core/browser/turnstile";
import { describeFinding } from "../../lib/lessonChecks.js";

const texts = (items) =>
  (items || []).map((item) => item?.text ?? "").filter(Boolean);

// The parts of a block a fix can change, as labelled lines of plain text.
function blockLines(t, block) {
  if (!block) return [];
  if (block.type === "text") {
    return [{ label: t("aiFix.fields.passage"), text: textBlockPlain(block) }];
  }
  if (block.type === "spelling") {
    return [
      { label: t("aiFix.fields.words"), text: texts(block.words).join(", ") },
    ];
  }
  const lines = [
    {
      label: t("aiFix.fields.type"),
      text: QUESTION_TYPES[block.questionType]?.label || block.questionType,
    },
    { label: t("aiFix.fields.prompt"), text: block.prompt || "" },
  ];
  if (block.answer != null) {
    lines.push({ label: t("aiFix.fields.answer"), text: String(block.answer) });
  }
  if (block.answers) {
    lines.push({
      label: t("aiFix.fields.answers"),
      text: texts(block.answers).join(", "),
    });
  }
  if (block.steps?.length) {
    lines.push({
      label: t("aiFix.fields.steps"),
      text: texts(block.steps).join(" / "),
    });
  }
  return lines;
}

function WordDiff({ before, after }) {
  return (
    <p className="m-0 text-sm leading-relaxed whitespace-pre-wrap">
      {diffWordsWithSpace(before, after).map((part, i) =>
        part.added ? (
          <ins
            key={i}
            className="rounded-sm bg-emerald-500/15 text-emerald-800 no-underline dark:text-emerald-300"
          >
            {part.value}
          </ins>
        ) : part.removed ? (
          <del
            key={i}
            className="rounded-sm bg-destructive/10 text-destructive"
          >
            {part.value}
          </del>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </p>
  );
}

// One changed block: each of its lines that changed, before and after merged
// into one diff. Lines that didn't change are left out.
function BlockChange({ before, after, heading }) {
  const { t } = useTranslation("checks");
  const was = blockLines(t, before);
  const now = blockLines(t, after);
  const labels = [...new Set([...was, ...now].map((line) => line.label))];
  const changed = labels
    .map((label) => ({
      label,
      before: was.find((l) => l.label === label)?.text ?? "",
      after: now.find((l) => l.label === label)?.text ?? "",
    }))
    .filter((line) => line.before !== line.after);
  return (
    <section className="flex flex-col gap-2 rounded-md border border-border p-3">
      <h4 className="m-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {heading}
      </h4>
      {changed.map((line) => (
        <div key={line.label} className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">{line.label}</span>
          <WordDiff before={line.before} after={line.after} />
        </div>
      ))}
    </section>
  );
}

// What each changed block is called in the preview: "Question 3", "Passage".
function blockHeading(t, doc, blockId) {
  for (const section of doc.sections) {
    const questions = section.blocks.filter((b) => b.type === "question");
    const block = section.blocks.find((b) => b.id === blockId);
    if (!block) continue;
    if (block.type === "question") {
      return t("aiFix.headings.question", {
        n: questions.indexOf(block) + 1,
      });
    }
    return block.type === "spelling"
      ? t("aiFix.headings.spelling")
      : t("aiFix.headings.passage");
  }
  return "";
}

/**
 * @param {boolean}  props.open
 * @param {object}   props.finding  The finding to fix.
 * @param {object}   props.doc      The lesson as it is now.
 * @param {Function} props.onApply  Called with the fix's operations; resolves
 *                                  true once the fix is in the lesson.
 * @param {Function} props.onClose
 */
export default function AiFixDialog({ open, finding, doc, onApply, onClose }) {
  const { t, i18n } = useTranslation("checks");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fix, setFix] = useState(null);
  const widgetRef = useRef(null);
  const widgetId = useRef(null);

  useEffect(() => {
    if (!open) return;
    setToken("");
    setError("");
    setBusy(false);
    setFix(null);
  }, [open, finding]);

  // The challenge, while the dialog is open.
  useEffect(() => {
    if (!open) return;
    if (!turnstileSiteKey()) {
      setError(t("aiFix.turnstileNotConfigured"));
      return;
    }
    let cancelled = false;
    whenTurnstileReady()
      .then((turnstile) => {
        if (cancelled || !widgetRef.current) return;
        widgetId.current = turnstile.render(widgetRef.current, {
          sitekey: turnstileSiteKey(),
          callback: (tok) => setToken(tok),
          "expired-callback": () => setToken(""),
          "error-callback": () => {
            setToken("");
            setError(t("aiFix.verificationFailed"));
          },
        });
      })
      .catch((e) => setError(e.message));
    return () => {
      cancelled = true;
      if (widgetId.current != null && window.turnstile) {
        window.turnstile.remove(widgetId.current);
      }
      widgetId.current = null;
    };
  }, [open, t]);

  // The fix checked against the lesson as it is now, not as it was sent.
  const preview = useMemo(
    () => (fix && finding ? checkFix(doc, fix.operations, finding) : null),
    [fix, doc, finding],
  );

  const ask = async () => {
    setBusy(true);
    setError("");
    setFix(null);
    try {
      setFix(await suggestFix(doc, finding.key, token));
    } catch (e) {
      setError(e.message || t("aiFix.genericError"));
    } finally {
      setBusy(false);
      setToken("");
      if (widgetId.current != null && window.turnstile) {
        window.turnstile.reset(widgetId.current);
      }
    }
  };

  const apply = async () => {
    setBusy(true);
    const applied = await onApply(fix.operations);
    setBusy(false);
    if (applied) onClose();
    else setError(t("aiFix.stale"));
  };

  const ready = preview?.ok;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("aiFix.title")}</DialogTitle>
          <DialogDescription>
            {finding ? describeFinding(t, finding, i18n.language) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {busy && !fix && (
            <div className="flex flex-col gap-2" aria-busy="true">
              <span className="sr-only">{t("aiFix.working")}</span>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}

          {fix && preview && !preview.ok && (
            <Alert variant="destructive">
              <AlertDescription>{t("aiFix.stale")}</AlertDescription>
            </Alert>
          )}

          {ready && (
            <>
              {fix.explanation && (
                <p className="m-0 text-sm">{fix.explanation}</p>
              )}
              {fix.operations.map((op) => (
                <BlockChange
                  key={op.blockId}
                  heading={blockHeading(t, doc, op.blockId)}
                  before={doc.sections
                    .flatMap((s) => s.blocks)
                    .find((b) => b.id === op.blockId)}
                  after={preview.doc.sections
                    .flatMap((s) => s.blocks)
                    .find((b) => b.id === op.blockId)}
                />
              ))}
              {preview.newWarnings.length > 0 && (
                <p className="m-0 text-xs text-muted-foreground">
                  {t("aiFix.newSuggestions", {
                    count: preview.newWarnings.length,
                  })}
                </p>
              )}
              <p className="m-0 text-xs text-muted-foreground">
                {t("aiFix.review")}
              </p>
            </>
          )}

          <div ref={widgetRef} className={fix || busy ? "hidden" : ""} />
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("aiFix.cancel")}
          </Button>
          {fix ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setFix(null);
                  setError("");
                }}
                disabled={busy}
              >
                <RotateCcwIcon data-icon="inline-start" />
                {t("aiFix.again")}
              </Button>
              <Button onClick={apply} disabled={busy || !ready}>
                {t("aiFix.apply")}
              </Button>
            </>
          ) : (
            <Button onClick={ask} disabled={busy || !token}>
              <SparklesIcon data-icon="inline-start" />
              {busy ? t("aiFix.working") : t("aiFix.ask")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
