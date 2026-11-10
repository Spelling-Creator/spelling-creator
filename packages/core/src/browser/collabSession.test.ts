// A collaboration session against a stub room.
//
// The room is a stub WebSocket the test drives by hand, speaking the real wire
// format from ../collabFrames.ts. The session is driven as the editor drives it:
// given the document and the callbacks, read through its snapshot.
//
// The guest cases guard the bug (#122) where the room's document used to reach
// the editor the moment the host admitted a guest, while the editor was still
// on the guest's own lesson, so the host's lesson was saved over it. The
// session waits for `onAdmitted` (the editor moving into a lesson of the
// session's own) before handing anything over or syncing anything back.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { T, frameBytes, frameJson, frameWithSlot } from "../collabFrames.ts";
import { configureCore } from "../config.ts";
import type { LessonDoc } from "../types.ts";
import { REMOTE, docFromY, reconcile } from "../ydoc.ts";
import { createCollabSession, type CollabSession } from "./collabSession.ts";
import { colorForId } from "./presence.ts";

// ---- the stub room ----------------------------------------------------------

class StubSocket {
  static OPEN = 1;
  static instances: StubSocket[] = [];

  url: string;
  binaryType = "blob";
  readyState = 0;
  sent: unknown[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    StubSocket.instances.push(this);
  }

  send(data: unknown) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.readyState = 3;
  }

  // Test side: open the socket, then deliver frames from the "room".
  open() {
    this.readyState = StubSocket.OPEN;
    this.onopen?.();
  }

  receive(bytes: Uint8Array) {
    const copy = new Uint8Array(bytes);
    this.onmessage?.({ data: copy.buffer });
  }

  // The room dropped us.
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }

  // Every frame of one type this client has sent.
  frames(type: number) {
    return this.sent.filter(
      (d): d is Uint8Array => d instanceof Uint8Array && d[0] === type,
    );
  }

  // Every document update this client has sent, decoded from the frames.
  updatesSent() {
    return this.frames(T.UPDATE).map((d) => d.subarray(1));
  }
}

function hello(slot: number, host: boolean) {
  return Uint8Array.of(T.HELLO, (slot >> 8) & 0xff, slot & 0xff, host ? 1 : 0);
}

const utf8 = new TextEncoder();

// ---- documents ----------------------------------------------------------------

const block = (id: string, text: string) => ({ id, type: "text", text });
const lesson = (
  title: string,
  sectionId: string,
  blocks: ReturnType<typeof block>[],
): LessonDoc =>
  ({
    title,
    sections: [{ id: sectionId, name: "One", blocks }],
  }) as unknown as LessonDoc;

const GUEST_OWN = lesson("My own lesson", "mine", [
  block("g1", "the guest's own words"),
]);
const HOST_LESSON: LessonDoc = {
  ...lesson("Host's lesson", "host", [block("h1", "the host's first block")]),
  trustedCollaborators: [{ email: "Trusted@Example.com", name: "Tess" }],
};
const { trustedCollaborators: _list, ...HOST_PUBLIC } = HOST_LESSON;

// The room's copy of the session: seeded from the host's lesson, as the host's
// first update does in the real thing.
function roomFor(doc: LessonDoc) {
  const ydoc = new Y.Doc();
  reconcile(ydoc, doc, REMOTE);
  return ydoc;
}

/** An update that turns the room's document into `next`. */
function editRoom(room: Y.Doc, next: LessonDoc) {
  const before = Y.encodeStateVector(room);
  reconcile(room, next, REMOTE);
  return Y.encodeStateAsUpdate(room, before);
}

/** The room's document after taking every update this client sent. */
function roomAfter(ws: StubSocket, room = new Y.Doc()) {
  for (const update of ws.updatesSent()) Y.applyUpdate(room, update, "test");
  return docFromY(room);
}

// ---- the harness ----------------------------------------------------------------

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Let timers and promise callbacks run. 100ms is past the 50ms push debounce.
const settle = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A session wired the way EditorPage wires it: `onRemoteDoc` replaces the
 * editor's document, which comes straight back in through `setDoc`.
 */
function editor(
  initial: LessonDoc,
  identity: { uid: string; name: string },
  onAdmitted?: (doc: LessonDoc) => void | Promise<void>,
) {
  const handle = { doc: initial, remoteDocs: [] as LessonDoc[] };
  const session = createCollabSession({ doc: initial, identity });
  session.setCallbacks({
    onRemoteDoc: (next) => {
      handle.remoteDocs.push(next);
      handle.doc = next;
      session.setDoc(next);
    },
    onAdmitted,
  });
  return {
    session,
    handle,
    setDoc(next: LessonDoc) {
      handle.doc = next;
      session.setDoc(next);
    },
  };
}

const PRESENCE = frameJson(T.PRESENCE, {
  participants: [
    { slot: 0, uid: "host-uid", name: "Host", host: true },
    { slot: 1, uid: "guest-uid", name: "Guest", host: false },
  ],
  requests: [],
});

/** Join, get admitted, and return the socket and the room's document. */
function joinAndAdmit(session: CollabSession) {
  session.joinSession("room-code", "token");
  const ws = StubSocket.instances.at(-1)!;
  ws.open();
  ws.receive(hello(1, false));
  ws.receive(PRESENCE);
  const room = roomFor(HOST_PUBLIC);
  ws.receive(frameBytes(T.ADMITTED, Y.encodeStateAsUpdate(room)));
  return { ws, room };
}

/** Host a session and get through HELLO and the first roster. */
function hostSession(session: CollabSession) {
  session.startHosting("token");
  const ws = StubSocket.instances.at(-1)!;
  ws.open();
  ws.receive(hello(0, true));
  ws.receive(PRESENCE);
  return ws;
}

// ---- tests ----------------------------------------------------------------------

let session: CollabSession | null = null;

beforeEach(() => {
  StubSocket.instances = [];
  vi.stubGlobal("WebSocket", StubSocket);
  configureCore({ apiUrl: "https://api.example.test" });
});

afterEach(() => {
  session?.leave();
  session = null;
  vi.unstubAllGlobals();
});

describe("joining a live session as a guest", () => {
  it("keeps the host's lesson out of the editor until onAdmitted settles", async () => {
    const move = deferred();
    const onAdmitted = vi.fn((_doc: LessonDoc) => move.promise);
    const made = editor(
      GUEST_OWN,
      { uid: "guest-uid", name: "Guest" },
      onAdmitted,
    );
    session = made.session;

    const { ws, room } = joinAndAdmit(session);
    await settle();

    // The editor is asked to move first, and handed the host's lesson to do it.
    expect(onAdmitted).toHaveBeenCalledTimes(1);
    expect(onAdmitted.mock.calls[0][0]).toEqual(HOST_PUBLIC);

    // Meanwhile the editor still holds the guest's own lesson, untouched.
    expect(made.handle.remoteDocs).toEqual([]);
    expect(made.handle.doc).toEqual(GUEST_OWN);
    expect(session.getSnapshot().synced).toBe(false);

    // The host keeps editing while the move is in progress.
    const edited = lesson("Host's lesson", "host", [
      block("h1", "the host's first block"),
      block("h2", "added during the move"),
    ]);
    ws.receive(frameBytes(T.UPDATE, editRoom(room, edited)));
    await settle();
    expect(made.handle.remoteDocs).toEqual([]);

    // And the guest sent the room nothing, so their own lesson was never
    // merged into the host's.
    expect(ws.updatesSent()).toEqual([]);

    // The move finishes: the editor now gets the session's latest document,
    // including the edit that arrived meanwhile.
    move.resolve();
    await settle();
    expect(made.handle.remoteDocs).toHaveLength(1);
    expect(made.handle.doc).toEqual(edited);
    expect(session.getSnapshot().status).toBe("joined");
    expect(session.getSnapshot().synced).toBe(true);

    // Adopting the room's document doesn't echo anything back to it...
    expect(ws.updatesSent()).toEqual([]);

    // ...and from here the guest's edits do sync, carrying nothing of the lesson
    // they had open before joining.
    const guestEdit = lesson("Host's lesson", "host", [
      block("h1", "the guest fixed this"),
      block("h2", "added during the move"),
    ]);
    made.setDoc(guestEdit);
    await settle();
    expect(ws.updatesSent().length).toBeGreaterThan(0);
    expect(roomAfter(ws, room)).toEqual(guestEdit);
    expect(JSON.stringify(docFromY(room))).not.toContain("guest's own words");
  });

  it("leaves the session, untouched, when the editor can't make it a lesson", async () => {
    const made = editor(GUEST_OWN, { uid: "guest-uid", name: "Guest" }, () =>
      Promise.reject(new Error("IndexedDB is unavailable")),
    );
    session = made.session;

    const { ws } = joinAndAdmit(session);
    await settle();

    expect(made.handle.remoteDocs).toEqual([]);
    expect(made.handle.doc).toEqual(GUEST_OWN);
    expect(ws.updatesSent()).toEqual([]);
    expect(ws.closed).toBe(true);
    expect(session.getSnapshot().status).toBe("idle");
    expect(session.getSnapshot().error).toMatch(
      /Couldn't open a lesson for this session/,
    );
  });

  it("drops a move that finishes after the guest has already left", async () => {
    const move = deferred();
    const made = editor(
      GUEST_OWN,
      { uid: "guest-uid", name: "Guest" },
      () => move.promise,
    );
    session = made.session;

    const { ws } = joinAndAdmit(session);
    session.leave();
    move.resolve();
    await settle();

    expect(made.handle.remoteDocs).toEqual([]);
    expect(made.handle.doc).toEqual(GUEST_OWN);
    expect(ws.updatesSent()).toEqual([]);
    expect(session.getSnapshot()).toMatchObject({
      status: "idle",
      role: null,
      myCode: null,
      myId: null,
    });
  });

  it("needs a code, a hub and a sign-in", () => {
    session = createCollabSession();
    session.joinSession("  ", "token");
    expect(session.getSnapshot().error).toBe("Enter a session code to join.");

    session.joinSession("room", "");
    expect(session.getSnapshot().error).toBe("Sign in to collaborate.");
    expect(StubSocket.instances).toHaveLength(0);

    configureCore({ apiUrl: "" });
    session.startHosting("token");
    expect(session.getSnapshot()).toMatchObject({
      status: "error",
      error: "Collaboration is not configured.",
    });
  });
});

describe("hosting a live session", () => {
  it("seeds the room with the lesson, without the trusted list, and syncs edits both ways", async () => {
    const made = editor(HOST_LESSON, { uid: "host-uid", name: "Host" });
    session = made.session;
    const ws = hostSession(session);

    expect(ws.url).toMatch(
      /^wss:\/\/api\.example\.test\/collab\/[^/?]+\?token=token&create=1$/,
    );
    expect(session.getSnapshot()).toMatchObject({
      status: "hosting",
      role: "host",
      myId: "0",
      synced: true,
    });
    expect(session.getSnapshot().myCode).toBeTruthy();
    expect(ws.url).toContain(`/collab/${session.getSnapshot().myCode}?`);

    // The whole lesson went out on HELLO, minus the email addresses.
    const room = new Y.Doc();
    expect(roomAfter(ws, room)).toEqual(HOST_PUBLIC);

    // A local edit follows, debounced into one update.
    const edited = {
      ...HOST_LESSON,
      title: "Host's lesson, renamed",
    };
    made.setDoc(edited);
    made.setDoc({ ...edited, title: "Host's lesson, renamed twice" });
    const before = ws.updatesSent().length;
    await settle();
    expect(ws.updatesSent().length).toBe(before + 1);
    expect(roomAfter(ws, room).title).toBe("Host's lesson, renamed twice");

    // A remote edit reaches the editor with the host's own trusted list put
    // back, since the room never carried it.
    const theirs = lesson("Host's lesson, renamed twice", "host", [
      block("h1", "the host's first block"),
      block("h2", "a guest's block"),
    ]);
    ws.receive(frameBytes(T.UPDATE, editRoom(room, theirs)));
    expect(made.handle.remoteDocs).toHaveLength(1);
    expect(made.handle.doc).toEqual({
      ...theirs,
      trustedCollaborators: HOST_LESSON.trustedCollaborators,
    });

    // And adopting it echoes nothing back.
    await settle();
    expect(ws.updatesSent().length).toBe(before + 1);
  });

  it("lists who is here and who is waiting, and admits trusted guests itself", () => {
    session = createCollabSession({ doc: HOST_LESSON });
    const ws = hostSession(session);
    ws.receive(
      frameJson(T.PRESENCE, {
        participants: [{ slot: 0, uid: "host-uid", name: "Host", host: true }],
        requests: [
          { slot: 2, uid: "t-uid", name: "Tess", email: "trusted@example.com" },
          {
            slot: 3,
            uid: "s-uid",
            name: "Sam",
            email: "sam@example.com",
            bot: true,
          },
          { not: "a slot" },
        ],
      }),
    );

    expect(session.getSnapshot().participants).toEqual([
      {
        id: 0,
        name: "Host",
        email: "",
        avatarUrl: "",
        host: true,
        bot: false,
      },
    ]);
    expect(
      session.getSnapshot().requests.map((r) => [r.id, r.name, r.bot]),
    ).toEqual([
      [2, "Tess", false],
      [3, "Sam", true],
    ]);
    // Only the trusted address was admitted, whatever its case.
    expect(ws.frames(T.ADMIT)).toEqual([frameWithSlot(T.ADMIT, 2)]);

    session.admit(3);
    session.removeParticipant(3);
    expect(ws.frames(T.ADMIT)).toHaveLength(2);
    expect(ws.frames(T.REMOVE)).toEqual([frameWithSlot(T.REMOVE, 3)]);
  });

  it("labels cursors from the roster and drops one whose owner leaves", () => {
    session = createCollabSession({ doc: HOST_LESSON });
    const ws = hostSession(session);
    const listener = vi.fn();
    session.subscribe(listener);

    ws.receive(
      frameWithSlot(
        T.CURSOR,
        1,
        utf8.encode(JSON.stringify({ field: "title", start: 1, end: 3 })),
      ),
    );
    ws.receive(
      frameWithSlot(
        T.CURSOR,
        7,
        utf8.encode(JSON.stringify({ field: "s:1", start: 0, end: 0 })),
      ),
    );
    expect(session.getSnapshot().selections["1"]).toMatchObject({
      uid: "1",
      name: "Guest",
      color: colorForId("1"),
      field: "title",
      start: 1,
      end: 3,
    });
    expect(session.getSnapshot().selections["7"]?.name).toBe("guest 7");

    // A cursor with no field means "no longer editing".
    ws.receive(frameWithSlot(T.CURSOR, 7, utf8.encode("{}")));
    expect(Object.keys(session.getSnapshot().selections)).toEqual(["1"]);
    // Saying so again changes nothing, so nobody is told.
    const told = listener.mock.calls.length;
    ws.receive(frameWithSlot(T.CURSOR, 7, utf8.encode("{}")));
    ws.receive(frameWithSlot(T.CURSOR, 7, utf8.encode("not json")));
    expect(listener).toHaveBeenCalledTimes(told);

    // Slot 1 leaves: the roster no longer lists them, so their caret goes.
    ws.receive(
      frameJson(T.PRESENCE, {
        participants: [{ slot: 0, uid: "host-uid", name: "Host", host: true }],
        requests: [],
      }),
    );
    expect(session.getSnapshot().selections).toEqual({});
  });

  it("broadcasts where we are editing, once it has a slot", () => {
    session = createCollabSession({ doc: HOST_LESSON });
    session.startHosting("token");
    const ws = StubSocket.instances.at(-1)!;
    ws.open();
    session.setLocalSelection({ field: "title", start: 0, end: 2 });
    expect(ws.frames(T.CURSOR)).toEqual([]);

    ws.receive(hello(0, true));
    session.setLocalSelection({ field: "title", start: 0, end: 2 });
    session.setLocalSelection(null);
    expect(ws.frames(T.CURSOR)).toEqual([
      frameJson(T.CURSOR, { field: "title", start: 0, end: 2 }),
      frameJson(T.CURSOR, { field: null, start: null, end: null }),
    ]);
  });

  it("keeps a chat transcript, one entry per message, and sends ours", () => {
    session = createCollabSession({
      doc: HOST_LESSON,
      identity: { uid: "host-uid", name: "Host", email: "host@example.com" },
    });
    const ws = hostSession(session);

    const theirs = utf8.encode(
      JSON.stringify({ id: "m1", text: "hello", ts: 5 }),
    );
    ws.receive(frameWithSlot(T.CHAT, 1, theirs));
    ws.receive(frameWithSlot(T.CHAT, 1, theirs));
    expect(session.getSnapshot().messages).toEqual([
      {
        id: "m1",
        uid: "1",
        name: "Guest",
        email: "",
        avatarUrl: "",
        text: "hello",
        ts: 5,
      },
    ]);

    session.sendChat("   ");
    expect(ws.frames(T.CHAT)).toEqual([]);

    session.sendChat(" hi there ");
    const mine = session.getSnapshot().messages[1];
    expect(mine).toMatchObject({
      uid: "0",
      name: "Host",
      email: "host@example.com",
      text: "hi there",
    });
    expect(ws.frames(T.CHAT)).toEqual([
      frameJson(T.CHAT, { id: mine.id, text: "hi there", ts: mine.ts }),
    ]);

    // A flood is cut to the cap.
    ws.receive(
      frameWithSlot(
        T.CHAT,
        1,
        utf8.encode(JSON.stringify({ id: "m2", text: "x".repeat(3000) })),
      ),
    );
    expect(session.getSnapshot().messages[2].text).toHaveLength(2000);
  });

  it("credits a peer's edits to version history until a commit clears them", () => {
    session = createCollabSession({
      doc: HOST_LESSON,
      identity: { uid: "host-uid", name: "Host" },
    });
    const ws = hostSession(session);
    const { coAuthors } = session;

    // Our own edits, and a slot the roster doesn't know, earn no credit.
    ws.receive(frameWithSlot(T.EDITED, 0));
    ws.receive(frameWithSlot(T.EDITED, 9));
    expect(coAuthors.peek()).toEqual([]);

    ws.receive(frameWithSlot(T.EDITED, 1));
    expect(coAuthors.peek()).toEqual([
      { uid: "guest-uid", name: "Guest", seq: 1 },
    ]);

    // They edit again while the commit is being written: the stale entry the
    // commit checked is not the one that's there now, so it stays.
    const credited = coAuthors.peek();
    ws.receive(frameWithSlot(T.EDITED, 1));
    coAuthors.clear(credited);
    expect(coAuthors.peek()).toEqual([
      { uid: "guest-uid", name: "Guest", seq: 2 },
    ]);

    coAuthors.clear(coAuthors.peek());
    expect(coAuthors.peek()).toEqual([]);

    // Credit outlives the socket, until the editor moves on.
    ws.receive(frameWithSlot(T.EDITED, 1));
    session.leave();
    expect(coAuthors.peek()).toHaveLength(1);
    coAuthors.discard();
    expect(coAuthors.peek()).toEqual([]);
  });

  it("ends the session when the room removes us or fails", () => {
    session = createCollabSession({ doc: HOST_LESSON });
    let ws = hostSession(session);
    ws.receive(frameBytes(T.REMOVED, utf8.encode("removed")));
    expect(ws.closed).toBe(true);
    expect(session.getSnapshot()).toMatchObject({
      status: "idle",
      role: null,
      error: "The host removed you from the lesson.",
      synced: false,
      myId: null,
    });

    session.clearError();
    ws = hostSession(session);
    expect(ws).not.toBe(StubSocket.instances[0]);
    ws.receive(frameBytes(T.ERROR, utf8.encode("Room is full.")));
    expect(session.getSnapshot()).toMatchObject({
      status: "error",
      error: "Room is full.",
    });
  });

  it("reads a close before HELLO as a failed start, and after it as a disconnect", () => {
    session = createCollabSession({ doc: HOST_LESSON });
    session.startHosting("token");
    let ws = StubSocket.instances.at(-1)!;
    ws.drop();
    expect(session.getSnapshot()).toMatchObject({
      status: "idle",
      error: "Couldn't start the session. Please sign in and try again.",
    });

    session.leave();
    session.joinSession("room", "token");
    ws = StubSocket.instances.at(-1)!;
    ws.drop();
    expect(session.getSnapshot().error).toMatch(/Couldn't connect/);

    session.leave();
    ws = hostSession(session);
    ws.drop();
    expect(session.getSnapshot()).toMatchObject({
      status: "idle",
      error: "Disconnected from the collaboration session.",
    });
  });

  it("keeps the socket alive from a background tab", () => {
    vi.useFakeTimers();
    try {
      session = createCollabSession({ doc: HOST_LESSON });
      const ws = hostSession(session);
      vi.advanceTimersByTime(20_000);
      expect(ws.sent.filter((d) => d === "ping")).toHaveLength(1);
      session.leave();
      vi.advanceTimersByTime(60_000);
      expect(ws.sent.filter((d) => d === "ping")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts a fresh document for every session", async () => {
    const made = editor(HOST_LESSON, { uid: "host-uid", name: "Host" });
    session = made.session;
    let ws = hostSession(session);
    expect(roomAfter(ws)).toEqual(HOST_PUBLIC);
    session.leave();

    const next = lesson("Another lesson", "other", [block("o1", "words")]);
    made.setDoc(next);
    ws = hostSession(session);
    expect(roomAfter(ws)).toEqual(next);
    await settle();
    expect(roomAfter(ws)).toEqual(next);
  });
});
