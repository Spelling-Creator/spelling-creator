// The editor's "Check lesson" panel: what the lesson checks found, grouped by
// section, each one a link to the block it is about.
//
// A sheet rather than a dialog like the editor's other panels, because the
// point of reading it is to go and fix something. Choosing a finding closes the
// sheet and the editor scrolls to the block; the scroll waits for the sheet to
// finish closing (onCloseAutoFocus), since while it is still on screen Radix is
// holding the page's scroll and focus.
//
// Problems are always shown. Suggestions start folded away: they describe the
// usual shape of a lesson, and someone who wrote a short one on purpose
// shouldn't have to read past a list of reasons it's short.
//
// A finding a script can fix on its own (core's lessonFixes.js: stray bold, a
// VAKT activity mid-section) gets a button that does it there and then, without
// closing the sheet. A line at the top of the sheet then says it is fixed and
// offers Undo, until the lesson changes again.
//
// Below both sits the fact check (FactCheckSection), which is different in
// kind: it costs a model call and a round of Wikidata lookups, so it runs only
// when asked rather than on every edit.

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  LightbulbIcon,
  Undo2Icon,
  WrenchIcon,
} from "lucide-react";
import { hasQuickFix } from "@spelling-creator/core/lessonFixes";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet.jsx";
import { Button } from "../ui/button.jsx";
import { cn } from "../../lib/utils.js";
import { describeFinding } from "../../lib/lessonChecks.js";
import { groupBySection, sectionHeading } from "./checkGroups.js";
import FactCheckSection from "./FactCheckSection.jsx";

function FindingList({ findings, sections, kind, onChoose, onFix }) {
  const { t, i18n } = useTranslation("checks");
  const Icon = kind === "problem" ? CircleAlertIcon : LightbulbIcon;

  return (
    <div className="flex flex-col gap-4">
      {groupBySection(findings, sections).map(({ sectionId, items }) => (
        <section key={sectionId || "lesson"} className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {sectionHeading(t, sections, sectionId, items[0].section)}
          </h4>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {items.map((finding, i) => {
              const text = describeFinding(t, finding, i18n.language);
              const body = (
                <>
                  <Icon
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      kind === "problem"
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">{text}</span>
                </>
              );
              const row = "flex w-full gap-2 rounded-md px-2 py-1.5 text-sm";
              return (
                // Not the key alone: a word listed twice is two identical
                // findings, and both should show.
                <li key={`${finding.key}#${i}`}>
                  {/* A finding about the whole lesson has nowhere to go to. */}
                  {finding.sectionId ? (
                    <button
                      type="button"
                      onClick={() => onChoose(finding)}
                      className={cn(
                        row,
                        "cursor-pointer border-0 bg-transparent text-left text-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      {body}
                    </button>
                  ) : (
                    <p className={cn(row, "m-0")}>{body}</p>
                  )}
                  {/* Beside the row rather than in it: a button can't sit
                      inside another. Indented to line up with the text. */}
                  {onFix && hasQuickFix(finding) && (
                    <div className="flex flex-wrap gap-1 pb-1 pl-8">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => onFix(finding)}
                      >
                        <WrenchIcon data-icon="inline-start" />
                        {t(`quickFix.${finding.code}`, finding.params)}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * @param {object}   props.checks    From useLessonChecks.
 * @param {object}   props.factCheck From useFactCheck.
 * @param {string}   props.title     The lesson's title, sent with a fact check.
 * @param {any[]}    props.sections  The document's sections, for the headings.
 * @param {Function} props.onGoTo    Called with the chosen finding once the
 *                                   sheet has closed, to scroll to its block.
 * @param {Function} [props.onFix]   Make a finding's quick fix. Without it, no
 *                                   fix buttons are shown.
 * @param {Function} [props.onUndoFix] Take the last fix back. Given only while
 *                                   nothing else has changed since it.
 */
export default function LessonChecksSheet({
  open,
  onClose,
  checks,
  factCheck,
  title,
  sections,
  onGoTo,
  onFix,
  onUndoFix,
}) {
  const { t } = useTranslation("checks");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const pending = useRef(null);

  const choose = (finding) => {
    pending.current = finding;
    onClose();
  };

  const { problems, suggestions } = checks;

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        className="w-full gap-0 sm:max-w-md"
        onCloseAutoFocus={(e) => {
          const finding = pending.current;
          pending.current = null;
          if (!finding) return;
          // Focus goes to the block, not back to the button that opened this.
          e.preventDefault();
          onGoTo(finding);
        }}
      >
        <SheetHeader className="border-b border-border pr-10">
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
          {onUndoFix && (
            <div
              role="status"
              className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
            >
              <span className="flex items-center gap-2">
                <CircleCheckIcon className="size-4" aria-hidden />
                {t("fix.done")}
              </span>
              <Button variant="outline" size="xs" onClick={onUndoFix}>
                <Undo2Icon data-icon="inline-start" />
                {t("fix.undo")}
              </Button>
            </div>
          )}
          {sections.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                <div>
                  <h3 className="m-0 text-sm font-semibold">
                    {t("problemsHeading")}
                  </h3>
                  <p className="m-0 text-xs text-muted-foreground">
                    {t("problemsHint")}
                  </p>
                </div>
                {problems.length ? (
                  <FindingList
                    findings={problems}
                    sections={sections}
                    kind="problem"
                    onChoose={choose}
                    onFix={onFix}
                  />
                ) : (
                  <p className="m-0 flex items-center gap-2 text-sm text-muted-foreground">
                    <CircleCheckIcon className="size-4" aria-hidden />
                    {t("noProblems")}
                  </p>
                )}
              </div>

              {suggestions.length > 0 && (
                <div className="flex flex-col gap-3">
                  <div>
                    <h3 className="m-0 text-sm font-semibold">
                      {t("suggestionsHeading")}
                    </h3>
                    <p className="m-0 text-xs text-muted-foreground">
                      {t("suggestionsHint")}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    aria-expanded={showSuggestions}
                    onClick={() => setShowSuggestions((on) => !on)}
                  >
                    <ChevronDownIcon
                      data-icon="inline-start"
                      className={cn(
                        "transition-transform",
                        showSuggestions && "rotate-180",
                      )}
                    />
                    {showSuggestions
                      ? t("hideSuggestions")
                      : t("showSuggestions", { count: suggestions.length })}
                  </Button>
                  {showSuggestions && (
                    <FindingList
                      findings={suggestions}
                      sections={sections}
                      kind="suggestion"
                      onChoose={choose}
                      onFix={onFix}
                    />
                  )}
                </div>
              )}

              <FactCheckSection
                open={open}
                factCheck={factCheck}
                title={title}
                sections={sections}
                onChoose={choose}
              />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
