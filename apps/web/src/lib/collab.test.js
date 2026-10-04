// @vitest-environment happy-dom

// Joining someone's live session as a guest, against a stub room.
//
// The bug this guards (#122): the room's document used to reach the editor the
// moment the host admitted a guest, while the editor was still on the guest's
// own lesson, so the host's lesson was saved over it. The hook now waits for
// `onAdmitted` (the editor moving into a lesson of the session's own) before
// handing anything over or syncing anything back.
//
// The room is a stub WebSocket the test drives by hand, speaking the real wire
// format from @spelling-creator/core/collabFrames, and the hook runs inside a
// real React root so its effects (the debounced push into the Y.Doc above all)
// run as they do in the editor.

import { act, createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { configureCore } from "@spelling-creator/core/config";
import { T, frameBytes, frameJson } from "@spelling-creator/core/collabFrames";
import { REMOTE, docFromY, reconcile } from "@spelling-creator/core/ydoc";
import { useCollaboration } from "./collab.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ---- the stub room ----------------------------------------------------------

class StubSocket {
  static OPEN = 1;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.closed = false;
    StubSocket.instances.push(this);
  }

  send(data) {
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

  receive(bytes) {
    const copy = new Uint8Array(bytes);
    this.onmessage?.({ data: copy.buffer });
  }

  // Every document update this client has sent, decoded from the frames.
  updatesSent() {
    return this.sent
      .filter((d) => d instanceof Uint8Array && d[0] === T.UPDATE)
      .map((d) => d.subarray(1));
  }
}

function hello(slot, host) {
  return Uint8Array.of(T.HELLO, (slot >> 8) & 0xff, slot & 0xff, host ? 1 : 0);
}

// ---- documents ----------------------------------------------------------------

const block = (id, text) => ({ id, type: "text", text });
const lesson = (title, sectionId, blocks) => ({
  title,
  sections: [{ id: sectionId, name: "One", blocks }],
});

const GUEST_OWN = lesson("My own lesson", "mine", [
  block("g1", "the guest's own words"),
]);
const HOST_LESSON = lesson("Host's lesson", "host", [
  block("h1", "the host's first block"),
]);

// The room's copy of the session: seeded from the host's lesson, as the host's
// first update does in the real thing.
function roomFor(doc) {
  const ydoc = new Y.Doc();
  reconcile(ydoc, doc, REMOTE);
  return ydoc;
}

/** An update that turns the room's document into `next`. */
function editRoom(room, next) {
  const before = Y.encodeStateVector(room);
  reconcile(room, next, REMOTE);
  return Y.encodeStateAsUpdate(room, before);
}

// ---- the harness ----------------------------------------------------------------

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Mount the hook the way EditorPage does: `doc` is editor state, and the hook's
 * `onRemoteDoc` replaces it. Returns live handles on both.
 */
function mount({ onAdmitted }) {
  const handle = { collab: null, doc: null, setDoc: null, remoteDocs: [] };

  function Harness() {
    const [doc, setDoc] = useState(GUEST_OWN);
    const collab = useCollaboration({
      doc,
      onRemoteDoc: (next) => {
        handle.remoteDocs.push(next);
        setDoc(next);
      },
      onAdmitted,
      identity: { uid: "guest-uid", name: "Guest" },
      accessToken: "token",
    });
    // Published after each commit, so the test always reads what React last
    // rendered. `collab` is a new object every render, so this runs every time.
    useEffect(() => {
      handle.doc = doc;
      handle.setDoc = setDoc;
      handle.collab = collab;
    }, [doc, collab]);
    return null;
  }

  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(createElement(Harness)));
  handle.unmount = () => act(() => root.unmount());
  return handle;
}

// Let timers and promise callbacks run, inside act so React applies the state
// they set. 100ms is past the hook's 50ms push debounce.
async function settle(ms = 100) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** Join, get admitted, and return the socket and the room's document. */
async function joinAndAdmit(handle) {
  act(() => handle.collab.joinSession("room-code"));
  const ws = StubSocket.instances.at(-1);
  act(() => ws.open());
  act(() => ws.receive(hello(1, false)));
  act(() =>
    ws.receive(
      frameJson(T.PRESENCE, {
        participants: [
          { slot: 0, uid: "host-uid", name: "Host", host: true },
          { slot: 1, uid: "guest-uid", name: "Guest", host: false },
        ],
        requests: [],
      }),
    ),
  );
  const room = roomFor(HOST_LESSON);
  act(() => ws.receive(frameBytes(T.ADMITTED, Y.encodeStateAsUpdate(room))));
  return { ws, room };
}

// ---- tests ----------------------------------------------------------------------

describe("joining a live session as a guest", () => {
  let handle;

  beforeEach(() => {
    StubSocket.instances = [];
    vi.stubGlobal("WebSocket", StubSocket);
    configureCore({ apiUrl: "https://api.example.test" });
  });

  afterEach(() => {
    handle?.unmount();
    handle = null;
    vi.unstubAllGlobals();
  });

  it("keeps the host's lesson out of the editor until onAdmitted settles", async () => {
    const move = deferred();
    const onAdmitted = vi.fn(() => move.promise);
    handle = mount({ onAdmitted });

    const { ws, room } = await joinAndAdmit(handle);
    await settle();

    // The editor is asked to move first, and handed the host's lesson to do it.
    expect(onAdmitted).toHaveBeenCalledTimes(1);
    expect(onAdmitted.mock.calls[0][0]).toEqual(HOST_LESSON);

    // Meanwhile the editor still holds the guest's own lesson, untouched.
    expect(handle.remoteDocs).toEqual([]);
    expect(handle.doc).toEqual(GUEST_OWN);

    // The host keeps editing while the move is in progress.
    const edited = lesson("Host's lesson", "host", [
      block("h1", "the host's first block"),
      block("h2", "added during the move"),
    ]);
    act(() => ws.receive(frameBytes(T.UPDATE, editRoom(room, edited))));
    await settle();
    expect(handle.remoteDocs).toEqual([]);

    // And the guest sent the room nothing, so their own lesson was never
    // merged into the host's.
    expect(ws.updatesSent()).toEqual([]);

    // The move finishes: the editor now gets the session's latest document,
    // including the edit that arrived meanwhile.
    move.resolve();
    await settle();
    expect(handle.remoteDocs).toHaveLength(1);
    expect(handle.doc).toEqual(edited);
    expect(handle.collab.status).toBe("joined");

    // Adopting the room's document doesn't echo anything back to it...
    expect(ws.updatesSent()).toEqual([]);

    // ...and from here the guest's edits do sync, carrying nothing of the lesson
    // they had open before joining.
    const guestEdit = lesson("Host's lesson", "host", [
      block("h1", "the guest fixed this"),
      block("h2", "added during the move"),
    ]);
    act(() => handle.setDoc(guestEdit));
    await settle();
    const sent = ws.updatesSent();
    expect(sent.length).toBeGreaterThan(0);
    for (const update of sent) Y.applyUpdate(room, update, "test");
    expect(docFromY(room)).toEqual(guestEdit);
    expect(JSON.stringify(docFromY(room))).not.toContain("guest's own words");
  });

  it("leaves the session, untouched, when the editor can't make it a lesson", async () => {
    handle = mount({
      onAdmitted: () => Promise.reject(new Error("IndexedDB is unavailable")),
    });

    const { ws } = await joinAndAdmit(handle);
    await settle();

    expect(handle.remoteDocs).toEqual([]);
    expect(handle.doc).toEqual(GUEST_OWN);
    expect(ws.updatesSent()).toEqual([]);
    expect(ws.closed).toBe(true);
    expect(handle.collab.status).toBe("idle");
    expect(handle.collab.error).toMatch(
      /Couldn't open a lesson for this session/,
    );
  });

  it("drops a move that finishes after the guest has already left", async () => {
    const move = deferred();
    handle = mount({ onAdmitted: () => move.promise });

    const { ws } = await joinAndAdmit(handle);
    act(() => handle.collab.leave());
    move.resolve();
    await settle();

    expect(handle.remoteDocs).toEqual([]);
    expect(handle.doc).toEqual(GUEST_OWN);
    expect(ws.updatesSent()).toEqual([]);
  });
});
