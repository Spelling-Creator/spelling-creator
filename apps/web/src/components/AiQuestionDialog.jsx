import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { SparklesIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog.jsx";
import { Button } from "./ui/button.jsx";
import { Alert, AlertDescription } from "./ui/alert.jsx";
import { Spinner } from "./ui/spinner.jsx";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "./ui/select.jsx";
import { Field, FieldLabel } from "./ui/field.jsx";
import { suggestQuestion } from "@spelling-creator/core/aiSuggest";
import { QUESTION_TYPE_MENU } from "@spelling-creator/core/questions";
import { useAiChallenge } from "../lib/aiChallenge.jsx";

/**
 * Dialog that suggests a quiz question via the Worker, alongside the text
 * suggester. The subject is the section title the user already typed; the user
 * only picks which type of question to generate. Like AiTextDialog, it shows
 * the instance's AI check and sends its token with the request. The section's
 * existing text is sent as context so the question is grounded in the lesson.
 * The prompts of any questions already in the section are sent too, so the model
 * can avoid repeating one the user already has.
 */
export default function AiQuestionDialog({
  open,
  sectionTitle,
  documentName,
  sectionText,
  existingQuestions,
  onInsert,
  onClose,
}) {
  const [questionType, setQuestionType] = useState("single");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { t } = useTranslation("aiDialogs");
  const {
    token,
    widget,
    refresh: refreshChallenge,
  } = useAiChallenge(open, {
    onError: setError,
    messages: {
      notConfigured: t("aiQuestion.turnstileNotConfigured"),
      failed: t("aiQuestion.verificationFailed"),
    },
  });

  const subject = (sectionTitle || "").trim();

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setError("");
      setBusy(false);
      setQuestionType("single");
    }
  }, [open]);

  const handleGenerate = async () => {
    if (!subject) {
      setError(t("aiQuestion.nameSectionFirst"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await suggestQuestion(subject, token, {
        questionType,
        documentName,
        sectionText,
        existingQuestions,
      });
      onInsert(questionType, data);
      onClose();
    } catch (e) {
      setError(e.message || t("aiQuestion.genericError"));
      // Token is single-use; force a fresh challenge before retrying.
      refreshChallenge();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose?.();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("aiQuestion.title")}</DialogTitle>
          <DialogDescription>
            {subject ? (
              <Trans
                i18nKey="aiQuestion.descriptionWithSubject"
                ns="aiDialogs"
                values={{ subject }}
                components={{
                  strong: <strong className="font-medium text-foreground" />,
                }}
              />
            ) : (
              t("aiQuestion.descriptionNoSubject")
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Field>
            <FieldLabel htmlFor="question-type">
              {t("aiQuestion.questionTypeLabel")}
            </FieldLabel>
            <Select
              value={questionType}
              onValueChange={setQuestionType}
              disabled={busy}
            >
              <SelectTrigger id="question-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUESTION_TYPE_MENU.map((q) => (
                  <SelectItem key={q.key} value={q.key}>
                    <span
                      className="inline-block size-3 shrink-0 rounded-full"
                      style={{ backgroundColor: q.color }}
                    />
                    <span className="flex flex-col">
                      <span>{q.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {q.description}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {widget}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={busy}
          >
            {t("aiQuestion.cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleGenerate}
            disabled={busy || !token || !subject}
          >
            {busy ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <SparklesIcon data-icon="inline-start" />
            )}
            {busy ? t("aiQuestion.generating") : t("aiQuestion.generate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
