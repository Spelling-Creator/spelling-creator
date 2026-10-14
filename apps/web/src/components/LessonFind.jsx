// Find in lesson: a search box over the one lesson on the page, in the editor
// and on the lesson page.
//
// The browser's own find-in-page already works on both (the editor goes to
// some lengths to keep it working through folded sections; see
// docs/developers/web-app/navigating-large-lessons.md). What it can't do is
// say where a match is. In a 37-screen document the browser scrolls you to a
// highlighted word and leaves you to work out that it was Q7 of section 3.
// This names each hit by its section and its place in it, shows the words
// around it, and goes there on a click.
//
// It is a popover rather than a panel so it costs no screen while it isn't in
// use. It closes when a hit is chosen (the page is about to scroll a long way,
// and a popover pinned to a button that has scrolled off the top is no use),
// and keeps its query and results, so reopening it to go to the next hit is
// one click and one key.
//
// The matching is @spelling-creator/core/lessonFind: plain, lexical, case and
// accents ignored, every word of the query somewhere in the same block.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SearchIcon, XIcon } from "lucide-react";
import {
  findInLesson,
  lessonFindEntries,
} from "@spelling-creator/core/lessonFind";
import { Button } from "./ui/button.jsx";
import { Input } from "./ui/input.jsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.jsx";
import { cn } from "../lib/utils.js";
import { scrollToLessonTarget } from "../lib/useScrollAnchor.js";

/** How many hits the list shows. A query matching more than this wants a
 * longer query, not a longer list. */
const SHOWN_LIMIT = 50;

// A brief ring around the block the reader was taken to, so the eye lands on
// it rather than on the middle of the screen. The Web Animations API rather
// than a class, so nothing has to be cleaned up afterwards.
function flash(el) {
  el.animate?.(
    [
      { boxShadow: "0 0 0 3px var(--ring)" },
      { boxShadow: "0 0 0 3px var(--ring)", offset: 0.6 },
      { boxShadow: "0 0 0 3px transparent" },
    ],
    { duration: 1800, easing: "ease-out" },
  );
}

// Put the keyboard where the reader was taken: in the editor, the block's
// first field (a section-name hit lands in the section's name), the way the
// Check panel's findings do; on the lesson page, where nothing is editable,
// the block itself. Either way the next Tab starts from the hit rather than
// from the top of the page, and a screen reader is told where it is.
function focusTarget(target) {
  const field = target.querySelector(
    "textarea, input:not([type=hidden]), [contenteditable=true]",
  );
  if (!field) target.tabIndex = -1;
  (field || target).focus({ preventScroll: true });
}

/**
 * @param {object} props
 * @param {object} props.doc  The lesson body.
 * @param {Map<string, string>|null} [props.translation]  The translation the
 *   page is showing, if any (see TranslatableLesson), so the search is over
 *   the words the reader can see.
 * @param {(hit: object) => void} [props.onSelect]  Called with the chosen hit
 *   before the page scrolls to it: the editor uses it to open a folded
 *   section, since a block has to be on the page to be scrolled to.
 * @param {string} [props.className]  For the trigger button.
 * @param {string} [props.variant]  The trigger button's variant, so it can
 *   match the row it sits in.
 */
export default function LessonFind({
  doc,
  translation = null,
  onSelect,
  className,
  variant = "outline",
}) {
  const { t } = useTranslation("common", { keyPrefix: "lessonFind" });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // Whether the popover is closing because a hit was chosen, as opposed to
  // Escape or a click outside. Decides where focus goes (below).
  const chosenRef = useRef(false);
  const listId = useId();

  // Nothing is indexed while the popover is closed: in the editor the lesson
  // changes on every keystroke, and two copies of this sit on the page.
  // Open, the entries are built once per lesson and matched per keystroke.
  const entries = useMemo(
    () => (open ? lessonFindEntries(doc, translation) : null),
    [open, doc, translation],
  );
  const results = useMemo(
    () => (entries ? findInLesson(doc, query, entries) : []),
    [doc, query, entries],
  );
  const shown = results.slice(0, SHOWN_LIMIT);
  const current = Math.min(active, Math.max(shown.length - 1, 0));

  // The keyboard moves the selection while focus stays in the input, so the
  // list has to follow the selection itself.
  useEffect(() => {
    if (!open || !shown.length) return;
    document
      .getElementById(`${listId}-${current}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, current, listId, shown.length]);

  const goTo = (hit) => {
    if (!hit) return;
    chosenRef.current = true;
    onSelect?.(hit);
    setOpen(false);
    scrollToLessonTarget(hit, (target) => {
      flash(target);
      focusTarget(target);
    });
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (shown.length) setActive(Math.min(current + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (shown.length) setActive(Math.max(current - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      goTo(shown[current]);
    }
  };

  const sectionLabel = (hit) =>
    hit.sectionName || t("section", { n: hit.sectionIndex + 1 });
  const kindLabel = (hit) => t(`kind.${hit.kind}`, { n: hit.number });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={variant}
          size="sm"
          className={cn("justify-start", className)}
        >
          <SearchIcon data-icon="inline-start" />
          {t("button")}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-2 p-3"
        // After a hit is chosen, focus goes to the hit (focusTarget), not
        // back to the trigger: returning it there would scroll the page
        // straight back, against the scroll to the hit that has just
        // started. Escape and a click outside keep the usual return.
        onCloseAutoFocus={(e) => {
          if (!chosenRef.current) return;
          chosenRef.current = false;
          e.preventDefault();
        }}
      >
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            role="combobox"
            aria-label={t("label")}
            aria-expanded={open && shown.length > 0}
            aria-controls={listId}
            aria-activedescendant={
              shown.length ? `${listId}-${current}` : undefined
            }
            aria-autocomplete="list"
            placeholder={t("placeholder")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="pr-9 pl-9"
          />
          {query && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("clearAria")}
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-1 -translate-y-1/2"
            >
              <XIcon />
            </Button>
          )}
        </div>

        {query.trim() ? (
          <p className="m-0 text-xs text-muted-foreground" aria-live="polite">
            {results.length === 0
              ? t("noMatches")
              : results.length > shown.length
                ? t("shownOf", { shown: shown.length, count: results.length })
                : t("matches", { count: results.length })}
          </p>
        ) : (
          <p className="m-0 text-xs text-muted-foreground">{t("hint")}</p>
        )}

        {shown.length > 0 && (
          <ol
            id={listId}
            role="listbox"
            aria-label={t("resultsLabel")}
            className="m-0 flex max-h-[min(24rem,60dvh)] list-none flex-col gap-0.5 overflow-y-auto p-0"
          >
            {shown.map((hit, i) => (
              <li
                key={
                  hit.blockId ? `${hit.blockId}` : `section:${hit.sectionId}`
                }
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === current}
              >
                <button
                  type="button"
                  // The input keeps the keyboard; the list is pointed at.
                  tabIndex={-1}
                  onClick={() => goTo(hit)}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "flex w-full cursor-pointer flex-col gap-0.5 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-foreground transition-colors",
                    i === current && "bg-accent text-accent-foreground",
                  )}
                >
                  <span className="text-xs text-muted-foreground">
                    {sectionLabel(hit)} · {kindLabel(hit)}
                  </span>
                  <span className="line-clamp-2 text-sm">
                    {hit.snippet.clippedStart && "..."}
                    {hit.snippet.parts.map((part, j) =>
                      part.hit ? (
                        <mark
                          key={j}
                          className="rounded-xs bg-primary/20 font-semibold text-inherit"
                        >
                          {part.text}
                        </mark>
                      ) : (
                        <span key={j}>{part.text}</span>
                      ),
                    )}
                    {hit.snippet.clippedEnd && "..."}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </PopoverContent>
    </Popover>
  );
}
