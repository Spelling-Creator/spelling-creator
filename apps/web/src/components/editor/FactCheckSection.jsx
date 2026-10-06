// The Check panel's fact check: the passages' numbers and dates, compared with
// Wikidata.
//
// Run on request, behind a Turnstile challenge, because it costs a model call
// and a round of lookups (see lib/factCheck.js). What it shows:
//
//   - Facts Wikidata disagrees with, grouped by section. Each leads to its
//     passage like any other finding, and names the Wikidata item it was
//     checked against, because a search for "Georgia" can land on the wrong one
//     and the author is the one who can tell.
//   - Behind a toggle, the facts that matched and the ones that couldn't be
//     checked. The second kind isn't a problem, only a gap in Wikidata.
//
// A result is a snapshot. A fact whose words have changed in the lesson since
// is dropped from the list and counted instead, so fixing a number clears its
// finding without checking again.
//
// Hidden entirely on an instance with no API or no Turnstile key, where it
// could only ever fail.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  SearchCheckIcon,
} from "lucide-react";
import { Button } from "../ui/button.jsx";
import { Alert, AlertDescription } from "../ui/alert.jsx";
import { Skeleton } from "../ui/skeleton.jsx";
import { cn } from "../../lib/utils.js";
import { describeFact } from "../../lib/factCheck.js";
import { groupBySection, sectionHeading } from "./checkGroups.js";
import {
  lessonPassages,
  quoteStillThere,
} from "@spelling-creator/core/factCheck";
import {
  hasApi,
  hasTurnstile,
  turnstileSiteKey,
} from "@spelling-creator/core/config";
import { whenTurnstileReady } from "@spelling-creator/core/browser/turnstile";

const ICONS = {
  disagrees: CircleAlertIcon,
  agrees: CircleCheckIcon,
  unknown: CircleHelpIcon,
};

function FactList({ facts, sections, onChoose }) {
  const { t, i18n } = useTranslation("checks");
  return (
    <div className="flex flex-col gap-4">
      {groupBySection(facts, sections).map(({ sectionId, items }) => (
        <section key={sectionId || "lesson"} className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {sectionHeading(t, sections, sectionId)}
          </h4>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {items.map((fact, i) => {
              const Icon = ICONS[fact.status] || CircleHelpIcon;
              const entity = fact.entity;
              return (
                <li key={`${fact.blockId}#${fact.quote}#${i}`}>
                  <button
                    type="button"
                    onClick={() => onChoose(fact)}
                    className="flex w-full cursor-pointer gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <Icon
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        fact.status === "disagrees"
                          ? "text-destructive"
                          : "text-muted-foreground",
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      {describeFact(t, fact, i18n.language)}
                    </span>
                  </button>
                  {/* Outside the button: a link can't sit inside one. */}
                  {entity && (
                    <p className="m-0 pr-2 pl-8 text-xs text-muted-foreground">
                      {t("facts.checkedAgainst", {
                        label: entity.label,
                        description: entity.description,
                        context: entity.description ? undefined : "plain",
                      })}{" "}
                      <a
                        href={entity.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-foreground underline underline-offset-2"
                      >
                        {t("facts.viewOnWikidata")}
                      </a>
                    </p>
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
 * @param {boolean}  props.open      Whether the panel is open; the challenge
 *                                   widget lives only while it is.
 * @param {object}   props.factCheck From useFactCheck.
 * @param {string}   props.title     The lesson's title.
 * @param {any[]}    props.sections  The document's sections.
 * @param {Function} props.onChoose  Go to a fact's passage.
 */
export default function FactCheckSection({
  open,
  factCheck,
  title,
  sections,
  onChoose,
}) {
  const { t } = useTranslation("checks");
  const [token, setToken] = useState("");
  const [widgetError, setWidgetError] = useState("");
  const [showRest, setShowRest] = useState(false);
  const widgetRef = useRef(null);
  const widgetId = useRef(null);
  const available = hasApi() && hasTurnstile();
  const running = factCheck.status === "running";

  // The challenge, while the panel is open. Its token is good for one request,
  // so the widget is reset after each check (below) for the next one.
  useEffect(() => {
    if (!open || !available) return;
    let cancelled = false;
    setToken("");
    setWidgetError("");
    whenTurnstileReady()
      .then((turnstile) => {
        if (cancelled || !widgetRef.current) return;
        widgetId.current = turnstile.render(widgetRef.current, {
          sitekey: turnstileSiteKey(),
          callback: (tok) => setToken(tok),
          "expired-callback": () => setToken(""),
          "error-callback": () => {
            setToken("");
            setWidgetError(t("facts.verificationFailed"));
          },
        });
      })
      .catch((e) => setWidgetError(e.message));
    return () => {
      cancelled = true;
      if (widgetId.current != null && window.turnstile) {
        window.turnstile.remove(widgetId.current);
      }
      widgetId.current = null;
    };
  }, [open, available, t]);

  // Where each passage is now, so a finding can be placed and checked for
  // whether its words are still there.
  const passages = useMemo(() => {
    const out = new Map();
    lessonPassages({ sections }).forEach((p, index) =>
      out.set(p.blockId, { ...p, index }),
    );
    return out;
  }, [sections]);

  if (!available) return null;

  const live = factCheck.facts
    .map((fact) => ({ fact, at: passages.get(fact.blockId) }))
    .filter(({ fact, at }) => at && quoteStillThere(fact, at.text))
    .sort((a, b) => a.at.index - b.at.index)
    .map(({ fact, at }) => ({ ...fact, sectionId: at.sectionId }));
  const changed = factCheck.facts.length - live.length;
  const disagreements = live.filter((f) => f.status === "disagrees");
  const rest = live.filter((f) => f.status !== "disagrees");
  const matched = rest.filter((f) => f.status === "agrees").length;
  const unchecked = rest.length - matched;
  const done = factCheck.status === "done";

  const check = () => {
    factCheck.run({ title, sections }, token);
    setToken("");
    setShowRest(false);
    if (widgetId.current != null && window.turnstile) {
      window.turnstile.reset(widgetId.current);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="m-0 text-sm font-semibold">{t("facts.heading")}</h3>
        <p className="m-0 text-xs text-muted-foreground">{t("facts.hint")}</p>
      </div>

      {running && (
        <div className="flex flex-col gap-2" aria-busy="true">
          <span className="sr-only">{t("facts.running")}</span>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}

      {done && !running && (
        <>
          {disagreements.length ? (
            <FactList
              facts={disagreements}
              sections={sections}
              onChoose={onChoose}
            />
          ) : (
            <p className="m-0 flex items-center gap-2 text-sm text-muted-foreground">
              <CircleCheckIcon className="size-4" aria-hidden />
              {factCheck.facts.length
                ? t("facts.noneDisagree")
                : t("facts.noneFound")}
            </p>
          )}

          {rest.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="m-0 text-xs text-muted-foreground">
                {[
                  matched && t("facts.matched", { count: matched }),
                  unchecked && t("facts.unchecked", { count: unchecked }),
                ]
                  .filter(Boolean)
                  .join(" ")}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                aria-expanded={showRest}
                onClick={() => setShowRest((on) => !on)}
              >
                <ChevronDownIcon
                  data-icon="inline-start"
                  className={cn(
                    "transition-transform",
                    showRest && "rotate-180",
                  )}
                />
                {showRest
                  ? t("facts.hideRest")
                  : t("facts.showRest", { count: rest.length })}
              </Button>
              {showRest && (
                <FactList
                  facts={rest}
                  sections={sections}
                  onChoose={onChoose}
                />
              )}
            </div>
          )}

          {changed > 0 && (
            <p className="m-0 text-xs text-muted-foreground">
              {t("facts.changed", { count: changed })}
            </p>
          )}
        </>
      )}

      {factCheck.status === "error" && (
        <Alert variant="destructive">
          <AlertDescription>
            {factCheck.error || t("facts.genericError")}
          </AlertDescription>
        </Alert>
      )}
      {widgetError && (
        <Alert variant="destructive">
          <AlertDescription>{widgetError}</AlertDescription>
        </Alert>
      )}

      <div ref={widgetRef} />
      {passages.size ? (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={!token || running}
          onClick={check}
        >
          <SearchCheckIcon data-icon="inline-start" />
          {done ? t("facts.rerun") : t("facts.run")}
        </Button>
      ) : (
        <p className="m-0 text-sm text-muted-foreground">{t("facts.noText")}</p>
      )}
    </div>
  );
}
