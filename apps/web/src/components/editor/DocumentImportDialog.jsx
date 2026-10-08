import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileUpIcon, SparklesIcon, TriangleAlertIcon } from "lucide-react";
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
import { Progress } from "../ui/progress.jsx";
import {
  lessonFromSections,
  parseSection,
  sectionNeedsModel,
  splitSections,
} from "@spelling-creator/core/documentImport";
import {
  documentModelPossible,
  readSectionsWithModel,
} from "@spelling-creator/core/browser/documentModel";
import { loadExportEngine } from "../../lib/exports/load.js";

/**
 * Import a lesson from text that was never a lesson file: pasted from
 * anywhere, or read from a .txt, .md or hand-written .docx. The text is parsed
 * as it is typed or dropped in (core/documentImport.js), and the dialog shows
 * what it found, section by section, before anything is imported. Import hands
 * the finished document to `onImport`, which opens it as a new lesson.
 *
 * A section the rules could not read (a passage with no questions found), or
 * a text with no sections at all, can be handed to the on-device model
 * (core/browser/documentModel.js) on a device that can run it. Only those
 * sections go to the model; the rest keep the rules' result.
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

  // The model: whether this device can run it, and the state of a run.
  // "idle" -> "downloading" (first run only) -> "reading" -> "done".
  const [modelPossible, setModelPossible] = useState(false);
  const [modelPhase, setModelPhase] = useState("idle");
  const [modelProgress, setModelProgress] = useState(0);
  const [modelCount, setModelCount] = useState({ done: 0, total: 0 });
  // Per section index, what the model read; cleared whenever the text changes.
  const [modelSections, setModelSections] = useState({});
  const abortRef = useRef(null);

  useEffect(() => {
    if (open) {
      setText("");
      setError("");
      setReading(false);
      setModelPhase("idle");
      setModelSections({});
    } else {
      abortRef.current?.abort();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    documentModelPossible().then((possible) => {
      if (!cancelled) setModelPossible(possible);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Cheap enough to run on every keystroke: a few regular expressions per line.
  const analysis = useMemo(() => {
    if (!text.trim()) return null;
    const { title, sections } = splitSections(text);
    return {
      title,
      sections,
      parsed: sections.map(({ heading, lines }) =>
        parseSection(lines, heading),
      ),
    };
  }, [text]);

  // A new text means a new set of sections; the model's answers were for the
  // old ones.
  useEffect(() => {
    abortRef.current?.abort();
    setModelSections({});
    setModelPhase("idle");
  }, [text]);

  // What the import would use: the model's reading where there is one, the
  // rules' otherwise.
  const merged = useMemo(() => {
    if (!analysis) return [];
    if (!analysis.sections.length) {
      return modelSections[0] ? [modelSections[0]] : [];
    }
    return analysis.parsed.map((p, i) => modelSections[i] ?? p);
  }, [analysis, modelSections]);

  const found = merged.length > 0;
  const needing = analysis
    ? analysis.parsed.filter(sectionNeedsModel).length
    : 0;
  const modelCanHelp =
    modelPossible &&
    analysis !== null &&
    modelPhase !== "done" &&
    (needing > 0 || !analysis.sections.length);
  const modelRunning = modelPhase === "downloading" || modelPhase === "reading";
  const modelRead = Object.values(modelSections).filter(Boolean).length;

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

  const readWithModel = async () => {
    if (!analysis) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError("");
    setModelProgress(0);
    setModelPhase("downloading");

    // The sections the rules could not read, or the whole text as one
    // section when the splitter found none.
    const targets = analysis.sections.length
      ? analysis.parsed
          .map((p, i) => (sectionNeedsModel(p) ? i : -1))
          .filter((i) => i >= 0)
      : [0];
    const chunks = analysis.sections.length
      ? targets.map((i) => analysis.sections[i])
      : [
          {
            heading: "",
            lines: text
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean),
          },
        ];
    setModelCount({ done: 0, total: chunks.length });

    try {
      const results = await readSectionsWithModel(chunks, {
        signal: controller.signal,
        onDownloadProgress: (loaded) => {
          setModelProgress(loaded);
        },
        onSection: (done, total) => {
          setModelPhase("reading");
          setModelCount({ done, total });
        },
      });
      if (controller.signal.aborted) return;
      const next = {};
      targets.forEach((index, k) => {
        if (results[k]) next[index] = results[k];
      });
      setModelSections(next);
      setModelPhase("done");
      if (!Object.keys(next).length) {
        setError(t("documentImport.modelFailed"));
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        setModelPhase("idle");
        return;
      }
      setModelPhase("idle");
      setError(err?.message || t("documentImport.modelFailed"));
    }
  };

  const stopModel = () => {
    abortRef.current?.abort();
    setModelPhase("idle");
  };

  const handleImport = async () => {
    setError("");
    let doc;
    try {
      doc = lessonFromSections(analysis?.title || "", merged);
    } catch (err) {
      setError(err?.message || t("documentImport.nothingFound"));
      return;
    }
    // Opening the lesson can fail too (storage full, say). The dialog is
    // still open, so the reason is shown here rather than nowhere.
    try {
      await onImport(doc);
    } catch (err) {
      setError(err?.message || t("documentImport.importFailed"));
    }
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
            disabled={reading || modelRunning}
          />
          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={reading || busy || modelRunning}
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

          {analysis &&
            (found ? (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                <p className="font-medium">
                  {t("documentImport.foundTitle", {
                    title: analysis.title || t("labels.untitledLesson"),
                    count: merged.length,
                  })}
                </p>
                <ul className="mt-2 flex flex-col gap-1 text-muted-foreground">
                  {merged.map((s, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span className="truncate">
                        {s.name || t("outline.untitledSection", { n: i + 1 })}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {t("documentImport.sectionCounts", {
                          paragraphs: s.paragraphs.length,
                          words: s.spellingWords.length,
                          questions: s.questions.length,
                          answered: s.questions.filter((q) => q.answers.length)
                            .length,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  {modelRead > 0
                    ? t("documentImport.modelDone", { count: modelRead })
                    : t("documentImport.typesNote")}
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

          {/* The model, offered only for what the rules could not read, and
              only on a device that can run it. The first run downloads the
              weights, so the offer says so before the click. */}
          {modelCanHelp && !modelRunning && (
            <div className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3 text-sm">
              <p className="text-muted-foreground">
                {analysis.sections.length
                  ? t("documentImport.modelOffer", { count: needing })
                  : t("documentImport.modelOfferNothing")}
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="self-start"
                onClick={readWithModel}
                disabled={busy || reading}
              >
                <SparklesIcon data-icon="inline-start" />
                {t("documentImport.modelButton")}
              </Button>
            </div>
          )}

          {modelRunning && (
            <div className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
              <p className="text-muted-foreground">
                {modelPhase === "downloading"
                  ? modelProgress > 0
                    ? t("documentImport.modelDownloading", {
                        percent: Math.round(modelProgress * 100),
                      })
                    : t("documentImport.modelStarting")
                  : t("documentImport.modelReading", {
                      done: modelCount.done,
                      total: modelCount.total,
                    })}
              </p>
              {modelPhase === "downloading" && (
                <Progress value={Math.round(modelProgress * 100)} />
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={stopModel}
              >
                {t("documentImport.modelStop")}
              </Button>
            </div>
          )}

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
          <Button
            onClick={handleImport}
            disabled={!found || busy || reading || modelRunning}
          >
            {t("documentImport.import")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
