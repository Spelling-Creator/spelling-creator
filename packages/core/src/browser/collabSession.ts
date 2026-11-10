// Real-time lesson collaboration over a Cloudflare Durable Object (one WebSocket
// per participant). Every participant connects a single WebSocket to a
// server-side "room" (the CollabRoom Durable Object; see
// apps/api/src/collab-room.js). The Worker verifies the signed-in user's Supabase
// JWT before the connection reaches the room, so only logged-in users can join
// and their identity is established server-side rather than self-asserted.
//
// Admission model. A guest who connects is NOT a collaborator yet: they wait
// until the host adds them (see `admit`). Only after being added does the room
// hand them the lesson and start syncing. Trusted collaborators (an email list
// saved on the doc) bypass the waiting room: the host auto-admits them the
// instant their request arrives.
//
// Sync model. A CRDT (Yjs). Each participant keeps a Y.Doc mirroring the
// editor's plain document; the room merges and relays the updates. Two people
// editing different blocks both keep their work. ../ydoc.ts owns the document
// model and the plain-JSON <-> Yjs bridge; this file owns the socket.
//
// The loop, and why it settles:
//
//   local edit  -> setDoc -> reconcile(ydoc, doc, LOCAL) -> Yjs emits an update
//                                                        -> we send it
//   remote frame -> Y.applyUpdate(..., REMOTE) -> onRemoteDoc(docFromY(ydoc))
//                -> the editor adopts it -> setDoc -> reconcile again
//                -> no difference -> no update
//
// That last step is the whole trick: `reconcile` is idempotent, so applying a
// remote edit doesn't bounce it straight back.
//
// Wire protocol: binary frames for speed, defined once in ../collabFrames.ts
// (see it for the frame shapes). A peer is identified by a server-assigned
// numeric "slot"; we map slot -> identity from the presence roster so cursors
// and chat can be labelled without shipping a name in every packet.
//
// Nothing here knows about React. The session is a store (see ../store.ts):
// the editor reads its snapshot and calls its methods, and feeds it the
// document, the identity and the callbacks as they change.
// apps/web/src/lib/collab.js is the hook over it.

import * as Y from "yjs";
import { apiWsUrl, hasApi } from "../config.ts";
import {
  T,
  frameBytes as frame,
  frameJson as jsonFrame,
  readJson,
  readSlot,
  readText,
  slotFrame,
} from "../collabFrames.ts";
import { preserveLocalFields, stripLocalFields } from "../git/doc.ts";
import { isRecord } from "../guards.ts";
import { newId } from "../id.ts";
import { createStore, type ReadableStore } from "../store.ts";
import type { LessonDoc } from "../types.ts";
import { LOCAL, applyRemote, docFromY, reconcile } from "../ydoc.ts";
import { colorForId } from "./presence.ts";

// How long to sit on a burst of local edits before pushing them into the Y.Doc.
// Short, because a CRDT update is bytes rather than a re-serialised lesson.
const SYNC_DEBOUNCE_MS = 50;

// Cap on a single chat message so a peer can't flood the channel with a huge
// string. Chat is ephemeral (kept only in memory for the session).
const MAX_CHAT_LEN = 2000;

// Heartbeat so an idle (backgrounded-tab) connection isn't dropped. A text
// "ping" the room auto-answers with "pong"; we send a string (not a binary
// frame) so the auto-response matches and the reply is ignored by the message
// handler (it only handles ArrayBuffers). Background tabs throttle timers to
// about once a minute, so 20s keeps us comfortably under idle timeouts.
const PING_MS = 20000;

export type CollabStatus =
  | "idle"
  | "connecting"
  | "hosting"
  | "joined"
  | "error";

export type CollabRole = "host" | "guest";

/** The local user, for our own chat bubbles and so we never credit ourselves. */
export interface CollabIdentity {
  uid?: string | null;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}

/** Someone in the session, admitted or waiting. */
export interface Participant {
  /** The server-assigned slot. */
  id: number;
  name: string;
  email: string;
  avatarUrl: string;
  host: boolean;
  /**
   * An AI assistant joined on someone's account, so the roster and the
   * floating cursors can say so rather than showing a second person by that
   * name.
   */
  bot: boolean;
}

/** Where another collaborator is editing, keyed by their slot as a string. */
export interface CollabSelection {
  uid: string;
  name: string;
  email: string;
  avatarUrl: string;
  color: string;
  field: string | null;
  start: number | null;
  end: number | null;
  ts: number;
}

/** Where we are editing. A null field means "no longer editing". */
export interface LocalSelection {
  field?: string | null;
  start?: number | null;
  end?: number | null;
}

export interface ChatMessage {
  id: string;
  uid: string;
  name: string;
  email: string;
  avatarUrl: string;
  text: string;
  ts: number;
}

/** Someone whose edits have arrived since version history last committed. */
export interface CoAuthor {
  uid: string;
  name: string;
  seq: number;
}

/**
 * Who version history should credit on its next commit. `peek` lists everyone
 * whose edits arrived since the last commit; `clear` forgets the people a
 * commit attempt has dealt with. An entry whose seq changed in between (they
 * edited again while the commit was being written) is kept, because that
 * later edit may not be in the commit that was just taken. `discard` forgets
 * everyone, for when the editor moves to another lesson and whatever is still
 * pending belongs to the one it left.
 */
export interface CoAuthors {
  peek(): CoAuthor[];
  clear(credited: CoAuthor[]): void;
  discard(): void;
}

export interface CollabSessionState {
  status: CollabStatus;
  role: CollabRole | null;
  /** The room's share code. */
  myCode: string | null;
  participants: Participant[];
  /** Host only: who is waiting to be admitted. */
  requests: Participant[];
  error: string | null;
  /** Live editing positions of the other collaborators. */
  selections: Record<string, CollabSelection>;
  /** Chat transcript for this session, oldest first. Ephemeral. */
  messages: ChatMessage[];
  /**
   * Whether our Y.Doc is part of the session's document yet, and so whether
   * local edits are being pushed into it. False for a guest until the host
   * admits them; see the note on startSyncing.
   */
  synced: boolean;
  /** Our own slot, as the string the selections are keyed by. */
  myId: string | null;
}

export interface CollabCallbacks {
  /** A document received from the room; should replace the editor's. */
  onRemoteDoc?: (doc: LessonDoc) => void;
  /**
   * Guest only: called once the host admits us, before the room's document
   * reaches `onRemoteDoc`, to give the session a lesson of its own. May return
   * a promise; nothing is synced until it settles.
   */
  onAdmitted?: (doc: LessonDoc) => void | Promise<void>;
}

export interface CollabSessionOptions extends CollabCallbacks {
  /** The editor document, as it stands now. */
  doc?: LessonDoc | null;
  identity?: CollabIdentity | null;
}

export interface CollabSession extends ReadableStore<CollabSessionState> {
  /**
   * The editor document now. Pushed into the session's Y.Doc, lightly
   * debounced so a burst of keystrokes becomes one update, and only once we
   * are syncing. Giving it a document we just adopted from the room is fine:
   * reconcile is idempotent, so nothing is echoed back.
   */
  setDoc(doc: LessonDoc | null | undefined): void;
  setIdentity(identity: CollabIdentity | null | undefined): void;
  setCallbacks(callbacks: CollabCallbacks): void;
  /** Open a room as its host. Needs the signed-in user's Supabase JWT. */
  startHosting(accessToken: string | null | undefined): void;
  /** Connect to someone's room and wait to be admitted. */
  joinSession(
    code: string | null | undefined,
    accessToken: string | null | undefined,
  ): void;
  /** Host: add a pending guest to the lesson. */
  admit(slot: number): void;
  /** Host: decline a pending guest or remove an existing collaborator. */
  removeParticipant(slot: number): void;
  /** Tear the session down. The session is idle again and can start another. */
  leave(): void;
  /** Broadcast where we're editing, or that we've stopped (null). */
  setLocalSelection(selection: LocalSelection | null): void;
  sendChat(text: string): void;
  clearError(): void;
  readonly coAuthors: CoAuthors;
}

// A short label for someone we don't have a name for yet.
function shortId(slot: number) {
  return `guest ${slot}`;
}

const str = (value: unknown) => (typeof value === "string" ? value : "");

// One entry of the presence roster, as the room sends it.
interface RosterEntry {
  slot: number;
  uid: string;
  name: string;
  email: string;
  avatarUrl: string;
  host: boolean;
  bot: boolean;
}

function rosterEntries(value: unknown): RosterEntry[] {
  if (!Array.isArray(value)) return [];
  const out: RosterEntry[] = [];
  for (const p of value) {
    if (!isRecord(p) || typeof p.slot !== "number") continue;
    out.push({
      slot: p.slot,
      uid: str(p.uid),
      name: str(p.name),
      email: str(p.email),
      avatarUrl: str(p.avatarUrl),
      host: p.host === true,
      bot: Boolean(p.bot),
    });
  }
  return out;
}

function toParticipant(p: RosterEntry): Participant {
  return {
    id: p.slot,
    name: p.name,
    email: p.email,
    avatarUrl: p.avatarUrl,
    host: p.host,
    bot: p.bot,
  };
}

const IDLE: CollabSessionState = {
  status: "idle",
  role: null,
  myCode: null,
  participants: [],
  requests: [],
  error: null,
  selections: {},
  messages: [],
  synced: false,
  myId: null,
};

/**
 * A collaboration session: idle until `startHosting` or `joinSession`, and
 * idle again after `leave`, so one object serves an editor for its whole life.
 */
export function createCollabSession(
  options: CollabSessionOptions = {},
): CollabSession {
  const store = createStore<CollabSessionState>(IDLE);

  // The editor's inputs, as last given.
  let doc: LessonDoc | null = options.doc ?? null;
  let identity: CollabIdentity | null = options.identity ?? null;
  let callbacks: CollabCallbacks = {
    onRemoteDoc: options.onRemoteDoc,
    onAdmitted: options.onAdmitted,
  };

  let ws: WebSocket | null = null;
  // Our server-assigned slot for this session, and our role.
  let mySlot: number | null = null;
  let role: CollabRole | null = null;
  // slot -> identity, so cursors and chat are labelled from the presence
  // roster rather than trusting per-message identity.
  let roster = new Map<number, RosterEntry>();
  // Everyone whose edits have reached us since version history last committed,
  // by account id. Not cleared by the socket teardown, since edits that
  // arrived just before a session ended are still theirs: the editor
  // checkpoints the moment a session ends instead, and that commit credits
  // them or finds nothing to credit.
  const contributors = new Map<string, CoAuthor>();
  let contributionSeq = 0;
  // This session's CRDT document, and whether we're syncing into it yet.
  let ydoc: Y.Doc | null = null;
  let synced = false;
  // True while a newly admitted guest's editor is moving into the session's
  // own lesson. Updates still merge into the Y.Doc meanwhile, but none reaches
  // the editor, which is still holding the guest's previous lesson until the
  // move is done (see the ADMITTED case).
  let holding = false;
  // True while we're intentionally tearing down, so the close handler doesn't
  // surface a spurious "disconnected" error.
  let closing = false;
  let ping: ReturnType<typeof setInterval> | null = null;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;

  const sendFrame = (bytes: Uint8Array) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        // Every frame is a fresh array over its own buffer (collabFrames.ts
        // and Yjs both allocate), never a view over shared memory, which is
        // all the socket's narrower type is asking.
        ws.send(bytes as Uint8Array<ArrayBuffer>);
      } catch {
        /* a socket mid-close; the close handler cleans up */
      }
    }
  };

  // Open this session's Y.Doc. Every change it accepts emits an update, and
  // the ones that originated locally are exactly the ones we broadcast: an
  // edit we merged from the room carries the REMOTE origin, so it is never
  // echoed back.
  function openYDoc() {
    const next = new Y.Doc();
    next.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === LOCAL) sendFrame(frame(T.UPDATE, update));
    });
    ydoc = next;
  }

  // Push our document into the Y.Doc, and so, through its update handler, to
  // the room, **without** the trusted-collaborator list.
  //
  // That list is email addresses, and the Y.Doc is mirrored to everyone the
  // host admits, who are not necessarily on it. Nobody in a session needs it
  // either: only the host reads it (to auto-admit trusted guests), from their
  // own copy, and the Worker ignores whatever a non-author's save claims it
  // should be.
  function pushLocal(next: LessonDoc | null) {
    if (ydoc && next) reconcile(ydoc, stripLocalFields(next), LOCAL);
  }

  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      if (synced) pushLocal(doc);
    }, SYNC_DEBOUNCE_MS);
  }

  // Start pushing local edits into the Y.Doc.
  //
  // A guest is deliberately NOT syncing the moment they connect. They're
  // sitting in their own editor with their own lesson open, and a CRDT
  // *unions* documents rather than replacing them, so reconciling that lesson
  // into the Y.Doc before the host admitted them would merge their content
  // into the host's lesson. A guest therefore starts with an empty Y.Doc and
  // only begins syncing once ADMITTED has delivered the real one. The host,
  // whose document *is* the lesson, starts syncing immediately.
  function startSyncing() {
    synced = true;
    store.patch({ synced: true });
    schedulePush();
  }

  // Merge an update from the room, then hand the resulting document to the
  // editor.
  //
  // The room never carries the trusted-collaborator list (see pushLocal), so
  // what comes back out has none, and for the **host** that would wipe theirs,
  // so it's put back from the doc they're holding, exactly as a git restore
  // does.
  //
  // Deliberately not for a guest. A guest's editor holds a lesson made for the
  // session (see the ADMITTED case), not the host's own, so the host's list is
  // not theirs to graft on. They adopt the document without the field, which
  // is the honest answer: it was never theirs to hold. Saving is unaffected:
  // the Worker keeps the stored list when the field is absent.
  function mergeRemote(bytes: Uint8Array) {
    if (!ydoc || bytes.length === 0) return;
    applyRemote(ydoc, bytes);
    // A guest still moving into the session's lesson: keep the edit in the
    // Y.Doc, where the editor picks it up once it has somewhere to put it.
    if (holding) return;
    const next = docFromY(ydoc);
    callbacks.onRemoteDoc?.(
      role === "host" ? preserveLocalFields(next, doc) : next,
    );
  }

  // Record (or, when a peer leaves their field, clear) a collaborator's
  // editing position. A cursor with no `field` means "I'm no longer editing".
  function applyCursor(cursor: CollabSelection) {
    const prev = store.getSnapshot().selections;
    if (!cursor.field && !(cursor.uid in prev)) return;
    const next = { ...prev };
    if (!cursor.field) delete next[cursor.uid];
    else next[cursor.uid] = cursor;
    store.patch({ selections: next });
  }

  // Append a received chat message, ignoring duplicates (deduped by id).
  function addMessage(message: ChatMessage) {
    const prev = store.getSnapshot().messages;
    if (prev.some((x) => x.id === message.id)) return;
    store.patch({ messages: [...prev, message] });
  }

  // Whether an email is on this lesson's trusted-collaborator list (read from
  // the live doc). Trusted guests are auto-admitted the moment their request
  // arrives.
  function isTrustedEmail(email: string) {
    const norm = email.trim().toLowerCase();
    if (!norm) return false;
    const list = doc?.trustedCollaborators;
    return (
      Array.isArray(list) &&
      list.some((t) => (t?.email || "").trim().toLowerCase() === norm)
    );
  }

  // The room flips an admitted guest to admitted, hands them the current doc,
  // and starts syncing them.
  const admit = (slot: number) => sendFrame(slotFrame(T.ADMIT, slot));
  const removeParticipant = (slot: number) =>
    sendFrame(slotFrame(T.REMOVE, slot));

  function cleanup() {
    closing = true;
    if (ping) {
      clearInterval(ping);
      ping = null;
    }
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    ws = null;
    mySlot = null;
    roster = new Map();
    // The Y.Doc belongs to the session, not to the editor: a new session
    // starts from a fresh one, so the previous lesson can't bleed into it.
    ydoc?.destroy();
    ydoc = null;
    holding = false;
    synced = false;
    store.patch({ synced: false, selections: {}, messages: [], myId: null });
  }

  // Leave the session with a message for the person, idle again.
  function end(error: string, status: CollabStatus = "idle") {
    cleanup();
    role = null;
    store.patch({ error, status, role: null });
  }

  // Handle a single binary frame from the room. Shared by host and guest.
  function handleFrame(buf: ArrayBuffer) {
    const view = new Uint8Array(buf);
    if (view.length < 1) return;

    switch (view[0]) {
      case T.HELLO: {
        const slot = readSlot(view);
        const host = view[3] === 1;
        mySlot = slot;
        role = host ? "host" : "guest";
        store.patch({
          role,
          myId: String(slot),
          status: host ? "hosting" : "joined",
        });
        if (host) {
          // Seed the room with our lesson: reconciling it into our fresh
          // Y.Doc emits one update carrying the whole document, which the
          // Y.Doc's update handler sends for us.
          pushLocal(doc);
          startSyncing();
        }
        break;
      }
      case T.ADMITTED: {
        // We're in. The payload is the room's whole document as a single Yjs
        // update.
        //
        // It must not simply replace the editor's document. The editor is
        // still on whatever lesson we had open before joining, and its library
        // save and version history are tied to that lesson, so adopting the
        // room's document there would overwrite it with the host's. So the
        // editor first moves into a lesson of the session's own (onAdmitted),
        // and edits arriving meanwhile wait in the Y.Doc (holding). Only then
        // does the room's document reach the editor and our own edits start
        // syncing, both in the same tick, so the first thing we push is the
        // session's lesson and never the one we left.
        const mine = ydoc;
        if (!mine) break;
        holding = true;
        applyRemote(mine, view.subarray(1));
        Promise.resolve()
          .then(() => callbacks.onAdmitted?.(docFromY(mine)))
          .then(
            () => {
              holding = false;
              // Left, removed or disconnected while the editor was moving.
              if (ydoc !== mine) return;
              callbacks.onRemoteDoc?.(docFromY(mine));
              startSyncing();
            },
            () => {
              holding = false;
              if (ydoc !== mine) return;
              // Without a lesson of its own, the session would be written
              // into the one we had open, which is exactly what this guards.
              end(
                "Couldn't open a lesson for this session, so you've left it. Please try joining again.",
              );
            },
          );
        break;
      }
      case T.EDITED: {
        // The update that follows is this peer's. Noted now, before it lands,
        // so the commit that picks their work up is the one that credits them.
        const info = roster.get(readSlot(view));
        if (!info?.uid || info.uid === identity?.uid) break;
        contributors.set(info.uid, {
          uid: info.uid,
          name: info.name,
          seq: ++contributionSeq,
        });
        break;
      }
      case T.UPDATE: {
        mergeRemote(view.subarray(1));
        break;
      }
      case T.CURSOR: {
        const slot = readSlot(view);
        const sel = readJson(view, { withSlot: true });
        if (sel === null) break;
        const info = roster.get(slot);
        const field =
          isRecord(sel) && typeof sel.field === "string" && sel.field
            ? sel.field
            : null;
        applyCursor({
          uid: String(slot),
          name: info?.name || shortId(slot),
          email: info?.email || "",
          avatarUrl: info?.avatarUrl || "",
          color: colorForId(String(slot)),
          field,
          start:
            isRecord(sel) && typeof sel.start === "number" ? sel.start : null,
          end: isRecord(sel) && typeof sel.end === "number" ? sel.end : null,
          ts: Date.now(),
        });
        break;
      }
      case T.CHAT: {
        const slot = readSlot(view);
        const msg = readJson(view, { withSlot: true });
        if (!isRecord(msg)) break;
        const info = roster.get(slot);
        addMessage({
          id: typeof msg.id === "string" && msg.id ? msg.id : newId(),
          uid: String(slot),
          name: info?.name || shortId(slot),
          email: info?.email || "",
          avatarUrl: info?.avatarUrl || "",
          text: String(msg.text || "").slice(0, MAX_CHAT_LEN),
          ts: typeof msg.ts === "number" && msg.ts ? msg.ts : Date.now(),
        });
        break;
      }
      case T.PRESENCE: {
        const payload = readJson(view);
        if (!isRecord(payload)) break;
        const list = rosterEntries(payload.participants);
        const reqs = rosterEntries(payload.requests);

        // Refresh the slot -> identity map used to label cursors and chat.
        roster = new Map();
        for (const p of [...list, ...reqs]) roster.set(p.slot, p);

        store.patch({
          participants: list.map(toParticipant),
          requests: reqs.map(toParticipant),
        });

        // Auto-admit trusted collaborators (host only). admit is idempotent:
        // once admitted they move out of `requests`, so this won't loop.
        if (role === "host") {
          for (const r of reqs) if (isTrustedEmail(r.email)) admit(r.slot);
        }

        // Drop cursors for anyone no longer present.
        const present = new Set(list.map((p) => String(p.slot)));
        const prev = store.getSnapshot().selections;
        const next: Record<string, CollabSelection> = {};
        let dropped = false;
        for (const key of Object.keys(prev)) {
          if (present.has(key)) next[key] = prev[key];
          else dropped = true;
        }
        if (dropped) store.patch({ selections: next });
        break;
      }
      case T.REMOVED: {
        const reason = view.length > 1 ? readText(view) : "";
        end(
          reason === "removed" || !reason
            ? "The host removed you from the lesson."
            : reason,
        );
        break;
      }
      case T.ERROR: {
        end(view.length > 1 ? readText(view) : "Connection error.", "error");
        break;
      }
      default:
        break;
    }
  }

  // Open a WebSocket to the room and wire its lifecycle. Shared by host and
  // guest.
  function connect(
    code: string,
    create: boolean,
    accessToken: string | null | undefined,
  ) {
    const base = hasApi() ? apiWsUrl() : null;
    if (!base) {
      store.patch({
        error: "Collaboration is not configured.",
        status: "error",
      });
      return;
    }
    if (!accessToken) {
      store.patch({ error: "Sign in to collaborate." });
      return;
    }
    if (ws) return;

    role = create ? "host" : "guest";
    closing = false;
    mySlot = null;
    roster = new Map();
    synced = false;
    store.patch({ error: null, status: "connecting", role, synced: false });
    openYDoc();

    const params = new URLSearchParams({ token: accessToken });
    if (create) params.set("create", "1");
    let socket: WebSocket;
    try {
      socket = new WebSocket(
        `${base}/collab/${encodeURIComponent(code)}?${params.toString()}`,
      );
    } catch {
      store.patch({ error: "Could not start collaboration.", status: "error" });
      return;
    }
    socket.binaryType = "arraybuffer";
    ws = socket;

    socket.onopen = () => {
      if (ping) clearInterval(ping);
      ping = setInterval(() => {
        const sock = ws;
        if (sock && sock.readyState === WebSocket.OPEN) {
          try {
            sock.send("ping");
          } catch {
            /* a socket mid-close; the close handler cleans up */
          }
        }
      }, PING_MS);
    };
    socket.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) handleFrame(ev.data);
    };
    socket.onclose = () => {
      if (closing) return;
      ws = null;
      // The Worker rejects an unauthenticated or rate-limited upgrade before
      // the socket opens, which surfaces here as a close without a HELLO.
      let error = store.getSnapshot().error;
      if (mySlot == null) {
        error = create
          ? "Couldn't start the session. Please sign in and try again."
          : "Couldn't connect. The code may be wrong, the host may have left, or you've hit the rate limit.";
      } else if (!error) {
        error = "Disconnected from the collaboration session.";
      }
      end(error ?? "Disconnected from the collaboration session.");
    };
    socket.onerror = () => {
      // onclose runs next and owns the user-facing message.
    };
  }

  const coAuthors: CoAuthors = {
    peek: () => [...contributors.values()],
    clear(credited) {
      for (const person of credited) {
        if (contributors.get(person.uid)?.seq === person.seq) {
          contributors.delete(person.uid);
        }
      }
    },
    discard: () => contributors.clear(),
  };

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    coAuthors,

    setDoc(next) {
      doc = next ?? null;
      if (synced && ydoc) schedulePush();
    },
    setIdentity(next) {
      identity = next ?? null;
    },
    setCallbacks(next) {
      callbacks = next;
    },

    startHosting(accessToken) {
      if (ws) return;
      const code = newId();
      store.patch({ myCode: code });
      connect(code, true, accessToken);
    },
    joinSession(code, accessToken) {
      const room = (code || "").trim();
      if (!room) {
        store.patch({ error: "Enter a session code to join." });
        return;
      }
      store.patch({ myCode: room });
      connect(room, false, accessToken);
    },
    admit,
    removeParticipant,
    leave() {
      cleanup();
      role = null;
      store.set(IDLE);
    },

    // We send only { field, start, end }; the room stamps our slot and peers
    // label the cursor from the presence roster. We never add it to our own
    // `selections`.
    setLocalSelection(sel) {
      if (mySlot == null) return;
      sendFrame(
        jsonFrame(T.CURSOR, {
          field: sel && sel.field ? sel.field : null,
          start: sel ? (sel.start ?? null) : null,
          end: sel ? (sel.end ?? null) : null,
        }),
      );
    },

    // Our own message is shown at once (optimistically); the room relays it
    // to the other peers.
    sendChat(text) {
      const body = String(text || "")
        .trim()
        .slice(0, MAX_CHAT_LEN);
      if (!body || mySlot == null) return;
      const me = identity || {};
      const id = newId();
      const ts = Date.now();
      addMessage({
        id,
        uid: String(mySlot),
        name: me.name || "",
        email: me.email || "",
        avatarUrl: me.avatarUrl || "",
        text: body,
        ts,
      });
      sendFrame(jsonFrame(T.CHAT, { id, text: body, ts }));
    },

    clearError: () => store.patch({ error: null }),
  };
}
