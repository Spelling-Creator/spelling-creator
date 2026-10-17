// Live collaboration: a trimmed copy of the Worker's CollabRoom
// (apps/api/src/collab-room.js) on a plain WebSocket server. Same frames
// (@spelling-creator/core/collabFrames), the same host/admit model and the same
// Yjs relay, so the editor's Collaborate panel, live cursors and chat all work.
// Left out: AI assistants joining over HTTP, rate limits, and persistence.

import { WebSocketServer } from "ws";
import * as Y from "yjs";
import {
  T,
  frameBytes,
  frameJson,
  frameWithSlot,
} from "@spelling-creator/core/collabFrames";
import { personFromToken } from "./people.js";
import { refuseUpgrade, sessionCode } from "./sessionCode.js";

const text = (s) => new TextEncoder().encode(s);
const helloFrame = (slot, host) =>
  Uint8Array.from([T.HELLO, (slot >> 8) & 0xff, slot & 0xff, host ? 1 : 0]);
const slotOf = (payload) => (payload[0] << 8) | payload[1];

/** Serve /collab/<code>?token=…[&create=1] upgrades (see server.js for the dispatch). */
export function createCollab({ log = () => {} } = {}) {
  const rooms = new Map(); // code -> { ydoc, sockets: Set<WebSocket> }
  const wss = new WebSocketServer({ noServer: true });

  function presence(room) {
    const entry = (s) => ({
      slot: s.slot,
      uid: s.uid,
      name: s.name,
      email: s.email,
      avatarUrl: "",
      host: s.host,
      bot: false,
    });
    const everyone = [...room.sockets].map((w) => w.state);
    const participants = everyone
      .filter((s) => s.admitted)
      .map(entry)
      .sort((a, b) => (a.host ? -1 : b.host ? 1 : a.slot - b.slot));
    const requests = everyone.filter((s) => !s.admitted).map(entry);
    // The host sees who is waiting; an admitted guest sees only who is in.
    for (const w of room.sockets) {
      if (w.state.host)
        w.send(frameJson(T.PRESENCE, { participants, requests }));
      else if (w.state.admitted)
        w.send(frameJson(T.PRESENCE, { participants, requests: [] }));
    }
  }

  function relay(room, from, frame) {
    for (const w of room.sockets)
      if (w !== from && w.state.admitted) w.send(frame);
  }

  function join(ws, url, code) {
    const person = personFromToken(url.searchParams.get("token") || "");
    if (!person) {
      ws.send(frameBytes(T.ERROR, text("Sign in to collaborate.")));
      return ws.close();
    }
    const create = url.searchParams.get("create") === "1";
    let room = rooms.get(code);
    const hosted = room && [...room.sockets].some((w) => w.state.host);
    if (create && !hosted) {
      room = { ydoc: new Y.Doc(), sockets: new Set() };
      rooms.set(code, room);
    } else if (!hosted) {
      ws.send(frameBytes(T.ERROR, text("Session not found")));
      return ws.close();
    }
    const host = create && !hosted;
    const slot =
      Math.max(-1, ...[...room.sockets].map((w) => w.state.slot)) + 1;
    ws.state = {
      slot,
      uid: person.id,
      name: person.displayName,
      email: person.email,
      host,
      admitted: host,
    };
    room.sockets.add(ws);
    log(
      `collab ${code}: ${person.displayName} ${host ? "hosts" : "asks to join"}`,
    );
    ws.send(helloFrame(slot, host));
    presence(room);

    ws.on("message", (data, isBinary) => {
      // The client's keep-alive.
      if (!isBinary && data.toString() === "ping") return ws.send("pong");
      const bytes = new Uint8Array(data);
      const [type] = bytes;
      const payload = bytes.subarray(1);
      const s = ws.state;

      if (type === T.UPDATE && s.admitted) {
        let changed = false;
        const mark = () => (changed = true);
        room.ydoc.on("update", mark);
        try {
          Y.applyUpdate(room.ydoc, payload);
        } catch {
          return; // a malformed update must not take the room down
        } finally {
          room.ydoc.off("update", mark);
        }
        // Whose edit it is goes first, for version history's co-author credit.
        if (changed) relay(room, ws, frameWithSlot(T.EDITED, s.slot, null));
        relay(room, ws, frameBytes(T.UPDATE, payload));
      } else if ((type === T.CURSOR || type === T.CHAT) && s.admitted) {
        relay(room, ws, frameWithSlot(type, s.slot, payload));
      } else if (type === T.ADMIT && s.host) {
        const guest = [...room.sockets].find(
          (w) => w.state.slot === slotOf(payload),
        );
        if (guest && !guest.state.admitted) {
          guest.state.admitted = true;
          guest.send(frameBytes(T.ADMITTED, Y.encodeStateAsUpdate(room.ydoc)));
          log(`collab ${code}: ${guest.state.name} added`);
          presence(room);
        }
      } else if (type === T.REMOVE && s.host) {
        const guest = [...room.sockets].find(
          (w) => w.state.slot === slotOf(payload),
        );
        if (guest && !guest.state.host) {
          guest.send(frameBytes(T.REMOVED, text("removed")));
          guest.close(1000, "removed");
        }
      }
    });

    ws.on("close", () => {
      room.sockets.delete(ws);
      if (!ws.state.host) return presence(room);
      // The room ends with its host.
      for (const w of room.sockets) {
        w.send(frameBytes(T.REMOVED, text("The host ended the session.")));
        w.close(1000, "host left");
      }
      rooms.delete(code);
    });
  }

  return {
    path: "/collab/",
    upgrade(req, socket, head, url) {
      const code = sessionCode(url.pathname, "/collab/");
      if (!code) return refuseUpgrade(socket);
      wss.handleUpgrade(req, socket, head, (ws) => {
        // Survivable, as in practice.js: an unheard socket error ends the process.
        ws.on("error", (err) => log(`collab ${code}: ${err.message}`));
        join(ws, url, code);
      });
    },
    close: () => wss.close(),
  };
}
