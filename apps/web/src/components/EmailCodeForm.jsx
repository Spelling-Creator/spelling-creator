// The "type the code from the email" half of a magic-link sign-in, shared by
// /login and the MCP OAuth consent screen so the two can't drift apart.
//
// The link only signs in the browser that opens it, which from an installed app
// is never the app (see verifyEmailCode in lib/auth.jsx). The code has no
// redirect, so it signs in wherever it's typed. On success there is nothing to
// do here: the auth listener picks up the new session and the page around this
// swaps to its signed-in view.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button.jsx";
import { Input } from "./ui/input.jsx";
import { Field, FieldLabel } from "./ui/field.jsx";
import { Alert, AlertDescription } from "./ui/alert.jsx";
import { Spinner } from "./ui/spinner.jsx";
import { useAuth } from "../lib/auth.jsx";

// Supabase lets a project pick an email code length from 6 to 10 digits.
const CODE_MIN_LENGTH = 6;
const CODE_MAX_LENGTH = 10;

/**
 * @param {object} props
 * @param {string} props.email The address the code was sent to.
 * @param {(busy: boolean) => void} [props.onBusyChange] Told while a check is
 *   in flight, so the page can hold back "Use a different email": switching
 *   address mid-check would still sign in the old one when it lands.
 */
export default function EmailCodeForm({ email, onBusyChange }) {
  const { t } = useTranslation("login");
  const { verifyEmailCode } = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const setBusyBoth = (value) => {
    setBusy(value);
    onBusyChange?.(value);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusyBoth(true);
    try {
      await verifyEmailCode(email, code);
    } catch (err) {
      // A wrong code and a used-up one are the same error to GoTrue, and its
      // wording ("Token has expired or is invalid") isn't something to show.
      // Anything else (rate limits, the network) keeps its own message.
      setError(
        err.code === "otp_expired"
          ? t("errors.codeFailed")
          : err.message || t("errors.codeFailed"),
      );
    } finally {
      setBusyBoth(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-3 text-left">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Field>
        <FieldLabel htmlFor="email-code">{t("sent.codeLabel")}</FieldLabel>
        <Input
          id="email-code"
          // Lets iOS and Android offer the code straight from the email as a
          // keyboard suggestion.
          autoComplete="one-time-code"
          inputMode="numeric"
          // No maxLength: the browser would cut a paste like "Code: 48213907"
          // down before the digits could be picked out of it. The length is
          // capped after the filter instead.
          value={code}
          onChange={(e) =>
            setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_MAX_LENGTH))
          }
          disabled={busy}
        />
      </Field>
      <Button type="submit" disabled={busy || code.length < CODE_MIN_LENGTH}>
        {busy && <Spinner data-icon="inline-start" />}
        {t("sent.submitCode")}
      </Button>
    </form>
  );
}
