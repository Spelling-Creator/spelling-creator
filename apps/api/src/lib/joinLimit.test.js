// The join token bucket (takeJoinToken), shared by /collab and /practice.

import { describe, expect, it } from "vitest";

import { takeJoinToken } from "./joinLimit.js";

// A key-value store in memory, shaped like the rate-limit store.
function memoryKv(initial = {}) {
  const rows = new Map(Object.entries(initial));
  return {
    rows,
    get: async (key) => rows.get(key) ?? null,
    put: async (key, value) => void rows.set(key, value),
  };
}

const opts = { message: "Slow down.", limit: 3, windowSeconds: 60 };

describe("takeJoinToken", () => {
  it("lets a burst up to the limit through, then refuses with a Retry-After", async () => {
    const kv = memoryKv();
    for (let i = 0; i < 3; i++)
      expect(await takeJoinToken(kv, "k", opts)).toBeNull();
    const refused = await takeJoinToken(kv, "k", opts);
    expect(refused.status).toBe(429);
    expect(await refused.text()).toBe("Slow down.");
    expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("starts a fresh bucket over a row that is not one, rather than failing every join", async () => {
    for (const bad of [
      "not json",
      '"a string"',
      '{"tokens":"x","last":1}',
      "null",
    ]) {
      const kv = memoryKv({ k: bad });
      expect(await takeJoinToken(kv, "k", opts)).toBeNull();
      expect(JSON.parse(kv.rows.get("k")).tokens).toBe(2);
    }
  });
});
