import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileUpIcon, TriangleAlertIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.jsx";
import { Button } from "../ui/button.jsx";
import { Textarea } from "../ui/textarea.jsx";
import { Alert, AlertDescription } from "../ui/alert.jsx";
import {
  importLessonText,
  previewLessonText,
} from "@spelling-creator/core/documentImport";
import { loadExportEngine } from "../../lib/exports/load.js";

/**
 * Import a lesson from text that was never a lesson file: pasted from
 * anywhere, or read from a .txt, .md or hand-written .docx. The text is parsed
 * as it is typed or dropped in (core/documentImport.js), and the dialog shows
 * what it found, section by section, before anything is imported. Import hands
 * the finished document to `onImport`, which opens it as a new lesson.
 */
export default function DocumentImportDialog({
  open,
  onOpenChange,
  onImport,
  busy,
}) {
  const { t } = useTranslation("editor");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setText("");
      setError("");
      setReading(false);
    }
  }, [open]);

  // Cheap enough to run on every keystroke: a few regular expressions per line.
  const preview = useMemo(
    () => (text.trim() ? previewLessonText(text) : null),
    [text],
  );
  const found = preview?.sections.length > 0;

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setReading(true);
    setError("");
    try {
      const { documentFileText } = await loadExportEngine();
      setText(await documentFileText(file));
    } catch (err) {
      setError(err?.message || t("documentImport.couldNotRead"));
    } finally {
      setReading(false);
    }
  };

  const handleImport = async () => {
    setError("");
    let doc;
    try {
      doc = importLessonText(text);
    } catch (err) {
      setError(err?.message || t("documentImport.nothingFound"));
      return;
    }
    await onImport(doc);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("documentImport.title")}</DialogTitle>
          <DialogDescription>
            {t("documentImport.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("documentImport.placeholder")}
            aria-label={t("documentImport.textLabel")}
            className="max-h-64 min-h-32 overflow-y-auto font-mono text-xs"
            disabled={reading}
          />
          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={reading || busy}
            >
              <FileUpIcon data-icon="inline-start" />
              {reading
                ? t("documentImport.reading")
                : t("documentImport.chooseFile")}
            </Button>
            <span className="text-xs text-muted-foreground">
              {t("documentImport.fileTypes")}
            </span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            hidden
            onChange={handleFile}
          />

          {preview &&
            (found ? (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                <p className="font-medium">
                  {t("documentImport.foundTitle", {
                    title: preview.title || t("labels.untitledLesson"),
                    count: preview.sections.length,
                  })}
                </p>
                <ul className="mt-2 flex flex-col gap-1 text-muted-foreground">
                  {preview.sections.map((s, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span className="truncate">{s.name}</span>
                      <span className="shrink-0 tabular-nums">
                        {t("documentImport.sectionCounts", {
                          paragraphs: s.paragraphs,
                          words: s.spellingWords,
                          questions: s.questions,
                          answered: s.answered,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("documentImport.typesNote")}
                </p>
              </div>
            ) : (
              <Alert>
                <TriangleAlertIcon />
                <AlertDescription>
                  {t("documentImport.nothingFound")}
                </AlertDescription>
              </Alert>
            ))}

          {error && (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("documentImport.cancel")}
          </Button>
          <Button onClick={handleImport} disabled={!found || busy || reading}>
            {t("documentImport.import")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
