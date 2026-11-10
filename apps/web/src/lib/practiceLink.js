// The Practice page's side of a letterboard session, as React sees it.
//
// The session itself (the socket to the hub's PracticeRoom, the `state` it
// sends, the messages it reads) is createPracticeHost in
// @spelling-creator/core/browser/practiceHost, which knows nothing about React.
// What is left here is the wiring: one host per walkthrough, its inputs fed
// from props, its snapshot read as state, and the session stopped with the
// component. See apps/docs/docs/developers/web-app/letterboard-sync.md.

import { useEffect, useState } from "react";
import {
  checkPracticeAvailable,
  createPracticeHost,
} from "@spelling-creator/core/browser/practiceHost";
import { useStore } from "./useStore.js";

/**
 * `checkPracticeAvailable` as React state: false until the hub has said yes.
 * @param {boolean} enabled  Whether to ask at all (the walkthrough is open).
 * @returns {boolean}
 */
export function usePracticeAvailable(enabled) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    checkPracticeAvailable().then((yes) => {
      if (!cancelled) setAvailable(yes);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return available;
}

/**
 * Host a letterboard session for the lesson interactive mode has open.
 *
 * @param {object}   opts
 * @param {string}   [opts.accessToken] The signed-in user's Supabase JWT; required to host.
 * @param {string}   [opts.lessonId]    The lesson that is open, or undefined for none.
 * @param {number}   opts.step          The current step's index in buildInteractiveSteps' walkthrough.
 * @param {string}   opts.text          What is in the answer box.
 * @param {Function} [opts.onText]      A board's sentence changed: (text) => void.
 * @param {Function} [opts.onAnswer]    A board finished an answer: (text) => void.
 * @param {Function} [opts.onStep]      A board asks to move: (step) => void.
 * @returns {{
 *   status: 'idle' | 'connecting' | 'live',
 *   code: string | null,
 *   boards: number,
 *   error: 'notConfigured' | 'signIn' | 'couldNotStart' | 'refused' | 'disconnected' | null,
 *   active: boolean,
 *   start: () => void,
 *   stop: () => void,
 *   clearError: () => void,
 * }}
 */
export function usePracticeHost({
  accessToken,
  lessonId,
  step,
  text,
  onText,
  onAnswer,
  onStep,
}) {
  const [host] = useState(() =>
    createPracticeHost({ onText, onAnswer, onStep }),
  );

  // The latest callbacks, for a message that arrives after a later render.
  useEffect(() => {
    host.setHandlers({ onText, onAnswer, onStep });
  }, [host, onText, onAnswer, onStep]);

  // Where the lesson is. The host tells the boards whenever it changes.
  useEffect(() => {
    host.setPosition({ lessonId, step, text });
  }, [host, lessonId, step, text]);

  // The session ends with the walkthrough.
  useEffect(() => () => host.stop(), [host]);

  const { status, code, boards, error } = useStore(host);
  return {
    status,
    code,
    boards,
    error,
    active: status !== "idle",
    start: () => host.start(accessToken),
    stop: host.stop,
    clearError: host.clearError,
  };
}
