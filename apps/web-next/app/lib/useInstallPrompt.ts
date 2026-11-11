// "Install app" affordance for the PWA.
//
// Chromium fires `beforeinstallprompt` when the app meets the installability
// criteria, and it fires early, typically before React has mounted. So the
// listener is registered at module scope, on import, and the captured event
// is held in a tiny store that components subscribe to. Calling
// preventDefault() is what stops the browser showing its own mini-infobar
// and lets the app decide where the affordance lives (the header, next to
// the other nav actions).
//
// Safari has no such event: on iOS an app is installed through Share, then
// "Add to Home Screen", and there is no API to trigger or even detect
// eligibility. The browser is detected instead and instructions offered,
// which is the only thing available there.

import { useCallback, useSyncExternalStore } from "react";

/** The event Chromium fires; not in the DOM lib's types. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// The deferred event, or null. Single-valued: the browser fires at most one
// at a time, and a new one supersedes the old.
let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// True once the app is running from the home screen or app shell rather than
// a browser tab, in which case there is nothing left to install.
// `standalone` is Safari's non-standard equivalent of the display-mode query.
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true
  );
}

// iOS Safari, where installing is a manual Share-sheet action. Every iOS
// browser is Safari under the skin, but only Safari's own UI has the "Add to
// Home Screen" item, so Chrome, Firefox and Edge on iOS are excluded:
// pointing someone at a menu entry their browser doesn't have is worse than
// silence.
function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const ios =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as a Mac; the touch points give it away.
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    emit();
  });
}

type InstallState = "installed" | "prompt" | "none";

// getSnapshot must return a stable value for an unchanged store, so the two
// booleans are folded into one of three strings rather than a fresh object
// (which would re-render on every check).
function getSnapshot(): InstallState {
  if (installed || isStandalone()) return "installed";
  if (deferred) return "prompt";
  return "none";
}

// The server snapshot: neither branch above is meaningful there.
function getServerSnapshot(): InstallState {
  return "none";
}

export function useInstallPrompt(): {
  /** Show the affordance at all. */
  canInstall: boolean;
  /** No API to call: show instructions instead. */
  needsManual: boolean;
  /** Resolves true if the user accepted. */
  install: () => Promise<boolean>;
} {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const manual = state === "none" && isIosSafari() && !isStandalone();

  const install = useCallback(async () => {
    if (!deferred) return false;
    const event = deferred;
    // A deferred prompt is single-use: whether or not it's accepted, the
    // browser won't let prompt() be called on it again. Clear it first so a
    // double-click can't fire it twice.
    deferred = null;
    emit();
    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      return outcome === "accepted";
    } catch {
      // prompt() rejected, which means the browser never showed anything: it
      // throws when called outside a user gesture, or while another prompt
      // is already up. Nothing was consumed, so put the event back rather
      // than retiring the only chance to install. Guarded: a fresh
      // `beforeinstallprompt` may have landed meanwhile, and that newer event
      // supersedes this one.
      if (!deferred && !installed) {
        deferred = event;
        emit();
      }
      return false;
    }
  }, []);

  return {
    canInstall: state === "prompt" || manual,
    needsManual: manual,
    install,
  };
}
