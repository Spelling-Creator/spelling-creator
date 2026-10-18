// The check in front of the AI and image-search requests, as one hook every
// dialog shares.
//
// Which check that is belongs to the instance (core's aiChallenge(), matched to
// the server's AI_CHALLENGE):
//
//   turnstile  Cloudflare's widget, loaded by index.html, rendered here.
//   altcha     An <altcha-widget> that fetches a challenge from this instance's
//              own API and solves it in the background as soon as it appears.
//   none       Nothing to show; the token is a placeholder the server ignores.
//
// Either way a dialog gets the same three things back: the current token (empty
// until there is one), the element to place where the widget should go, and a
// refresh for after each request, because every token is single-use.

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import {
  aiChallenge,
  apiUrl,
  turnstileSiteKey,
} from "@spelling-creator/core/config";
import { whenTurnstileReady } from "@spelling-creator/core/browser/turnstile";

/** What a request carries when the instance runs no check. */
export const NO_CHALLENGE_TOKEN = "none";

/**
 * @param {boolean} active Whether the widget should be mounted (usually: the
 *   dialog is open, and for image search, the chosen source needs a token).
 * @param {object} options
 * @param {(message: string) => void} options.onError Shows a message to the user.
 * @param {{ notConfigured: string, failed: string }} options.messages The
 *   dialog's own wording for "this instance has no Turnstile key" and "the check
 *   failed".
 * @returns {{ token: string, widget: import("react").ReactNode, refresh: () => void }}
 */
export function useAiChallenge(active, { onError, messages }) {
  const mode = aiChallenge();
  const [token, setToken] = useState("");
  const containerRef = useRef(null);
  const resetRef = useRef(null);

  // Read at the moment something goes wrong, so the latest wording and handler
  // are used without remounting the widget whenever they change identity.
  const report = useEffectEvent((kind, detail) => {
    onError?.(detail || messages?.[kind] || "");
  });

  useEffect(() => {
    if (!active) return undefined;
    if (mode === "none") {
      setToken(NO_CHALLENGE_TOKEN);
      return undefined;
    }
    setToken("");

    let cancelled = false;
    let teardown = () => {};

    if (mode === "turnstile") {
      if (!turnstileSiteKey()) {
        report("notConfigured");
        return undefined;
      }
      whenTurnstileReady()
        .then((turnstile) => {
          if (cancelled || !containerRef.current) return;
          const id = turnstile.render(containerRef.current, {
            sitekey: turnstileSiteKey(),
            callback: (tok) => setToken(tok),
            "expired-callback": () => setToken(""),
            "error-callback": () => {
              setToken("");
              report("failed");
            },
          });
          resetRef.current = () => turnstile.reset(id);
          teardown = () => turnstile.remove(id);
        })
        .catch((e) => report("failed", e.message));
    } else {
      import("./altchaWidget.js")
        .then(() => {
          if (cancelled || !containerRef.current) return;
          const widget = document.createElement("altcha-widget");
          widget.setAttribute("challenge", `${apiUrl()}/altcha/challenge`);
          // Start solving as soon as the dialog opens, so there is usually a
          // token by the time someone has read the dialog and clicked.
          widget.setAttribute("auto", "onload");
          widget.setAttribute("language", "en");
          widget.addEventListener("statechange", (event) => {
            const { state, payload } = event.detail || {};
            if (state === "verified" && payload) {
              setToken(payload);
              return;
            }
            setToken("");
            if (state === "error") report("failed");
          });
          containerRef.current.append(widget);
          // A spent token needs a new challenge, solved straight away like the
          // first one.
          resetRef.current = () => {
            widget.reset();
            widget.verify();
          };
          teardown = () => widget.remove();
        })
        .catch((e) => report("failed", e.message));
    }

    return () => {
      cancelled = true;
      teardown();
      resetRef.current = null;
    };
  }, [active, mode]);

  const refresh = useCallback(() => {
    if (mode === "none") return;
    setToken("");
    resetRef.current?.();
  }, [mode]);

  const widget =
    mode === "none" ? null : (
      <div
        ref={containerRef}
        className={mode === "turnstile" ? "min-h-[65px]" : undefined}
      />
    );

  return { token, widget, refresh };
}
