// The image store opens its IndexedDB database once and keeps it. What is
// pinned down here is that a failed open isn't kept too, so one bad moment
// doesn't leave every later read and write failing. IndexedDB itself is
// stubbed: only the open and one read are needed.

import { afterEach, describe, expect, it, vi } from "vitest";

// A request that answers on a later tick, the way IndexedDB's do.
function request<T>(result: T) {
  const req: { result: T; onsuccess: (() => void) | null } = {
    result,
    onsuccess: null,
  };
  setTimeout(() => req.onsuccess?.(), 0);
  return req;
}

const db = {
  transaction: () => ({
    objectStore: () => ({ get: () => request("lesson-1") }),
  }),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("opening the database", () => {
  it("tries again after an open that failed", async () => {
    const open = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("blocked");
      })
      .mockImplementation(() => request(db));
    vi.stubGlobal("indexedDB", { open });
    const { loadEditingId } = await import("./imageStore.ts");

    expect(await loadEditingId()).toBe(null);
    expect(await loadEditingId()).toBe("lesson-1");
    expect(open).toHaveBeenCalledTimes(2);
  });
});
