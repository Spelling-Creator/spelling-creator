import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { T, slotFrame, readJson } from "@spelling-creator/core/collabFrames";
import { startStub } from "../src/server.js";
import { tokenFor, sessionFor, storageKey } from "../src/sessions.js";
import { PEOPLE } from "../src/people.js";

// A fixture snapshot, so the tests never reach the live hub.
const dataDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);
const PENGUINS = "0b5e2b8e-1c1a-4f7e-9d4a-000000000001";
const CATS = "0b5e2b8e-1c1a-4f7e-9d4a-000000000002";
const EINSTEIN = "0b5e2b8e-1c1a-4f7e-9d4a-000000000003";

let stub;
beforeAll(async () => {
  stub = await startStub({ port: 0, dataDir });
});
afterAll(() => stub.close());

const call = (method, p, { as, body } = {}) =>
  fetch(stub.url + p, {
    method,
    headers: {
      ...(as ? { Authorization: `Bearer ${tokenFor(as)}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
const json = async (...args) => (await call(...args)).json();

describe("lessons", () => {
  it("lists published lessons, newest first, under made-up authors", async () => {
    const { lessons } = await json("GET", "/lessons");
    expect(lessons.map((l) => l.title)).toEqual([
      "The History of Domestic Cats",
      "Penguins",
    ]);
    expect(lessons.map((l) => l.author)).toEqual([
      "Daniel Okafor",
      "Maya Rivera",
    ]);
  });

  it("shows your drafts only to you", async () => {
    const { lessons } = await json("GET", "/lessons/mine", { as: "maya" });
    expect(lessons.find((l) => l.id === EINSTEIN)).toMatchObject({
      published: false,
    });
    expect(
      (await json("GET", "/lessons/mine", { as: "daniel" })).lessons.map(
        (l) => l.id,
      ),
    ).toEqual([CATS]);
  });

  it("publishing a draft puts it at the top of the hub", async () => {
    const res = await call("PUT", `/lessons/${EINSTEIN}`, {
      as: "maya",
      body: { published: true },
    });
    expect(res.status).toBe(200);
    expect((await json("GET", "/lessons")).lessons[0].id).toBe(EINSTEIN);
  });
});

describe("comments and ratings", () => {
  it("needs a session to comment", async () => {
    expect(
      (
        await call("POST", `/lessons/${CATS}/comments`, {
          body: { body: "<p>Hi</p>" },
        })
      ).status,
    ).toBe(401);
  });

  it("adds a comment and folds its rating into the average", async () => {
    const res = await call("POST", `/lessons/${CATS}/comments`, {
      as: "sam",
      body: { body: "<p>Lovely pacing.</p>", rating: 2 },
    });
    expect(res.status).toBe(201);
    const { comment, rating } = await res.json();
    expect(comment.author).toBe("Sam Carter");
    // Sam's seeded 5 is replaced by the new 2, alongside Jordan's 5 and Priya's 4.
    expect(rating).toEqual({ average: 3.67, count: 3 });
  });
});

describe("sign-in", () => {
  it("signs anyone in by username or email, with any password", async () => {
    for (const email of [
      "jordan@example.com",
      "jordan@users.noreply.invalid",
    ]) {
      const res = await fetch(`${stub.url}/auth/v1/token?grant_type=password`, {
        method: "POST",
        body: JSON.stringify({ email, password: "anything" }),
      });
      expect((await res.json()).user.id).toBe(PEOPLE.jordan.id);
    }
  });

  it("refuses someone who isn't in the cast", async () => {
    const res = await fetch(`${stub.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      body: JSON.stringify({ email: "nobody@example.com", password: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("keys a seeded session where supabase-js looks for it", () => {
    expect(storageKey("http://localhost:8787")).toBe("sb-localhost-auth-token");
    expect(sessionFor("maya").user.user_metadata.display_name).toBe(
      "Maya Rivera",
    );
  });
});

describe("history and proposals", () => {
  it("serves a real git history for each lesson", async () => {
    const { head } = await json("GET", `/git/${CATS}/refs`);
    const pack = await call("GET", `/git/${CATS}/pack`);
    expect(pack.headers.get("x-git-head")).toBe(head);
    expect((await pack.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("has a proposal waiting on Maya's Penguins, with its own pack", async () => {
    const { canReview, pulls } = await json(
      "GET",
      `/lessons/${PENGUINS}/pulls`,
      { as: "maya" },
    );
    expect(canReview).toBe(true);
    expect(pulls).toHaveLength(1);
    expect(pulls[0]).toMatchObject({
      author: "Jordan Ellis",
      status: "open",
      ready: true,
    });
    const pack = await call(
      "GET",
      `/lessons/${PENGUINS}/pulls/${pulls[0].id}/pack`,
    );
    expect(pack.headers.get("x-git-head")).toBe(pulls[0].head);
  });
});

describe("notifications", () => {
  it("delivers a sent link to the recipient's bell as an in-app path", async () => {
    await call("POST", "/notifications/send-link", {
      as: "maya",
      body: {
        email: "daniel@example.com",
        link: "http://localhost:5180/editor/collaborate?join=abc",
        message: "Join me?",
      },
    });
    const { notifications } = await json("GET", "/notifications", {
      as: "daniel",
    });
    expect(notifications[0]).toMatchObject({
      title: "Maya Rivera sent you a link",
      body: "Join me?",
      link: "/editor/collaborate?join=abc",
      read: false,
    });
  });
});

describe("live collaboration", () => {
  // Opens a socket and collects its frames, so a test can wait for one.
  const connect = (as, query) => {
    const ws = new WebSocket(
      `${stub.url.replace("http", "ws")}/collab/room1?token=${tokenFor(as)}${query}`,
    );
    ws.frames = [];
    ws.on("message", (data) => ws.frames.push(new Uint8Array(data)));
    ws.next = async (type) => {
      for (let i = 0; i < 100; i++) {
        const found = ws.frames.find((f) => f[0] === type);
        if (found) return found;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`no frame of type ${type}`);
    };
    return new Promise((resolve) => ws.on("open", () => resolve(ws)));
  };

  it("lets the host admit a guest, who then receives the lesson", async () => {
    const host = await connect("maya", "&create=1");
    expect((await host.next(T.HELLO))[3]).toBe(1);

    const guest = await connect("daniel", "");
    await guest.next(T.HELLO);
    let roster;
    for (let i = 0; i < 50 && !roster?.requests?.length; i++) {
      roster = readJson(host.frames.filter((f) => f[0] === T.PRESENCE).at(-1));
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(roster.requests.map((r) => r.name)).toEqual(["Daniel Okafor"]);

    host.send(slotFrame(T.ADMIT, roster.requests[0].slot));
    await guest.next(T.ADMITTED);
    host.close();
    guest.close();
  });
});

describe("letterboard sessions", () => {
  // Opens a socket and collects its JSON messages, so a test can wait for one.
  const connect = (path) => {
    const ws = new WebSocket(`${stub.url.replace("http", "ws")}${path}`);
    ws.messages = [];
    ws.on("message", (data) => ws.messages.push(JSON.parse(data.toString())));
    ws.next = async (type) => {
      for (let i = 0; i < 100; i++) {
        const found = ws.messages.find((m) => m.type === type);
        if (found) return found;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`no message of type ${type}`);
    };
    return new Promise((resolve) => ws.on("open", () => resolve(ws)));
  };

  it("relays between a signed-in host and an anonymous board, either way", async () => {
    const host = await connect(
      `/practice/k7pm2x?create=1&token=${tokenFor("maya")}`,
    );
    expect(await host.next("hello")).toEqual({ type: "hello", boards: 0 });
    host.send(
      JSON.stringify({ type: "state", lessonId: PENGUINS, step: 2, text: "" }),
    );

    // The board types the code in capitals and gets the host's last state.
    const board = await connect("/practice/K7PM2X");
    expect(await board.next("hello")).toEqual({
      type: "hello",
      lessonId: PENGUINS,
      step: 2,
      text: "",
    });
    expect(await host.next("boards")).toEqual({ type: "boards", count: 1 });

    board.send(JSON.stringify({ type: "text", text: "fis", extra: true }));
    expect(await host.next("text")).toEqual({ type: "text", text: "fis" });
    host.send(
      JSON.stringify({
        type: "state",
        lessonId: PENGUINS,
        step: 2,
        text: "fis",
      }),
    );
    expect(await board.next("state")).toEqual({
      type: "state",
      lessonId: PENGUINS,
      step: 2,
      text: "fis",
    });

    host.close();
    expect(await board.next("removed")).toMatchObject({ type: "removed" });
  });

  it("tells a board when nobody is hosting the code", async () => {
    const board = await connect("/practice/NOBODY");
    expect(await board.next("error")).toMatchObject({ type: "error" });
  });

  it("says it can host letterboard sessions", async () => {
    expect(await json("GET", "/practice")).toEqual({ available: true });
  });

  it("survives a bad frame from a board", async () => {
    const host = await connect(
      `/practice/BADFRM?create=1&token=${tokenFor("maya")}`,
    );
    await host.next("hello");
    const board = await connect("/practice/BADFRM");
    await board.next("hello");
    // A text frame that isn't UTF-8 is a protocol error the server has to
    // handle on that socket, not throw.
    const closed = new Promise((resolve) => board.on("close", resolve));
    board.send(Buffer.from([0xff, 0xfe]), { binary: false });
    await closed;
    expect(await host.next("boards")).toMatchObject({ type: "boards" });
    expect((await call("GET", "/practice")).status).toBe(200);
    host.close();
  });

  it("refuses a malformed code without falling over", async () => {
    // A bad escape used to throw inside the upgrade listener and end the process.
    for (const path of ["/practice/%ZZ", "/collab/%ZZ"]) {
      const ws = new WebSocket(`${stub.url.replace("http", "ws")}${path}`);
      const status = await new Promise((resolve) => {
        ws.on("unexpected-response", (_req, res) => resolve(res.statusCode));
        ws.on("error", () => resolve("error"));
      });
      expect(status).toBe(400);
    }
    expect((await call("GET", "/practice")).status).toBe(200);
  });
});
