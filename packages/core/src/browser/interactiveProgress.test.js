import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PROGRESS_RECORDS,
  PROGRESS_MAX_AGE_MS,
  clearInteractiveProgress,
  hasInteractiveProgress,
  loadInteractiveProgress,
  pruneProgress,
  saveInteractiveProgress,
} from "./interactiveProgress.js";
import { MAX_RESPONSE_LENGTH } from "../interactive.js";

// A localStorage that behaves like the real one, plus a switch for the browsers
// that refuse us storage entirely (private browsing, a full quota).
function fakeStorage() {
  const entries = new Map();
  return {
    throws: false,
    getItem(key) {
      if (this.throws) throw new Error("nope");
      return entries.has(key) ? entries.get(key) : null;
    },
    setItem(key, value) {
      if (this.throws) throw new Error("nope");
      entries.set(key, String(value));
    },
  };
}

let storage;

beforeEach(() => {
  storage = fakeStorage();
  globalThis.localStorage = storage;
});

afterEach(() => {
  delete globalThis.localStorage;
  vi.useRealTimers();
});

describe("saveInteractiveProgress / loadInteractiveProgress", () => {
  it("remembers where someone got to and what they typed", () => {
    expect(
      saveInteractiveProgress("lesson-1", "user-1", {
        stepKey: "s1:b3",
        answers: { b3: "Italy" },
      }),
    ).toBe(true);

    expect(loadInteractiveProgress("lesson-1", "user-1")).toMatchObject({
      stepKey: "s1:b3",
      answers: { b3: "Italy" },
    });
  });

  it("has nothing for a lesson that was never started", () => {
    expect(loadInteractiveProgress("lesson-1", "user-1")).toBeNull();
    expect(hasInteractiveProgress("lesson-1", "user-1")).toBe(false);
    expect(loadInteractiveProgress("", "user-1")).toBeNull();
  });

  it("keeps each learner's attempt apart on a shared machine", () => {
    saveInteractiveProgress("lesson-1", "user-1", {
      stepKey: "s1:b3",
      answers: { b3: "Italy" },
    });
    saveInteractiveProgress("lesson-1", "user-2", {
      stepKey: "s1:b4",
      answers: { b4: "Pressure" },
    });

    expect(loadInteractiveProgress("lesson-1", "user-1").answers).toEqual({
      b3: "Italy",
    });
    expect(loadInteractiveProgress("lesson-1", "user-2").answers).toEqual({
      b4: "Pressure",
    });
    // A signed-out learner is their own owner, not either of the two above.
    expect(loadInteractiveProgress("lesson-1", null)).toBeNull();
  });

  it("keeps each lesson's attempt apart", () => {
    saveInteractiveProgress("lesson-1", "user-1", { answers: { b3: "Italy" } });
    expect(loadInteractiveProgress("lesson-2", "user-1")).toBeNull();
  });

  it("drops blank answers, so clearing a field sticks", () => {
    saveInteractiveProgress("lesson-1", "user-1", {
      answers: { b3: "Italy", b4: "   ", b5: "" },
    });
    expect(loadInteractiveProgress("lesson-1", "user-1").answers).toEqual({
      b3: "Italy",
    });
  });

  it("truncates an answer to the same limit a submission has", () => {
    saveInteractiveProgress("lesson-1", "user-1", {
      answers: { b3: "x".repeat(MAX_RESPONSE_LENGTH + 100) },
    });
    expect(
      loadInteractiveProgress("lesson-1", "user-1").answers.b3,
    ).toHaveLength(MAX_RESPONSE_LENGTH);
  });

  it("says so when the browser refuses us storage", () => {
    storage.throws = true;
    expect(
      saveInteractiveProgress("lesson-1", "user-1", { answers: { b3: "a" } }),
    ).toBe(false);
    expect(loadInteractiveProgress("lesson-1", "user-1")).toBeNull();
  });

  it("survives junk under its key", () => {
    storage.setItem("spelling-creator:interactive-progress", "not json");
    expect(loadInteractiveProgress("lesson-1", "user-1")).toBeNull();
    expect(
      saveInteractiveProgress("lesson-1", "user-1", { answers: { b3: "a" } }),
    ).toBe(true);
    expect(loadInteractiveProgress("lesson-1", "user-1").answers).toEqual({
      b3: "a",
    });
  });
});

describe("clearInteractiveProgress", () => {
  it("forgets one lesson and leaves the rest alone", () => {
    saveInteractiveProgress("lesson-1", "user-1", { answers: { b3: "Italy" } });
    saveInteractiveProgress("lesson-2", "user-1", { answers: { b9: "Lava" } });

    expect(clearInteractiveProgress("lesson-1", "user-1")).toBe(true);
    expect(loadInteractiveProgress("lesson-1", "user-1")).toBeNull();
    expect(loadInteractiveProgress("lesson-2", "user-1")).not.toBeNull();
  });

  it("is happy when there was nothing to forget", () => {
    expect(clearInteractiveProgress("lesson-1", "user-1")).toBe(true);
  });
});

describe("hasInteractiveProgress", () => {
  it("is true once there is an answer or a step to come back to", () => {
    saveInteractiveProgress("lesson-1", "user-1", { answers: { b3: "Italy" } });
    expect(hasInteractiveProgress("lesson-1", "user-1")).toBe(true);

    saveInteractiveProgress("lesson-2", "user-1", { stepKey: "s2:content" });
    expect(hasInteractiveProgress("lesson-2", "user-1")).toBe(true);
  });

  it("is false for a record with neither", () => {
    saveInteractiveProgress("lesson-1", "user-1", {});
    expect(hasInteractiveProgress("lesson-1", "user-1")).toBe(false);
  });
});

describe("expiry and pruning", () => {
  it("forgets a run-through nobody came back to", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    saveInteractiveProgress("lesson-1", "user-1", { answers: { b3: "Italy" } });

    vi.setSystemTime(Date.now() + PROGRESS_MAX_AGE_MS - 1000);
    expect(loadInteractiveProgress("lesson-1", "user-1")).not.toBeNull();

    vi.setSystemTime(Date.now() + 2000);
    expect(loadInteractiveProgress("lesson-1", "user-1")).toBeNull();
  });

  it("keeps the most recently touched records and drops the rest", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    for (let i = 0; i < MAX_PROGRESS_RECORDS + 5; i += 1) {
      vi.setSystemTime(Date.now() + 1000);
      saveInteractiveProgress(`lesson-${i}`, "user-1", { answers: { b: "x" } });
    }

    expect(loadInteractiveProgress("lesson-0", "user-1")).toBeNull();
    expect(loadInteractiveProgress("lesson-4", "user-1")).toBeNull();
    expect(loadInteractiveProgress("lesson-5", "user-1")).not.toBeNull();
    expect(
      loadInteractiveProgress(`lesson-${MAX_PROGRESS_RECORDS + 4}`, "user-1"),
    ).not.toBeNull();
  });

  it("drops malformed records rather than handing them back", () => {
    const now = Date.now();
    const pruned = pruneProgress(
      {
        good: { stepKey: "a", answers: {}, updatedAt: now },
        noAnswers: { stepKey: "a", updatedAt: now },
        noStamp: { stepKey: "a", answers: {} },
        notAnObject: "nope",
      },
      now,
    );
    expect(Object.keys(pruned)).toEqual(["good"]);
  });
});
