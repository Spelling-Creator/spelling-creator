// The "Install app" control. Absent unless the browser has said the app is
// installable, or this is iOS Safari where installing is a manual Share-sheet
// action; the detection lives in lib/useInstallPrompt.ts.
//
// On Chromium it calls the deferred prompt directly. On iOS there is no API,
// so it opens a dialog spelling out the two taps instead.
//
// Two callers, and `label` is what separates them: the header's utility
// cluster wants an icon in a 36px square and leans on the tooltip to say
// what it is; the settings page has room for words and wants a button that
// reads as one. A tooltip restating a visible label is noise, so it's
// dropped where the label is shown.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DownloadIcon, SquarePlusIcon, ShareIcon } from "lucide-react";
import { useInstallPrompt } from "@/lib/useInstallPrompt";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export default function InstallAppButton({
  className,
  label,
}: {
  /** The caller's trigger styling: this button sits on surfaces that don't share a token set. */
  className?: string;
  /** Visible button text. Omit for the icon-only form, which explains itself with a tooltip. */
  label?: string;
}) {
  const { t } = useTranslation("common");
  const { canInstall, needsManual, install } = useInstallPrompt();
  const [helpOpen, setHelpOpen] = useState(false);

  if (!canInstall) return null;

  const trigger = (
    <button
      type="button"
      aria-label={label ? undefined : t("install.ariaLabel")}
      onClick={() => (needsManual ? setHelpOpen(true) : install())}
      className={className}
    >
      <DownloadIcon />
      {label}
    </button>
  );

  return (
    <>
      {label ? (
        trigger
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent>{t("install.tooltip")}</TooltipContent>
        </Tooltip>
      )}

      {needsManual && (
        <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("install.iosTitle")}</DialogTitle>
              <DialogDescription>
                {t("install.iosDescription")}
              </DialogDescription>
            </DialogHeader>
            <ol className="m-0 flex list-none flex-col gap-3 p-0 text-sm">
              <li className="flex items-center gap-3">
                <ShareIcon className="shrink-0 text-muted-foreground" />
                {t("install.iosStepShare")}
              </li>
              <li className="flex items-center gap-3">
                <SquarePlusIcon className="shrink-0 text-muted-foreground" />
                {t("install.iosStepAdd")}
              </li>
            </ol>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
