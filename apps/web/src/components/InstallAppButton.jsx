// The "Install app" control. Absent unless the browser has told us the app is
// installable, or we're on iOS Safari where installing is a manual Share-sheet
// action — the detection lives in ../lib/useInstallPrompt.js.
//
// On Chromium it calls the deferred prompt directly. On iOS there is no API, so
// it opens a dialog spelling out the two taps instead.
//
// Two callers, and `label` is what separates them: the sidebar's footer row
// (AppSidebar.jsx) wants an icon in a 36px square alongside the theme toggle and
// the notification bell, and leans on the tooltip to say what it is; the
// settings page (SettingsPage.jsx) has room for words and wants a button that
// reads as one. A tooltip restating a visible label is noise, so it's dropped
// where the label is shown.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DownloadIcon, SquarePlusIcon, ShareIcon } from "lucide-react";
import { useInstallPrompt } from "../lib/useInstallPrompt.js";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip.jsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog.jsx";

/**
 * @param {object} props
 * @param {string} props.className  The caller's trigger styling. This button
 *                                  sits on surfaces that don't share a token set
 *                                  (the sidebar footer, a settings card), so it
 *                                  doesn't style itself.
 * @param {string} [props.label]    Visible button text. Omit for the icon-only
 *                                  form, which explains itself with a tooltip.
 */
export default function InstallAppButton({ className, label }) {
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
