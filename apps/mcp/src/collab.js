// Taking part in a live collaboration session with nothing held open.
//
// The web app joins a room over a WebSocket from a React hook
// (apps/web/src/lib/collab.js). This server can't do that: between tool calls
// it may not exist. On the remote transport it runs inside a Durable Object
// that hibernates between requests and rebuilds its server on the way back, so
// a socket opened in one tool call is gone by the next. Rather than fight that,
// the room (apps/api/src/collab-room.js) keeps the assistant as a *record* and
// answers questions about it: each tool call is one request to the room, and
// everything needed to make the next one is a small handle ({ code, token,
// slot }) that collabTools.js keeps in whatever store the transport provides.
//
// What this module holds is the arithmetic between the room's answers and the
// plain JSON every other tool in this server speaks: decoding the document,
// working out the Yjs update an edit amounts to, and reading the roster, chat
// and cursors out of a state envelope.
//
// Why a session at all, when this server can already read and write lessons over
// the API: because a live session is where the *unsaved* lesson is. The document
// in a room exists only in the room until somebody saves it, so the hub's copy is
// whatever it was before the session started. Editing through the API while a
// teacher has the lesson open in a session writes to the wrong document, and
// their next save overwrites it.
//
// The other half is that a room is bidirectional. An API write is a statement; a
// room is a conversation: the assistant's edits appear under a participant of
// its own, the teacher watches them land, and chat is a channel for asking
// rather than guessing.
//
// Three properties of the room the design leans on, none changed by asking
// instead of listening:
//
//   • Admission is the host's. A joining participant waits until the teacher
//     admits them, so nothing here can put an assistant into a session
//     uninvited. That is the consent gate, and it already existed.
//   • Edits merge. The room is a CRDT, so an assistant writing section 3 while
//     the teacher writes section 5 costs neither of them their work. What does
//     NOT merge is the same *field* — reconcile stores text as a plain string
//     (see core/ydoc.js), so two writers in one paragraph is still
//     last-write-wins. Hence edit_collab_doc refuses a block someone else's
//     caret is sitting in, which busyBlocks() below reads from the envelope.
//   • Removal is instant. The host can eject a participant mid-thought, and the
//     assistant's very next request is told so.

import * as Y from "yjs";

import { docFromY, reconcile } from "@spelling-creator/core/ydoc";

// How long join_collab_session waits, within one call, for the host to admit
// us. Generous, because the teacher has to notice the request and click: this
// is a person's reaction time, not a network round trip. But kept under a
// minute so it never collides with an MCP client's own request timeout; a call
// that runs out says so and the next one picks the same request back up.
export const JOIN_WAIT_MS = 50_000;
// The longest one ask may sit in the room waiting for admission. The room caps
// this itself (AGENT_WAIT_MAX_MS there); a longer figure here would be clamped.
const POLL_WAIT_S = 25;

/** Base64 to bytes, without Buffer: this runs on Node and in workerd alike. */
export function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// A replica of the room's document, from the state it sent.
function replica(state) {
  const ydoc = new Y.Doc();
  if (state?.doc) Y.applyUpdate(ydoc, fromBase64(state.doc));
  return ydoc;
}

/** The lesson as the room holds it, as the plain document the editor renders. */
export function docOf(state) {
  return docFromY(replica(state));
}

/**
 * The Yjs update that turns the room's document into `next`, or null when
 * nothing would change.
 *
 * Built on a replica of the room's own state and reconciled the way the
 * browser reconciles, so the update carries exactly the fields that differ and
 * merges with whatever the teacher typed in the meantime the same way an edit
 * made in the editor would. Encoding against the state vector from before the
 * edit keeps the update to the edit itself rather than the whole document.
 */
export function updateFor(state, next) {
  const ydoc = replica(state);
  const before = Y.encodeStateVector(ydoc);
  let changed = false;
  const mark = () => {
    changed = true;
  };
  ydoc.on("update", mark);
  reconcile(ydoc, next);
  ydoc.off("update", mark);
  return changed ? Y.encodeStateAsUpdate(ydoc, before) : null;
}

/**
 * Which blocks another participant's caret is in right now, block id -> name.
 *
 * The CRDT merges edits to different fields but not to the same one, so this
 * is what stops an assistant overwriting the sentence a teacher is midway
 * through typing. Cursors are advisory and go stale, which is why the tools
 * read a fresh envelope at the moment of the edit rather than caching one.
 */
export function busyBlocks(state) {
  const busy = new Map();
  const names = new Map(
    (state.participants || []).map((p) => [p.slot, p.name]),
  );
  for (const [slot, cursor] of Object.entries(state.cursors || {})) {
    if (!cursor?.field) continue;
    const n = Number(slot);
    if (n === state.slot) continue;
    busy.set(cursor.field, names.get(n) || `participant ${slot}`);
  }
  return busy;
}

/** Chat the room kept for us since the last ask, oldest first, senders named. */
export function chatOf(state) {
  return (state?.chat || []).map((m) => ({
    from: m.name || `participant ${m.from}`,
    text: String(m.text || ""),
    at: new Date(Number(m.ts) || Date.now()).toISOString(),
  }));
}

/**
 * Wait, within `budgetMs`, for the host to admit us.
 *
 * Each ask lets the room hold the request open for a while, so this is a few
 * long requests rather than a tight loop. Resolves to the last state seen,
 * admitted or not; a decline arrives as the room's 410, which api.collabState
 * throws with `gone` set and this lets through.
 */
export async function waitForAdmission(
  api,
  handle,
  { budgetMs = JOIN_WAIT_MS } = {},
) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const remainingMs = Math.max(0, deadline - Date.now());
    const wait = Math.min(POLL_WAIT_S, Math.ceil(remainingMs / 1000));
    const state = await api.collabState(handle.code, handle.token, { wait });
    if (state.admitted || Date.now() >= deadline) return state;
  }
}
