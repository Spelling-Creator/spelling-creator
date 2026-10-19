// @vitest-environment happy-dom

// useAiChallenge as the dialogs use it. The case worth pinning down is the one
// that broke: a dialog that calls the hook and then clears its own error when it
// opens. The "not set up" message has to survive that.

import { act, createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { configureCore } from "@spelling-creator/core/config";

import { NO_CHALLENGE_TOKEN, useAiChallenge } from "./aiChallenge.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MESSAGES = {
  notConfigured: "AI isn't set up here.",
  failed: "Verification failed.",
};

/** Render a dialog-shaped harness, returning what it shows. */
function mount(open) {
  const seen = { current: null };
  function Dialog() {
    const [error, setError] = useState("");
    const { token, unavailable } = useAiChallenge(open, {
      onError: setError,
      messages: MESSAGES,
    });
    // Declared after the hook, exactly as the dialogs do.
    useEffect(() => {
      if (open) setError("");
    }, []);
    useEffect(() => {
      seen.current = { shown: error || unavailable, token };
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Dialog)));
  return { seen, unmount: () => act(() => root.unmount()) };
}

afterEach(() =>
  configureCore({ aiChallenge: "", turnstileSiteKey: "", apiUrl: "" }),
);

describe("useAiChallenge", () => {
  it("says the check isn't set up, even after the dialog clears its errors on open", () => {
    configureCore({ aiChallenge: "turnstile", turnstileSiteKey: "" });
    const { seen, unmount } = mount(true);
    expect(seen.current).toEqual({ shown: MESSAGES.notConfigured, token: "" });
    unmount();
  });

  it("says nothing while the check isn't wanted", () => {
    // Image search with Wikimedia selected: no check, so nothing is missing.
    configureCore({ aiChallenge: "turnstile", turnstileSiteKey: "" });
    const { seen, unmount } = mount(false);
    expect(seen.current.shown).toBe("");
    unmount();
  });

  it("is ready at once with none, and shows nothing", () => {
    configureCore({ aiChallenge: "none" });
    const { seen, unmount } = mount(true);
    expect(seen.current).toEqual({ shown: "", token: NO_CHALLENGE_TOKEN });
    unmount();
  });
});
