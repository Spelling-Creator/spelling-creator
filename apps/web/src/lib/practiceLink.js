// The Practice page's side of a letterboard session.
//
// A speller answers on a tablet running Spelling Creator Board while the partner
// runs the lesson here. This hook hosts the session: it opens one WebSocket to
// the hub's PracticeRoom (apps/api/src/practice-room.js), tells the room where
// the lesson is (`state`: which lesson, which step, what is in the answer box)
// every time that changes, and hands what the board sends back to interactive
// mode: the sentence being spelled (`text`), a finished answer (`answer`) and a
// request to move (`step`). The contract is docs/live-sync.md in the board's
// repository; the room relays exactly those fields and nothing else.
//
// The host decides. A board asking to move is a request; interactive mode moves
// if it agrees, and the `state` that follows tells every board where everyone
// is. A board that joins mid-lesson is caught up by the room from the last state
// sent here, so nothing has to be resent on its account.
//
// Messages are JSON text frames, deliberately plain: the board is a Kotlin app
// with no reason to share the collaboration room's binary frames or its Yjs
// document, and there is no document here to merge, only a step and a sentence.

import { apiUrl, apiWsUrl, hasApi } from "@spelling-creator/core/config";
import { useCallback, useEffect, useRef, useState } from "react";

// What a partner reads off one screen and types on another, so no letters that
// look like digits (I, L, O) and no digits that look like letters (0, 1). Six of
// these is about 887 million codes; the hub limits join attempts by address.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

// Coalesce a burst of changes (every keystroke in the answer box is one) into a
// single `state`.
const STATE_DEBOUNCE_MS = 50;
// Keep-alive. A browser can't send a WebSocket ping from JavaScript, so a text
// "ping" the room answers with "pong" stands in (see practice-room.js). 20s is
// well under idle timeouts even with background-tab timer throttling.
const PING_MS = 20000;

/**
 * A new share code for a letterboard session.
 * @returns {string}
 */
export function newPracticeCode() {
  // Rejection sampling keeps every character equally likely: 248 is the largest
  // multiple of the alphabet's length that fits in a byte.
  const limit = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length;
  let code = "";
  while (code.length < CODE_LENGTH) {
    const bytes = new Uint8Array(CODE_LENGTH);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit && code.length < CODE_LENGTH) {
        code += CODE_ALPHABET[b % CODE_ALPHABET.length];
      }
    }
  }
  return code;
}

// The wss:// base for the session endpoint, derived from the API URL.
function wsBase() {
  return hasApi() ? apiWsUrl() : null;
}

// ----- whether the hub can host one -------------------------------------------
// Only the Cloudflare Worker serves letterboard sessions: a self-hosted Node API
// has no Durable Objects, so /practice is not registered there. The hub says
// which it is at GET /practice ({ available }), and anything but a yes (a 404
// from a self-hosted instance, a network failure) means no letterboard button,
// rather than a button whose every press fails.
//
// Asked once per page load, since the answer only changes with a deploy. A
// failed request isn't remembered, so the next walkthrough opened asks again.
let availability = null;

/**
 * Whether this hub can host letterboard sessions.
 * @returns {Promise<boolean>}
 */
export function checkPracticeAvailable() {
  if (!hasApi()) return Promise.resolve(false);
  if (availability) return availability;
  const asking = fetch(`${apiUrl()}/practice`, {
    headers: { Accept: "application/json" },
  })
    .then((res) => (res.ok ? res.json() : { available: false }))
    .then((body) => body?.available === true)
    .catch(() => {
      if (availability === asking) availability = null;
      return false;
    });
  availability = asking;
  return asking;
}

/** Forget the cached answer. For tests. */
export function forgetPracticeAvailability() {
  availability = null;
}

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
  const [status, setStatus] = useState("idle");
  const [code, setCode] = useState(null);
  const [boards, setBoards] = useState(0);
  const [error, setError] = useState(null);

  const wsRef = useRef(null);
  const pingRef = useRef(null);
  // True while we're tearing down on purpose, so the close handler doesn't
  // report a disconnection we caused.
  const closingRef = useRef(false);
  // Whether the room has said hello: a close before that is a refused join.
  const helloRef = useRef(false);
  // The latest callbacks, for the long-lived message handler.
  const handlers = useRef({ onText, onAnswer, onStep });
  useEffect(() => {
    handlers.current = { onText, onAnswer, onStep };
  }, [onText, onAnswer, onStep]);

  const send = (message) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch {
        /* a socket mid-close; the close handler cleans up */
      }
    }
  };

  function cleanup() {
    closingRef.current = true;
    if (pingRef.current) {
      clearInterval(pingRef.current);
      pingRef.current = null;
    }
    try {
      wsRef.current?.close();
    } catch {
      /* ignore */
    }
    wsRef.current = null;
    helloRef.current = false;
  }

  const handleMessage = useCallback((data) => {
    if (typeof data !== "string") return;
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return; // "pong", or something that isn't ours
    }
    if (!msg || typeof msg !== "object") return;
    switch (msg.type) {
      case "hello":
        helloRef.current = true;
        setStatus("live");
        setBoards(Number.isInteger(msg.boards) ? msg.boards : 0);
        break;
      case "boards":
        if (Number.isInteger(msg.count)) setBoards(msg.count);
        break;
      case "text":
        if (typeof msg.text === "string") handlers.current.onText?.(msg.text);
        break;
      case "answer":
        if (typeof msg.text === "string") handlers.current.onAnswer?.(msg.text);
        break;
      case "step":
        if (Number.isInteger(msg.step) && msg.step >= 0) {
          handlers.current.onStep?.(msg.step);
        }
        break;
      default:
        break; // a message type added later; the contract says to ignore it
    }
  }, []);

  const start = useCallback(() => {
    if (wsRef.current) return;
    const base = wsBase();
    if (!base) {
      setError("notConfigured");
      return;
    }
    if (!accessToken) {
      setError("signIn");
      return;
    }

    const next = newPracticeCode();
    setError(null);
    setStatus("connecting");
    setCode(next);
    setBoards(0);
    closingRef.current = false;
    helloRef.current = false;

    const params = new URLSearchParams({ create: "1", token: accessToken });
    let ws;
    try {
      ws = new WebSocket(`${base}/practice/${next}?${params.toString()}`);
    } catch {
      setError("couldNotStart");
      setStatus("idle");
      setCode(null);
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      if (pingRef.current) clearInterval(pingRef.current);
      pingRef.current = setInterval(() => {
        const sock = wsRef.current;
        if (sock && sock.readyState === WebSocket.OPEN) {
          try {
            sock.send("ping");
          } catch {
            /* the close handler cleans up */
          }
        }
      }, PING_MS);
    };
    ws.onmessage = (ev) => handleMessage(ev.data);
    ws.onclose = () => {
      if (closingRef.current) return;
      wsRef.current = null;
      // The Worker refuses an upgrade before the socket opens (an expired
      // sign-in, too many sessions started, a missing binding), which surfaces
      // here as a close without a hello. A browser is never told the status, so
      // the message names no single cause: "refused" says only that the hub
      // said no.
      setError(helloRef.current ? "disconnected" : "refused");
      cleanup();
      setStatus("idle");
      setCode(null);
      setBoards(0);
    };
    ws.onerror = () => {
      // onclose runs next and owns the message.
    };
  }, [accessToken, handleMessage]);

  const stop = useCallback(() => {
    cleanup();
    setStatus("idle");
    setCode(null);
    setBoards(0);
  }, []);

  // Tell the room where everyone is, whenever that changes. The room keeps the
  // last one for boards that join later, so sending on every change is also
  // what catches a late board up. `lessonId` is left out when there is none,
  // which the contract reads as "no lesson is open yet".
  useEffect(() => {
    if (status !== "live") return;
    const id = setTimeout(() => {
      const state = { type: "state", step, text };
      if (lessonId) state.lessonId = lessonId;
      send(state);
    }, STATE_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [status, lessonId, step, text]);

  // Tear down with the component using this hook.
  useEffect(() => () => cleanup(), []);

  return {
    status,
    code,
    boards,
    error,
    active: status !== "idle",
    start,
    stop,
    clearError: () => setError(null),
  };
}
