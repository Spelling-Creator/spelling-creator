// @vitest-environment happy-dom

// useFactCheck keeps only the latest check's answer. A check takes seconds, and
// in that time the author can start another or switch lessons; a slow reply
// must not land on top of either.

import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const replies = [];
vi.mock("@spelling-creator/core/aiSuggest", () => ({
  // Each call waits until the test settles it.
  checkFacts: vi.fn(
    () => new Promise((resolve, reject) => replies.push({ resolve, reject })),
  ),
}));

const { useFactCheck } = await import("./factCheck.js");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function mount() {
  const seen = { current: null };
  function Harness() {
    const check = useFactCheck();
    useEffect(() => {
      seen.current = check;
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Harness)));
  return seen;
}

const doc = { title: "T", sections: [] };
const fact = (quote) => ({ quote, status: "disagrees" });

describe("useFactCheck", () => {
  it("ignores a reply that arrives after a newer check started", async () => {
    replies.length = 0;
    const check = mount();
    act(() => void check.current.run(doc, "a"));
    act(() => void check.current.run(doc, "b"));

    await act(async () => replies[1].resolve([fact("newer")]));
    await act(async () => replies[0].resolve([fact("older")]));

    expect(check.current.status).toBe("done");
    expect(check.current.facts.map((f) => f.quote)).toEqual(["newer"]);
  });

  it("ignores a late failure too", async () => {
    replies.length = 0;
    const check = mount();
    act(() => void check.current.run(doc, "a"));
    act(() => void check.current.run(doc, "b"));
    await act(async () => replies[1].resolve([fact("newer")]));
    await act(async () => replies[0].reject(new Error("too slow")));
    expect(check.current.status).toBe("done");
  });

  it("forgets the result, and a check still out, on reset", async () => {
    replies.length = 0;
    const check = mount();
    act(() => void check.current.run(doc, "a"));
    act(() => check.current.reset());
    await act(async () => replies[0].resolve([fact("old lesson")]));

    expect(check.current.status).toBe("idle");
    expect(check.current.facts).toEqual([]);
  });
});
