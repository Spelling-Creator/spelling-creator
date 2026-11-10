// Hosting a letterboard session, against a stub room.
//
// The room is a stub WebSocket the test drives by hand, speaking the JSON
// messages of the board contract (docs/live-sync.md in the board's repository).
// The session is driven directly: its position set as interactive mode would
// set it, its snapshot read as a page would read it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureCore } from "../config.ts";
import {
  checkPracticeAvailable,
  createPracticeHost,
  forgetPracticeAvailability,
  newPracticeCode,
  type PracticeHost,
} from "./practiceHost.ts";

// ---- the stub room ----------------------------------------------------------

class StubSocket {
  static OPEN = 1;
  static instances: StubSocket[] = [];

  url: string;
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

  // Like a browser, closing finishes later: the close event arrives on a later
  // turn, after whatever the caller did next.
  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 2;
    setTimeout(() => {
      this.readyState = 3;
      this.onclose?.();
    }, 0);
  }

  open() {
    this.readyState = StubSocket.OPEN;
    this.onopen?.();
  }

  receive(message: unknown) {
    this.onmessage?.({
      data: typeof message === "string" ? message : JSON.stringify(message),
    });
  }

  // The room dropped us.
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }

  // Every `state` this host has sent, decoded.
  states() {
    return this.sent
      .filter((d): d is string => typeof d === "string" && d !== "ping")
      .map((d) => JSON.parse(d) as { type: string })
      .filter((m) => m.type === "state");
  }
}

// ---- the harness ------------------------------------------------------------

/** A host wired the way interactive mode wires it, with a lesson open. */
function host() {
  const seen = {
    texts: [] as string[],
    answers: [] as string[],
    steps: [] as number[],
  };
  const session = createPracticeHost({
    onText: (t) => seen.texts.push(t),
    onAnswer: (t) => seen.answers.push(t),
    onStep: (s) => seen.steps.push(s),
  });
  session.setPosition({ lessonId: "lesson-1", step: 0, text: "" });
  return { session, seen };
}

// Let timers run. 100ms is past the session's 50ms state debounce.
const settle = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

async function startAndHello(session: PracticeHost) {
  session.start("token");
  const ws = StubSocket.instances.at(-1)!;
  ws.open();
  ws.receive({ type: "hello", boards: 0 });
  await settle();
  return ws;
}

// ---- tests ------------------------------------------------------------------

describe("newPracticeCode", () => {
  it("makes a six-character code a partner can read off a screen", () => {
    for (let i = 0; i < 50; i++) {
      expect(newPracticeCode()).toMatch(
        /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/,
      );
    }
  });
});

describe("checkPracticeAvailable", () => {
  beforeEach(() => {
    forgetPracticeAvailability();
    configureCore({ apiUrl: "https://api.example.test" });
  });

  afterEach(() => {
    forgetPracticeAvailability();
    vi.unstubAllGlobals();
  });

  const answer = (status: number, body: unknown) =>
    vi.fn(async (_url: string) => ({
      ok: status === 200,
      json: async () => body,
    }));

  it("asks the hub once, and believes a yes", async () => {
    const fetch = answer(200, { available: true });
    vi.stubGlobal("fetch", fetch);
    expect(await checkPracticeAvailable()).toBe(true);
    expect(await checkPracticeAvailable()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("https://api.example.test/practice");
  });

  it("reads a self-hosted hub's 404, or a Worker without the room, as no", async () => {
    vi.stubGlobal("fetch", answer(404, null));
    expect(await checkPracticeAvailable()).toBe(false);
    forgetPracticeAvailability();
    vi.stubGlobal("fetch", answer(200, { available: false }));
    expect(await checkPracticeAvailable()).toBe(false);
  });

  it("asks again after a network failure rather than remembering it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    expect(await checkPracticeAvailable()).toBe(false);
    const fetch = answer(200, { available: true });
    vi.stubGlobal("fetch", fetch);
    expect(await checkPracticeAvailable()).toBe(true);
  });

  it("doesn't ask at all without a hub", async () => {
    configureCore({ apiUrl: "" });
    const fetch = answer(200, { available: true });
    vi.stubGlobal("fetch", fetch);
    expect(await checkPracticeAvailable()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("hosting a letterboard session", () => {
  let session: PracticeHost | null = null;

  beforeEach(() => {
    StubSocket.instances = [];
    vi.stubGlobal("WebSocket", StubSocket);
    configureCore({ apiUrl: "https://api.example.test" });
  });

  afterEach(() => {
    session?.stop();
    session = null;
    vi.unstubAllGlobals();
  });

  it("opens the session as its host and tells the room where the lesson is", async () => {
    ({ session } = host());
    const ws = await startAndHello(session);

    expect(ws.url).toMatch(
      /^wss:\/\/api\.example\.test\/practice\/[A-Z2-9]{6}\?create=1&token=token$/,
    );
    const { status, code } = session.getSnapshot();
    expect(status).toBe("live");
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(ws.url).toContain(`/practice/${code}?`);

    // The first state goes out on hello, so a board that was waiting is caught up.
    expect(ws.states()).toEqual([
      { type: "state", lessonId: "lesson-1", step: 0, text: "" },
    ]);

    // Then one per change, coalesced.
    session.setPosition({ lessonId: "lesson-1", step: 2, text: "" });
    session.setPosition({ lessonId: "lesson-1", step: 2, text: "the" });
    await settle();
    expect(ws.states().at(-1)).toEqual({
      type: "state",
      lessonId: "lesson-1",
      step: 2,
      text: "the",
    });
    expect(ws.states()).toHaveLength(2);
  });

  it("leaves the lesson out of the state while none is open", async () => {
    ({ session } = host());
    session.setPosition({ step: 0, text: "" });
    const ws = await startAndHello(session);
    expect(ws.states()).toEqual([{ type: "state", step: 0, text: "" }]);
  });

  it("hands a board's sentence, answer and move request to interactive mode", async () => {
    const made = host();
    session = made.session;
    const ws = await startAndHello(session);

    ws.receive({ type: "text", text: "ca" });
    ws.receive({ type: "text", text: "cat" });
    ws.receive({ type: "answer", text: "cat" });
    ws.receive({ type: "step", step: 3 });
    ws.receive({ type: "boards", count: 2 });
    await settle();

    expect(made.seen.texts).toEqual(["ca", "cat"]);
    expect(made.seen.answers).toEqual(["cat"]);
    expect(made.seen.steps).toEqual([3]);
    expect(session.getSnapshot().boards).toBe(2);
  });

  it("reads messages with the handlers given last", async () => {
    const made = host();
    session = made.session;
    const ws = await startAndHello(session);
    const later: string[] = [];
    session.setHandlers({ onText: (t) => later.push(t) });

    ws.receive({ type: "text", text: "dog" });
    expect(made.seen.texts).toEqual([]);
    expect(later).toEqual(["dog"]);
  });

  it("ignores what isn't a message of the contract", async () => {
    const made = host();
    session = made.session;
    const ws = await startAndHello(session);

    ws.receive("pong");
    ws.receive("not json");
    ws.receive({ type: "later-addition", text: "x" });
    ws.receive({ type: "step", step: -1 });
    ws.receive({ type: "step", step: "2" });
    ws.receive({ type: "text", text: 7 });
    await settle();

    expect(made.seen.texts).toEqual([]);
    expect(made.seen.steps).toEqual([]);
    expect(session.getSnapshot().status).toBe("live");
  });

  it("ends the session when asked, quietly", async () => {
    ({ session } = host());
    const ws = await startAndHello(session);

    session.stop();
    await settle();
    expect(ws.closed).toBe(true);
    expect(session.getSnapshot()).toEqual({
      status: "idle",
      code: null,
      boards: 0,
      error: null,
    });
  });

  it("keeps a session started straight after ending one", async () => {
    const made = host();
    session = made.session;
    const first = await startAndHello(session);

    // End, and start again before the first socket has finished closing.
    session.stop();
    session.start("token");
    const second = StubSocket.instances.at(-1)!;
    expect(second).not.toBe(first);
    second.open();
    second.receive({ type: "hello", boards: 0 });

    // The first socket's late close and a stray last message arrive now. Neither
    // may end the new session or reach interactive mode.
    first.receive({ type: "text", text: "stale" });
    await settle();
    expect(first.closed).toBe(true);
    expect(second.closed).toBe(false);
    expect(session.getSnapshot().status).toBe("live");
    expect(session.getSnapshot().error).toBeNull();
    expect(made.seen.texts).toEqual([]);
  });

  it("says so when the room drops the connection", async () => {
    ({ session } = host());
    const ws = await startAndHello(session);

    ws.drop();
    await settle();
    expect(session.getSnapshot().status).toBe("idle");
    expect(session.getSnapshot().error).toBe("disconnected");
  });

  it("tells a refused join apart from a dropped session", async () => {
    ({ session } = host());
    session.start("token");
    const ws = StubSocket.instances.at(-1)!;
    // The Worker refused the upgrade: closed before any hello.
    ws.drop();
    await settle();
    expect(session.getSnapshot().error).toBe("refused");
    expect(session.getSnapshot().status).toBe("idle");
    session.clearError();
    expect(session.getSnapshot().error).toBeNull();
  });

  it("needs a signed-in host", async () => {
    ({ session } = host());
    session.start("");
    await settle();
    expect(StubSocket.instances).toHaveLength(0);
    expect(session.getSnapshot().error).toBe("signIn");
  });

  it("needs a hub", async () => {
    configureCore({ apiUrl: "" });
    ({ session } = host());
    session.start("token");
    expect(StubSocket.instances).toHaveLength(0);
    expect(session.getSnapshot().error).toBe("notConfigured");
  });

  it("tells a listener each time the snapshot changes", async () => {
    ({ session } = host());
    const seen: string[] = [];
    const stop = session.subscribe(() =>
      seen.push(session!.getSnapshot().status),
    );
    await startAndHello(session);
    expect(seen).toEqual(["connecting", "live"]);

    stop();
    session.stop();
    expect(seen).toEqual(["connecting", "live"]);
  });
});
