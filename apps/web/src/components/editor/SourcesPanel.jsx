// The lesson's sources, edited at the end of the document where they print.
//
// Each source is a row of fields (title, author, publisher, year, link) that
// commit like every other field in the editor. A source can also be added from
// a footnote in the text (LessonTextToolbar.jsx), which is why this shows how
// often each one is cited: a source nobody cites still prints in the list, and
// the count is how you notice.
//
// Removing a cited source takes its citations out of the text with it (see
// removeSourceCitations), so it asks first.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BookMarkedIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "../ui/button.jsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.jsx";
import { LiveInput } from "../LiveField.jsx";
import IconActionButton from "../IconActionButton.jsx";
import { lessonFootnotes } from "@spelling-creator/core/lessonText";
import { isSafeLink } from "@spelling-creator/core/richText";

// Which fields sit on which row, and how much of it each takes. Every field
// names its own flex value: Input is w-full, so one left to the default would
// take the whole row and squeeze its neighbour to nothing.
const ROWS = [
  [
    { field: "title", className: "sm:flex-[2]" },
    { field: "author", className: "sm:flex-1" },
  ],
  [
    { field: "publisher", className: "sm:flex-[2]" },
    { field: "year", className: "sm:w-28 sm:flex-none" },
  ],
  [{ field: "url", type: "url", className: "sm:flex-1" }],
];

function citationCounts(doc) {
  const counts = new Map();
  for (const footnote of lessonFootnotes(doc)) {
    if (footnote.sourceId) {
      counts.set(footnote.sourceId, (counts.get(footnote.sourceId) || 0) + 1);
    }
  }
  return counts;
}

function SourceRow({ source, index, cited, onChange, onRemove }) {
  const { t } = useTranslation("editorSections");
  const url = (source.url || "").trim();
  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex items-start gap-2">
        <span className="mt-2 w-5 shrink-0 text-right text-xs font-semibold text-muted-foreground tabular-nums">
          {index + 1}.
        </span>
        <div className="flex min-w-0 grow flex-col gap-2">
          {ROWS.map((row, r) => (
            <div key={r} className="flex flex-col gap-2 sm:flex-row">
              {row.map(({ field, className, type }) => (
                <LiveInput
                  key={field}
                  type={type}
                  inputMode={type === "url" ? "url" : undefined}
                  aria-label={t(`sources.fields.${field}`)}
                  placeholder={
                    field === "url"
                      ? t("sources.fields.urlPlaceholder")
                      : t(`sources.fields.${field}`)
                  }
                  value={source[field] || ""}
                  onCommit={(value) => onChange({ ...source, [field]: value })}
                  data-collab-field={`source:${source.id}:${field}`}
                  className={className}
                />
              ))}
            </div>
          ))}
          {url && !isSafeLink(url) && (
            <p className="text-xs text-destructive">
              {t("sources.invalidUrl")}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {cited
              ? t("sources.citedCount", { count: cited })
              : t("sources.notCited")}
          </p>
        </div>
        <IconActionButton
          tooltip={t("sources.remove")}
          onClick={onRemove}
          destructive
        >
          <Trash2Icon />
        </IconActionButton>
      </div>
    </li>
  );
}

/**
 * @param {object} props
 * @param {object} props.doc  The lesson.
 * @param {(source: object) => void} props.onChangeSource
 * @param {() => void} props.onAddSource
 * @param {(id: string) => void} props.onRemoveSource  Also strips its citations.
 */
export default function SourcesPanel({
  doc,
  onChangeSource,
  onAddSource,
  onRemoveSource,
}) {
  const { t } = useTranslation("editorSections");
  const sources = Array.isArray(doc.sources) ? doc.sources : [];
  const counts = citationCounts(doc);
  const [confirming, setConfirming] = useState(null);

  const remove = (source) => {
    if (counts.get(source.id)) setConfirming(source);
    else onRemoveSource(source.id);
  };

  return (
    <section
      aria-labelledby="lesson-sources-heading"
      className="rounded-panel border border-border bg-card p-4 text-card-foreground sm:p-6"
    >
      <h2
        id="lesson-sources-heading"
        className="flex items-center gap-2 text-base font-semibold"
      >
        <BookMarkedIcon className="size-4" aria-hidden="true" />
        {t("sources.heading")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("sources.description")}
      </p>

      {sources.length > 0 ? (
        <ol className="mt-4 flex flex-col gap-3">
          {sources.map((source, i) => (
            <SourceRow
              key={source.id}
              source={source}
              index={i}
              cited={counts.get(source.id) || 0}
              onChange={onChangeSource}
              onRemove={() => remove(source)}
            />
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground italic">
          {t("sources.empty")}
        </p>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-4 h-10 sm:h-8"
        onClick={onAddSource}
      >
        <PlusIcon data-icon="inline-start" />
        {t("sources.add")}
      </Button>

      <Dialog
        open={Boolean(confirming)}
        onOpenChange={(open) => !open && setConfirming(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("sources.confirmRemove.title")}</DialogTitle>
            <DialogDescription>
              {t("sources.confirmRemove.description", {
                count: counts.get(confirming?.id) || 0,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirming(null)}
            >
              {t("sources.confirmRemove.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (confirming?.id) onRemoveSource(confirming?.id);
                setConfirming(null);
              }}
            >
              {t("sources.confirmRemove.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
