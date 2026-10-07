// Taking part in a live collaboration session (src/collab.js) and the tools
// over it (src/collabTools.js).
//
// The room itself is a Durable Object tested in apps/api. What is under test
// here is this end: that the tools ask the room the right things, turn its
// answers into a document and back into an update, carry the one handle that
// identifies the session between calls, and say something useful when the room
// says no. So the room is a stand-in the test drives as the host would, behind
// the same five api methods the real client exposes.

import assert from "node:assert/strict";
import test from "node:test";

import * as Y from "yjs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { docFromY, reconcile } from "@spelling-creator/core/ydoc";

import { busyBlocks, docOf, updateFor } from "../src/collab.js";
import { memorySessionStore } from "../src/collabTools.js";
import { registerTools, SERVER_INFO } from "../src/tools.js";

const LESSON = {
  title: "Volcanoes",
  sections: [
    {
      id: "s1",
      name: "Reading",
      blocks: [
        { id: "b1", type: "text", text: "A volcano ERUPTS." },
        { id: "b2", type: "text", text: "MAGMA rises." },
      ],
    },
  ],
};

const toBase64 = (bytes) => Buffer.from(bytes).toString("base64");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A room, as the api methods see it. The test plays the host: admits, declines,
 * removes, ends the session, types, moves its caret. The room holds the
 * authoritative Y.Doc exactly as the real one does, so an update the tools
 * send is merged rather than trusted.
 */
function fakeRoom(doc = LESSON) {
  const ydoc = new Y.Doc();
  reconcile(ydoc, doc);

  const room = {
    ydoc,
    exists: false, // a record for us is in the room
    admitted: false,
    gone: null, // the reason the room let us go, once it has
    hosted: true, // somebody is hosting the code at all
    token: "participant-token",
    slot: 1,
    joins: 0,
    assistant: null,
    inbox: [],
    cursors: {},
    updates: [],
    said: [],
    waiters: [],
    beforeUpdate: null, // what the teacher does while our update is in flight

    wake() {
      for (const w of room.waiters.splice(0)) w();
    },
    admit() {
      room.admitted = true;
      room.wake();
    },
    end(reason) {
      room.gone = reason;
      room.wake();
    },
    say(text) {
      room.inbox.push({ from: 0, name: "Teacher", text, ts: 1700000000000 });
    },
    cursor(slot, field) {
      room.cursors[slot] = { field, start: 0, end: 0 };
    },
    teacherEdits(next) {
      reconcile(room.ydoc, next);
    },
    doc() {
      return docFromY(room.ydoc);
    },
    participants() {
      return [
        { slot: 0, name: "Teacher", host: true },
        { slot: room.slot, name: "Teacher · test", host: false, bot: true },
      ];
    },
    // The envelope the real room answers with. A 410 (gone) is thrown the way
    // api.collabCall throws it; so is a 404 once the record is gone for good.
    answer(withDoc) {
      if (room.gone) {
        const gone = room.gone;
        room.exists = false;
        room.gone = null;
        throw Object.assign(new Error(gone), { gone });
      }
      if (!room.exists) {
        throw Object.assign(new Error("No such participant"), { status: 404 });
      }
      if (!room.admitted) {
        return {
          slot: room.slot,
          admitted: false,
          participants: [],
          chat: [],
          cursors: {},
        };
      }
      const out = {
        slot: room.slot,
        admitted: true,
        participants: room.participants(),
        chat: room.inbox.splice(0),
        cursors: { ...room.cursors },
      };
      if (withDoc) out.doc = toBase64(Y.encodeStateAsUpdate(room.ydoc));
      return out;
    },
  };

  const check = (token) => {
    if (token !== room.token) {
      throw Object.assign(new Error("No such participant"), { status: 404 });
    }
  };

  const api = {
    async collabJoin(code, assistant) {
      if (!room.hosted) {
        throw Object.assign(new Error("Session not found"), { status: 404 });
      }
      room.joins += 1;
      room.assistant = assistant;
      room.exists = true;
      return { token: room.token, slot: room.slot, admitted: false };
    },
    async collabState(code, token, { wait = 0 } = {}) {
      check(token);
      // The real room holds the request open for admission; here a few
      // milliseconds stand in for the seconds, so a test's budget is spent in
      // a handful of asks rather than a tight loop.
      if (wait > 0 && room.exists && !room.admitted && !room.gone) {
        await Promise.race([
          new Promise((r) => room.waiters.push(r)),
          sleep(10),
        ]);
      }
      return room.answer(true);
    },
    async collabUpdate(code, token, bytes) {
      check(token);
      if (room.beforeUpdate) room.beforeUpdate();
      Y.applyUpdate(room.ydoc, bytes);
      room.updates.push(bytes);
      return room.answer(false);
    },
    async collabChat(code, token, text) {
      check(token);
      room.said.push(text);
      return room.answer(false);
    },
    async collabLeave(code, token) {
      check(token);
      room.exists = false;
      return { left: true };
    },
  };

  return { room, api };
}

async function connect(api, { sessionStore } = {}) {
  const server = new McpServer(SERVER_INFO);
  registerTools(server, {
    api,
    config: { apiUrl: "https://example.test" },
    sessionStore,
    // A join's in-call wait, cut from most of a minute to a few asks.
    collabJoinWaitMs: 40,
  });
  const client = new Client({ name: "test", version: "0" });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return {
    async names() {
      return (await client.listTools()).tools.map((t) => t.name);
    },
    async call(name, args) {
      return client.callTool({ name, arguments: args || {} });
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}

const payload = (result) => JSON.parse(result.content[0].text);

// ---- the arithmetic ----------------------------------------------------------

test("an edit becomes the update for exactly what changed, and nothing for no change", () => {
  const ydoc = new Y.Doc();
  reconcile(ydoc, LESSON);
  const state = { doc: toBase64(Y.encodeStateAsUpdate(ydoc)) };

  assert.equal(docOf(state).title, "Volcanoes");
  assert.equal(
    updateFor(state, LESSON),
    null,
    "reconciling the same document emits nothing",
  );

  const update = updateFor(state, { ...LESSON, title: "Volcanoes and lava" });
  assert.ok(update instanceof Uint8Array);
  // Applied to a replica that never saw our change, it lands as that change
  // alone: the room's document, with the title moved and nothing else.
  const theirs = new Y.Doc();
  Y.applyUpdate(theirs, Y.encodeStateAsUpdate(ydoc));
  Y.applyUpdate(theirs, update);
  assert.deepEqual(docFromY(theirs), {
    ...LESSON,
    title: "Volcanoes and lava",
  });
});

test("a cursor marks the block it is in as somebody else's, never our own", () => {
  const busy = busyBlocks({
    slot: 1,
    participants: [
      { slot: 0, name: "Teacher" },
      { slot: 1, name: "Assistant" },
    ],
    cursors: {
      0: { field: "b1", start: 3 },
      1: { field: "b2" }, // us
      2: { field: null }, // somebody who stopped editing
    },
  });
  assert.equal(busy.get("b1"), "Teacher");
  assert.equal(busy.has("b2"), false);
  assert.equal(busy.size, 1);
});

// ---- the tools ---------------------------------------------------------------

test("the session tools are registered on every transport", async () => {
  // Nothing is held open between calls any more, so there is no transport
  // that can't have them.
  const { api } = fakeRoom();
  const mcp = await connect(api);
  const names = await mcp.names();
  for (const name of [
    "join_collab_session",
    "read_collab_doc",
    "edit_collab_doc",
    "send_collab_chat",
    "leave_collab_session",
  ]) {
    assert.ok(names.includes(name), `has ${name}`);
  }
  await mcp.close();
});

test("joining declares the client, waits for the host, and resumes the same request", async () => {
  const { room, api } = fakeRoom();
  const mcp = await connect(api);
  try {
    // Nobody clicks: the call runs out of its budget and says so, leaving the
    // request in the host's dialog rather than withdrawing it.
    const first = payload(
      await mcp.call("join_collab_session", { code: "ABC" }),
    );
    assert.equal(first.waiting, "ABC");
    assert.match(first.note, /again with the same code/);
    // Without this the assistant arrives wearing the account holder's display
    // name, and the host sees two participants called the same thing with no
    // way to tell which one is a person.
    assert.equal(room.assistant, "test");
    assert.equal(room.joins, 1);

    // The host clicks Add. The next call picks the same request up.
    room.admit();
    const joined = payload(
      await mcp.call("join_collab_session", { code: "ABC" }),
    );
    assert.equal(joined.joined, "ABC");
    assert.equal(joined.title, "Volcanoes");
    assert.equal(joined.sections[0].blocks, 2);
    assert.deepEqual(
      joined.participants.map((p) => p.name),
      ["Teacher", "Teacher · test"],
    );
    assert.equal(room.joins, 1, "no second request was sent");

    // Joining again while in is idempotent, and joining elsewhere is refused.
    const again = payload(
      await mcp.call("join_collab_session", { code: "ABC" }),
    );
    assert.match(again.note, /Already in this session/);
    const other = await mcp.call("join_collab_session", { code: "XYZ" });
    assert.equal(other.isError, true);
    assert.match(other.content[0].text, /Already in session "ABC"/);
  } finally {
    await mcp.close();
  }
});

test("a declined request says so, and leaves nothing behind", async () => {
  const { room, api } = fakeRoom();
  const mcp = await connect(api);
  try {
    payload(await mcp.call("join_collab_session", { code: "ABC" }));
    room.end("removed");
    const declined = await mcp.call("join_collab_session", { code: "ABC" });
    assert.equal(declined.isError, true);
    assert.match(declined.content[0].text, /declined the request to join/);

    const read = await mcp.call("read_collab_doc");
    assert.match(read.content[0].text, /Not in a collaboration session/);
  } finally {
    await mcp.close();
  }
});

test("a code nobody is hosting is named as such", async () => {
  const { room, api } = fakeRoom();
  room.hosted = false;
  const mcp = await connect(api);
  try {
    const res = await mcp.call("join_collab_session", { code: "GONE" });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /No live session is running/);
  } finally {
    await mcp.close();
  }
});

test("the session tools say what to do when there is no session", async () => {
  const { api } = fakeRoom();
  const mcp = await connect(api);

  const read = await mcp.call("read_collab_doc");
  assert.equal(read.isError, true);
  assert.match(read.content[0].text, /Not in a collaboration session/);
  assert.match(read.content[0].text, /patch_lesson/);

  const left = await mcp.call("leave_collab_session");
  assert.equal(left.isError, undefined, "leaving nothing is not an error");
  assert.match(left.content[0].text, /nothing to leave/);

  await mcp.close();
});

test("an edit is one update, and merges with what the teacher typed meanwhile", async () => {
  // The property the whole feature rests on: the assistant writing one part of
  // the lesson while the teacher writes another costs neither of them their
  // work. The teacher's edit lands in the room after we read it and before our
  // update arrives, which is the worst ordering there is.
  const { room, api } = fakeRoom();
  room.admit();
  const mcp = await connect(api);
  try {
    await mcp.call("join_collab_session", { code: "ABC" });

    room.beforeUpdate = () =>
      room.teacherEdits({
        ...LESSON,
        sections: [
          {
            ...LESSON.sections[0],
            blocks: [
              { id: "b1", type: "text", text: "A volcano ERUPTS violently." },
              LESSON.sections[0].blocks[1],
            ],
          },
        ],
      });

    const ok = payload(
      await mcp.call("edit_collab_doc", {
        operations: [{ op: "set_title", title: "Volcanoes and lava" }],
      }),
    );
    assert.equal(ok.applied, 1);
    assert.equal(ok.changed, true);
    assert.match(ok.note, /NOT saved/);
    assert.equal(room.updates.length, 1, "one update, not one per field");

    const merged = room.doc();
    assert.equal(merged.title, "Volcanoes and lava", "our edit survived");
    assert.equal(
      merged.sections[0].blocks[0].text,
      "A volcano ERUPTS violently.",
      "and so did theirs",
    );

    // An edit that changes nothing sends nothing.
    room.beforeUpdate = null;
    const same = payload(
      await mcp.call("edit_collab_doc", {
        operations: [{ op: "set_title", title: "Volcanoes and lava" }],
      }),
    );
    assert.equal(same.changed, false);
    assert.equal(room.updates.length, 1);
  } finally {
    await mcp.close();
  }
});

test("edit_collab_doc refuses a block somebody else's cursor is in", async () => {
  const { room, api } = fakeRoom();
  room.admit();
  const mcp = await connect(api);
  try {
    await mcp.call("join_collab_session", { code: "ABC" });

    // The teacher's caret is in b1.
    room.cursor(0, "b1");

    const clash = await mcp.call("edit_collab_doc", {
      operations: [
        {
          op: "replace_block",
          blockId: "b1",
          block: { type: "text", text: "Rewritten." },
        },
      ],
    });
    assert.equal(clash.isError, true);
    assert.match(clash.content[0].text, /cursor is in/);
    assert.match(clash.content[0].text, /Teacher/);

    // A different block is fine, and lands in the shared document.
    const ok = payload(
      await mcp.call("edit_collab_doc", {
        operations: [
          {
            op: "replace_block",
            blockId: "b2",
            block: { type: "text", text: "MAGMA rises quickly." },
          },
        ],
      }),
    );
    assert.equal(ok.applied, 1);

    const doc = payload(await mcp.call("read_collab_doc")).doc;
    assert.equal(doc.sections[0].blocks[1].text, "MAGMA rises quickly.");
  } finally {
    await mcp.close();
  }
});

test("chat waits in the room and comes back once, with the sender named", async () => {
  const { room, api } = fakeRoom();
  room.admit();
  const mcp = await connect(api);
  try {
    await mcp.call("join_collab_session", { code: "ABC" });
    room.say("Can you do section 2?");

    const read = payload(await mcp.call("read_collab_doc"));
    assert.equal(read.chat.length, 1);
    assert.equal(read.chat[0].from, "Teacher");
    assert.equal(read.chat[0].text, "Can you do section 2?");

    const again = payload(await mcp.call("read_collab_doc"));
    assert.equal(again.chat, undefined, "drained, not repeated");

    const sent = payload(
      await mcp.call("send_collab_chat", { text: "On it." }),
    );
    assert.equal(sent.sent, "On it.");
    assert.deepEqual(room.said, ["On it."]);
  } finally {
    await mcp.close();
  }
});

test("the session outlives the server, given the same store", async () => {
  // The remote transport rebuilds the server after every hibernation. All it
  // has to carry across is the handle, and a fresh server with that handle is
  // in the session without asking the host anything.
  const { room, api } = fakeRoom();
  room.admit();
  const store = memorySessionStore();

  const first = await connect(api, { sessionStore: store });
  await first.call("join_collab_session", { code: "ABC" });
  await first.close();

  const second = await connect(api, { sessionStore: store });
  try {
    const read = payload(await second.call("read_collab_doc"));
    assert.equal(read.doc.title, "Volcanoes");
    assert.equal(room.joins, 1, "no new request to the host");
  } finally {
    await second.close();
  }
});

test("being removed, or the host leaving, ends the session on the next call", async () => {
  const { room, api } = fakeRoom();
  room.admit();
  const mcp = await connect(api);
  try {
    await mcp.call("join_collab_session", { code: "ABC" });
    room.end("removed");
    const removed = await mcp.call("read_collab_doc");
    assert.equal(removed.isError, true);
    assert.match(removed.content[0].text, /host removed you/);
    const after = await mcp.call("read_collab_doc");
    assert.match(after.content[0].text, /Not in a collaboration session/);

    // Back in; this time the host closes the editor.
    room.exists = true;
    room.admitted = true;
    await mcp.call("join_collab_session", { code: "ABC" });
    room.end("The host ended the session.");
    const ended = await mcp.call("send_collab_chat", { text: "Hello?" });
    assert.equal(ended.isError, true);
    assert.match(
      ended.content[0].text,
      /ended \(The host ended the session\.\)/,
    );
    assert.match(ended.content[0].text, /patch_lesson/);
  } finally {
    await mcp.close();
  }
});

test("leaving frees the slot and forgets the session", async () => {
  const { room, api } = fakeRoom();
  room.admit();
  const mcp = await connect(api);
  try {
    await mcp.call("join_collab_session", { code: "ABC" });
    const left = await mcp.call("leave_collab_session");
    assert.match(left.content[0].text, /Left session "ABC"/);
    assert.equal(room.exists, false);
    const read = await mcp.call("read_collab_doc");
    assert.match(read.content[0].text, /Not in a collaboration session/);
  } finally {
    await mcp.close();
  }
});
