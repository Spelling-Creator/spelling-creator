// The letterboard button in interactive mode's top bar, and the popover behind
// it: start a letterboard session, show its code, say how many boards are
// following, end it.
//
// A session pairs this Practice page with a tablet running Spelling Creator
// Board, the companion letterboard app. The partner reads the code off this
// screen and types it on the tablet; from then on the board follows the step
// shown here, and what the speller spells appears in the answer box. The
// connection itself is usePracticeHost (lib/practiceLink.js); this is only its
// control panel, kept small because it sits beside the speech controls over a
// lesson that is being run.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CopyIcon, TabletSmartphoneIcon } from "lucide-react";
import { Button } from "./ui/button.jsx";
import { Alert, AlertDescription } from "./ui/alert.jsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.jsx";
import { Skeleton } from "./ui/skeleton.jsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip.jsx";

/**
 * @param {object}  props
 * @param {ReturnType<import("../lib/practiceLink.js").usePracticeHost>} props.link
 * @param {boolean} props.signedIn  Whether there is an account to host from.
 */
export default function LetterboardLink({ link, signedIn }) {
  const { t } = useTranslation("interactive");
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    if (!link.code) return;
    try {
      await navigator.clipboard.writeText(link.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the code is on screen to read off anyway */
    }
  };

  const errorText = link.error ? t(`letterboard.errors.${link.error}`) : "";

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant={link.active ? "secondary" : "ghost"}
              size="icon-sm"
              aria-label={t("letterboard.open")}
              aria-pressed={link.active}
            >
              <TabletSmartphoneIcon />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("letterboard.open")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80">
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-medium">{t("letterboard.title")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("letterboard.description")}
            </p>
          </div>

          {errorText && (
            <Alert variant="destructive">
              <AlertDescription className="flex items-center justify-between gap-2">
                {errorText}
                <Button variant="ghost" size="sm" onClick={link.clearError}>
                  {t("letterboard.dismiss")}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {!signedIn ? (
            <p className="text-sm text-muted-foreground">
              {t("letterboard.signIn")}
            </p>
          ) : !link.active ? (
            <Button onClick={link.start}>{t("letterboard.start")}</Button>
          ) : (
            <>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">
                  {t("letterboard.codeLabel")}
                </p>
                {/* The code is read across a room and typed on a tablet, so it
                    is large and spaced, not a field to be selected. */}
                {link.status === "live" && link.code ? (
                  <div className="flex items-center gap-2">
                    <p className="flex-1 font-mono text-3xl font-semibold tracking-[0.3em]">
                      {link.code}
                    </p>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("letterboard.copyCode")}
                          onClick={copyCode}
                        >
                          <CopyIcon className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {copied
                          ? t("letterboard.copiedCode")
                          : t("letterboard.copyCode")}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                ) : (
                  <Skeleton className="h-9 w-48" />
                )}
              </div>
              <p className="text-sm text-muted-foreground" role="status">
                {link.status === "live"
                  ? t("letterboard.boards", { count: link.boards })
                  : t("letterboard.starting")}
              </p>
              <Button variant="outline" onClick={link.stop}>
                {t("letterboard.stop")}
              </Button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
