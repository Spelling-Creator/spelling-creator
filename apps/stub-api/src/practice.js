// Letterboard sessions: a trimmed copy of the Worker's PracticeRoom
// (apps/api/src/practice-room.js) on a plain WebSocket server. The same JSON
// messages (docs/live-sync.md in the Spelling Creator Board repository), the
// same one-host model and the same relay, so interactive mode's letterboard
// button works against the stub and a board on the same network can join it.
// Left out: rate limits and persistence.

import { WebSocketServer } from "ws";
import { personFromToken } from "./people.js";
import { refuseUpgrade, sessionCode } from "./sessionCode.js";

const MAX_TEXT = 5000;

/** Serve /practice/<code>[?create=1&token=…] upgrades. */
export function createPractice({ log = () => {} } = {}) {
  const rooms = new Map(); // code -> { state, host, boards: Set<WebSocket> }
  const wss = new WebSocketServer({ noServer: true });

  const send = (ws, message) => ws.send(JSON.stringify(message));
  const tellBoards = (room) => {
    if (room.host) send(room.host, { type: "boards", count: room.boards.size });
  };

  function join(ws, url, code) {
    const create = url.searchParams.get("create") === "1";
    let room = rooms.get(code);

    if (create) {
      // The host has to be signed in; it records the answers.
      const person = personFromToken(url.searchParams.get("token") || "");
      if (!person)
        return ws.close(1008, "Sign in to run a lesson for a letterboard.");
      if (room?.host) return ws.close(1008, "This session already has a host.");
      room = { state: {}, host: ws, boards: new Set() };
      rooms.set(code, room);
      log(`practice ${code}: ${person.displayName} hosts`);
      send(ws, { type: "hello", boards: 0 });
      ws.on("message", (data, isBinary) => {
        if (isBinary) return;
        const raw = data.toString();
        if (raw === "ping") return ws.send("pong"); // the browser's keep-alive
        const msg = parse(raw);
        if (msg?.type !== "state") return;
        room.state = readState(msg);
        for (const board of room.boards)
          send(board, { type: "state", ...room.state });
      });
      ws.on("close", () => {
        // The room ends with its host.
        for (const board of room.boards) {
          send(board, {
            type: "removed",
            message: "The host ended the session.",
          });
          board.close(1000, "host left");
        }
        rooms.delete(code);
        log(`practice ${code}: ended`);
      });
      return;
    }

    if (!room?.host) {
      send(ws, {
        type: "error",
        message: "No session with that code. Check it on the Practice page.",
      });
      return ws.close(1008, "no session");
    }
    room.boards.add(ws);
    log(`practice ${code}: a board joined`);
    send(ws, { type: "hello", ...room.state });
    tellBoards(room);

    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const msg = parse(data.toString());
      if (!msg || !room.host) return;
      // Rebuilt from the one field each message carries, never forwarded as is.
      if (msg.type === "text" || msg.type === "answer") {
        const text = readText(msg.text);
        if (text !== null) send(room.host, { type: msg.type, text });
      } else if (msg.type === "step") {
        const step = readStep(msg.step);
        if (step !== null) send(room.host, { type: "step", step });
      }
    });
    ws.on("close", () => {
      room.boards.delete(ws);
      tellBoards(room);
    });
  }

  return {
    path: "/practice/",
    upgrade(req, socket, head, url) {
      // Folded to capitals, as the Worker does, so a code typed on a tablet in
      // lower case reaches the same room.
      const code = sessionCode(url.pathname, "/practice/")?.toUpperCase();
      if (!code) return refuseUpgrade(socket);
      wss.handleUpgrade(req, socket, head, (ws) => {
        // A bad frame (a protocol error, an oversized message) is emitted as an
        // error on this socket, and an error nobody listens for ends the whole
        // process. ws closes the socket itself afterwards, so its close handler
        // does the cleanup; this only has to make the error survivable.
        ws.on("error", (err) => log(`practice ${code}: ${err.message}`));
        join(ws, url, code);
      });
    },
    close: () => wss.close(),
  };
}

function parse(raw) {
  try {
    const msg = JSON.parse(raw);
    return msg && typeof msg === "object" && typeof msg.type === "string"
      ? msg
      : null;
  } catch {
    return null;
  }
}

function readState(msg) {
  const out = {};
  if (typeof msg.lessonId === "string" && msg.lessonId)
    out.lessonId = msg.lessonId;
  const step = readStep(msg.step);
  if (step !== null) out.step = step;
  const text = readText(msg.text);
  if (text !== null) out.text = text;
  return out;
}

function readText(value) {
  return typeof value === "string" ? value.slice(0, MAX_TEXT) : null;
}

function readStep(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}
