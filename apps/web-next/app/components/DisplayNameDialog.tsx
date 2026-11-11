// A small dialog for choosing a public display name, the name shown to other
// users in place of an email. Used in two ways:
//   - forced (required): the gate renders it with no close affordance so a
//     new user must pick a name before using the app (DisplayNameGate.tsx);
//   - optional (editable): the account menu opens it to change a name.
// Saving goes through the Worker (core/profile.setDisplayName), which
// validates the name and stores it; on success the session is refreshed so
// `user` reflects it.

import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { CircleAlertIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/lib/auth";
import {
  setDisplayName,
  DISPLAY_NAME_MIN,
  DISPLAY_NAME_MAX,
} from "@spelling-creator/core/profile";

export default function DisplayNameDialog({
  open,
  required = false,
  onClose,
}: {
  open: boolean;
  /** When true, the dialog can't be dismissed and presents a first-time framing. */
  required?: boolean;
  /** Dismiss handler; ignored when required. */
  onClose?: () => void;
}) {
  const { t } = useTranslation("common");
  const { accessToken, displayName, refreshSession } = useAuth();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Seed the field with the current name (when editing) each time it opens.
  useEffect(() => {
    if (open) {
      setName(displayName || "");
      setError("");
    }
  }, [open, displayName]);

  const trimmed = name.replace(/\s+/g, " ").trim();
  const tooShort = trimmed.length < DISPLAY_NAME_MIN;
  const tooLong = trimmed.length > DISPLAY_NAME_MAX;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (tooShort || tooLong || !accessToken) return;
    setSaving(true);
    try {
      await setDisplayName(trimmed, accessToken);
      // Pull the new metadata into the session so the gate closes and the
      // chrome updates.
      await refreshSession();
      if (!required && onClose) onClose();
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : t("displayNameDialog.saveError"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !required) onClose?.();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={!required}
        onEscapeKeyDown={(e) => required && e.preventDefault()}
        onInteractOutside={(e) => required && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {required
              ? t("displayNameDialog.titleRequired")
              : t("displayNameDialog.titleEdit")}
          </DialogTitle>
          <DialogDescription>
            {t("displayNameDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save}>
          <FieldGroup>
            {error && (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Field>
              <FieldLabel htmlFor="display-name">
                {t("displayNameDialog.label")}
              </FieldLabel>
              <Input
                id="display-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={saving}
                maxLength={DISPLAY_NAME_MAX}
              />
              <FieldDescription>
                {t("displayNameDialog.charCountHint", {
                  min: DISPLAY_NAME_MIN,
                  max: DISPLAY_NAME_MAX,
                })}
              </FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-6">
            {!required && (
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                disabled={saving}
              >
                {t("buttons.cancel")}
              </Button>
            )}
            <Button type="submit" disabled={saving || tooShort || tooLong}>
              {saving && <Spinner data-icon="inline-start" />}
              {t("buttons.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
