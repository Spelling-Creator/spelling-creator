// @vitest-environment happy-dom

// Hosting a letterboard session from the Practice page, against a stub room.
//
// The room is a stub WebSocket the test drives by hand, speaking the JSON
// messages of the board contract (docs/live-sync.md in the board's repository),
// and the hook runs inside a real React root so its effects (the debounced
// `state` above all) run as they do in interactive mode.

import { act, createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureCore } from "@spelling-creator/core/config";
import {
  checkPracticeAvailable,
  forgetPracticeAvailability,
  newPracticeCode,
  usePracticeHost,
} from "./practiceLink.js";

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

  receive(message) {
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
      .filter((d) => typeof d === "string" && d !== "ping")
      .map((d) => JSON.parse(d))
      .filter((m) => m.type === "state");
  }
}

// ---- the harness ------------------------------------------------------------

/**
 * Mount the hook the way InteractiveLesson does, with the step and the answer
 * box as state the test can change.
 */
function mount({ accessToken = "token" } = {}) {
  const handle = {
    link: null,
    setStep: null,
    setText: null,
    texts: [],
    answers: [],
    steps: [],
  };

  function Harness() {
    const [step, setStep] = useState(0);
    const [text, setText] = useState("");
    const link = usePracticeHost({
      accessToken,
      lessonId: "lesson-1",
      step,
      text,
      onText: (t) => handle.texts.push(t),
      onAnswer: (t) => handle.answers.push(t),
      onStep: (s) => handle.steps.push(s),
    });
    useEffect(() => {
      handle.link = link;
      handle.setStep = setStep;
      handle.setText = setText;
    }, [link]);
    return null;
  }

  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(createElement(Harness)));
  handle.unmount = () => act(() => root.unmount());
  return handle;
}

// Let timers run, inside act so React applies the state they set. 100ms is past
// the hook's 50ms state debounce.
async function settle(ms = 100) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function startAndHello(handle) {
  act(() => handle.link.start());
  const ws = StubSocket.instances.at(-1);
  act(() => ws.open());
  act(() => ws.receive({ type: "hello", boards: 0 }));
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

  const answer = (status, body) =>
    vi.fn(async () => ({ ok: status === 200, json: async () => body }));

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

  it("opens the session as its host and tells the room where the lesson is", async () => {
    handle = mount();
    const ws = await startAndHello(handle);

    expect(ws.url).toMatch(
      /^wss:\/\/api\.example\.test\/practice\/[A-Z2-9]{6}\?create=1&token=token$/,
    );
    expect(handle.link.status).toBe("live");
    expect(handle.link.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(ws.url).toContain(`/practice/${handle.link.code}?`);

    // The first state goes out on hello, so a board that was waiting is caught up.
    expect(ws.states()).toEqual([
      { type: "state", lessonId: "lesson-1", step: 0, text: "" },
    ]);

    // Then one per change, coalesced.
    act(() => handle.setStep(2));
    act(() => handle.setText("the"));
    await settle();
    expect(ws.states().at(-1)).toEqual({
      type: "state",
      lessonId: "lesson-1",
      step: 2,
      text: "the",
    });
    expect(ws.states()).toHaveLength(2);
  });

  it("hands a board's sentence, answer and move request to interactive mode", async () => {
    handle = mount();
    const ws = await startAndHello(handle);

    act(() => ws.receive({ type: "text", text: "ca" }));
    act(() => ws.receive({ type: "text", text: "cat" }));
    act(() => ws.receive({ type: "answer", text: "cat" }));
    act(() => ws.receive({ type: "step", step: 3 }));
    act(() => ws.receive({ type: "boards", count: 2 }));
    await settle();

    expect(handle.texts).toEqual(["ca", "cat"]);
    expect(handle.answers).toEqual(["cat"]);
    expect(handle.steps).toEqual([3]);
    expect(handle.link.boards).toBe(2);
  });

  it("ignores what isn't a message of the contract", async () => {
    handle = mount();
    const ws = await startAndHello(handle);

    act(() => ws.receive("pong"));
    act(() => ws.receive("not json"));
    act(() => ws.receive({ type: "later-addition", text: "x" }));
    act(() => ws.receive({ type: "step", step: -1 }));
    act(() => ws.receive({ type: "step", step: "2" }));
    act(() => ws.receive({ type: "text", text: 7 }));
    await settle();

    expect(handle.texts).toEqual([]);
    expect(handle.steps).toEqual([]);
    expect(handle.link.status).toBe("live");
  });

  it("ends the session when asked, quietly", async () => {
    handle = mount();
    const ws = await startAndHello(handle);

    act(() => handle.link.stop());
    await settle();
    expect(ws.closed).toBe(true);
    expect(handle.link.status).toBe("idle");
    expect(handle.link.code).toBeNull();
    expect(handle.link.error).toBeNull();
  });

  it("keeps a session started straight after ending one", async () => {
    handle = mount();
    const first = await startAndHello(handle);

    // End, and start again before the first socket has finished closing.
    act(() => handle.link.stop());
    act(() => handle.link.start());
    const second = StubSocket.instances.at(-1);
    expect(second).not.toBe(first);
    act(() => second.open());
    act(() => second.receive({ type: "hello", boards: 0 }));

    // The first socket's late close and a stray last message arrive now. Neither
    // may end the new session or reach interactive mode.
    act(() => first.receive({ type: "text", text: "stale" }));
    await settle();
    expect(first.closed).toBe(true);
    expect(second.closed).toBe(false);
    expect(handle.link.status).toBe("live");
    expect(handle.link.error).toBeNull();
    expect(handle.texts).toEqual([]);
  });

  it("says so when the room drops the connection", async () => {
    handle = mount();
    const ws = await startAndHello(handle);

    act(() => ws.drop());
    await settle();
    expect(handle.link.status).toBe("idle");
    expect(handle.link.error).toBe("disconnected");
  });

  it("tells a refused join apart from a dropped session", async () => {
    handle = mount();
    act(() => handle.link.start());
    const ws = StubSocket.instances.at(-1);
    // The Worker refused the upgrade: closed before any hello.
    act(() => ws.drop());
    await settle();
    expect(handle.link.error).toBe("refused");
    expect(handle.link.status).toBe("idle");
  });

  it("needs a signed-in host", async () => {
    handle = mount({ accessToken: "" });
    act(() => handle.link.start());
    await settle();
    expect(StubSocket.instances).toHaveLength(0);
    expect(handle.link.error).toBe("signIn");
  });
});
