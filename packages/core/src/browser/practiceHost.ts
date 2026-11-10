// The Practice page's side of a letterboard session.
//
// A speller answers on a tablet running Spelling Creator Board while the partner
// runs the lesson in the browser. This module hosts the session: it opens one
// WebSocket to the hub's PracticeRoom (apps/api/src/practice-room.js), tells the
// room where the lesson is (`state`: which lesson, which step, what is in the
// answer box) every time that changes, and hands what the board sends back to
// interactive mode: the sentence being spelled (`text`), a finished answer
// (`answer`) and a request to move (`step`). The contract is docs/live-sync.md
// in the board's repository; the room relays exactly those fields and nothing
// else.
//
// The host decides. A board asking to move is a request; interactive mode moves
// if it agrees, and the `state` that follows tells every board where everyone
// is. A board that joins mid-lesson is caught up by the room from the last state
// sent here, so nothing has to be resent on its account.
//
// Messages are JSON text frames, deliberately plain: the board is a Kotlin app
// with no reason to share the collaboration room's binary frames or its Yjs
// document, and there is no document here to merge, only a step and a sentence.
//
// Nothing here knows about React. The session is a store (see ../store.ts):
// the page reads its snapshot and calls its methods, and the same object works
// behind any view layer. apps/web/src/lib/practiceLink.js is the hook over it.

import { apiUrl, apiWsUrl, hasApi } from "../config.ts";
import { isRecord } from "../guards.ts";
import { createStore, type ReadableStore } from "../store.ts";

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

/** A new share code for a letterboard session. */
export function newPracticeCode(): string {
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
function wsBase(): string | null {
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
let availability: Promise<boolean> | null = null;

/** Whether this hub can host letterboard sessions. */
export function checkPracticeAvailable(): Promise<boolean> {
  if (!hasApi()) return Promise.resolve(false);
  if (availability) return availability;
  const asking: Promise<boolean> = fetch(`${apiUrl()}/practice`, {
    headers: { Accept: "application/json" },
  })
    .then((res) => (res.ok ? res.json() : { available: false }))
    .then((body: unknown) => isRecord(body) && body.available === true)
    .catch(() => {
      if (availability === asking) availability = null;
      return false;
    });
  availability = asking;
  return asking;
}

/** Forget the cached answer. For tests. */
export function forgetPracticeAvailability(): void {
  availability = null;
}

// ----- the session --------------------------------------------------------------

export type PracticeStatus = "idle" | "connecting" | "live";

/** Why a session isn't running, as a key the page translates. */
export type PracticeError =
  | "notConfigured"
  | "signIn"
  | "couldNotStart"
  | "refused"
  | "disconnected";

export interface PracticeHostState {
  status: PracticeStatus;
  /** The share code, while a session is being started or is live. */
  code: string | null;
  /** How many boards are listening. */
  boards: number;
  error: PracticeError | null;
}

/** Where the lesson is: what every board is told. */
export interface PracticePosition {
  /** The lesson that is open, or nothing for none yet. */
  lessonId?: string | null;
  /** The current step's index in buildInteractiveSteps' walkthrough. */
  step: number;
  /** What is in the answer box. */
  text: string;
}

/** What interactive mode does with what a board sends. */
export interface PracticeHandlers {
  /** A board's sentence changed. */
  onText?: (text: string) => void;
  /** A board finished an answer. */
  onAnswer?: (text: string) => void;
  /** A board asks to move to this step. */
  onStep?: (step: number) => void;
}

export interface PracticeHost extends ReadableStore<PracticeHostState> {
  /**
   * Open a session as its host. Needs the signed-in user's Supabase JWT, since
   * the host is the side that files the answers. Does nothing while one is
   * already open.
   */
  start(accessToken: string | null | undefined): void;
  /** End the session, quietly. The host can start another afterwards. */
  stop(): void;
  clearError(): void;
  /**
   * Where the lesson is now. Sent to the boards while the session is live,
   * coalesced over a short moment so a burst of keystrokes is one message.
   */
  setPosition(position: PracticePosition): void;
  /** Replace the callbacks, for a caller whose handlers change over time. */
  setHandlers(handlers: PracticeHandlers): void;
}

/**
 * Host a letterboard session for the lesson interactive mode has open.
 *
 * The session starts idle and is reusable: `stop` leaves it where it began,
 * and `start` opens a new one. Every handler on the socket checks that the
 * socket is still the session's before acting: closing is asynchronous, so a
 * socket we ended (End session, then Start again at once) still fires its
 * close and maybe a last message after a new one has taken its place, and
 * those must not end or feed the new session. The same check is what keeps a
 * teardown we caused from being reported as a disconnection.
 */
export function createPracticeHost(
  handlers: PracticeHandlers = {},
): PracticeHost {
  const store = createStore<PracticeHostState>({
    status: "idle",
    code: null,
    boards: 0,
    error: null,
  });

  let current: PracticeHandlers = handlers;
  let position: PracticePosition = { step: 0, text: "" };

  // The current session's socket, and whether the room has said hello: a close
  // before that is a refused join.
  let ws: WebSocket | null = null;
  let hello = false;
  let ping: ReturnType<typeof setInterval> | null = null;
  let stateTimer: ReturnType<typeof setTimeout> | null = null;

  const send = (message: Record<string, unknown>) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch {
        /* a socket mid-close; the close handler cleans up */
      }
    }
  };

  function cleanup() {
    if (ping) {
      clearInterval(ping);
      ping = null;
    }
    if (stateTimer) {
      clearTimeout(stateTimer);
      stateTimer = null;
    }
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    ws = null;
    hello = false;
  }

  // Tell the room where everyone is, soon. The room keeps the last one for
  // boards that join later, so sending on every change is also what catches a
  // late board up. `lessonId` is left out when there is none, which the
  // contract reads as "no lesson is open yet".
  function scheduleState() {
    if (store.getSnapshot().status !== "live") return;
    if (stateTimer) clearTimeout(stateTimer);
    stateTimer = setTimeout(() => {
      stateTimer = null;
      const { lessonId, step, text } = position;
      const state: Record<string, unknown> = { type: "state", step, text };
      if (lessonId) state.lessonId = lessonId;
      send(state);
    }, STATE_DEBOUNCE_MS);
  }

  function handleMessage(data: unknown) {
    if (typeof data !== "string") return;
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      return; // "pong", or something that isn't ours
    }
    if (!isRecord(msg)) return;
    switch (msg.type) {
      case "hello":
        hello = true;
        store.patch({
          status: "live",
          boards: Number.isInteger(msg.boards) ? (msg.boards as number) : 0,
        });
        // The first state goes out now, so a board that was waiting is caught up.
        scheduleState();
        break;
      case "boards":
        if (Number.isInteger(msg.count)) {
          store.patch({ boards: msg.count as number });
        }
        break;
      case "text":
        if (typeof msg.text === "string") current.onText?.(msg.text);
        break;
      case "answer":
        if (typeof msg.text === "string") current.onAnswer?.(msg.text);
        break;
      case "step":
        if (Number.isInteger(msg.step) && (msg.step as number) >= 0) {
          current.onStep?.(msg.step as number);
        }
        break;
      default:
        break; // a message type added later; the contract says to ignore it
    }
  }

  function start(accessToken: string | null | undefined) {
    if (ws) return;
    const base = wsBase();
    if (!base) {
      store.patch({ error: "notConfigured" });
      return;
    }
    if (!accessToken) {
      store.patch({ error: "signIn" });
      return;
    }

    const code = newPracticeCode();
    hello = false;
    store.patch({ error: null, status: "connecting", code, boards: 0 });

    const params = new URLSearchParams({ create: "1", token: accessToken });
    let socket: WebSocket;
    try {
      socket = new WebSocket(`${base}/practice/${code}?${params.toString()}`);
    } catch {
      store.patch({ error: "couldNotStart", status: "idle", code: null });
      return;
    }
    ws = socket;

    // Whether this handler's socket is still the session's (see above).
    const mine = () => ws === socket;

    socket.onopen = () => {
      if (!mine()) return;
      if (ping) clearInterval(ping);
      ping = setInterval(() => {
        if (!mine() || socket.readyState !== WebSocket.OPEN) return;
        try {
          socket.send("ping");
        } catch {
          /* the close handler cleans up */
        }
      }, PING_MS);
    };
    socket.onmessage = (ev) => {
      if (mine()) handleMessage(ev.data);
    };
    socket.onclose = () => {
      // Ours to report only if nothing replaced or ended it first.
      if (!mine()) return;
      // The Worker refuses an upgrade before the socket opens (an expired
      // sign-in, too many sessions started, a missing binding), which surfaces
      // here as a close without a hello. A browser is never told the status, so
      // the message names no single cause: "refused" says only that the hub
      // said no. Read before cleanup, which forgets the hello.
      const wasLive = hello;
      cleanup();
      store.patch({
        error: wasLive ? "disconnected" : "refused",
        status: "idle",
        code: null,
        boards: 0,
      });
    };
    socket.onerror = () => {
      // onclose runs next and owns the message.
    };
  }

  function stop() {
    cleanup();
    store.patch({ status: "idle", code: null, boards: 0 });
  }

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    start,
    stop,
    clearError: () => store.patch({ error: null }),
    setPosition(next) {
      position = next;
      scheduleState();
    },
    setHandlers(next) {
      current = next;
    },
  };
}
