// Fedify's key-value store over PostgREST, run against an in-process PostgREST.
//
// The fake serves the slice this adapter uses: a filtered select by key or by
// LIKE pattern, an upsert, a delete. The LIKE case is the one worth having: the
// key encoding exists so that a prefix listing cannot be widened by a `_` or
// `%` in a key, and a fake that applies the pattern as SQL would is what checks
// that.

import { describe, expect, it } from "vitest";

import {
  decodeKey,
  encodeKey,
  postgrestFedifyKv,
} from "./postgrestFedifyKv.js";

const API_KEY = "service-role-key";

/** SQL LIKE semantics over a PostgREST pattern, where `*` stands for `%`. */
function likeMatcher(pattern) {
  const re = pattern
    .split("")
    .map((c) =>
      c === "*"
        ? ".*"
        : c === "_"
          ? "."
          : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
  return new RegExp(`^${re}$`, "s");
}

// `maxRows` is PostgREST's own cap on a response, which it applies silently.
function fakePostgrest({ maxRows = Infinity } = {}) {
  const rows = new Map();
  const requests = [];

  async function handle(input, init = {}) {
    const url = new URL(input);
    const method = (init.method || "GET").toUpperCase();
    const headers = new Headers(init.headers);
    if (headers.get("apikey") !== API_KEY)
      return new Response("{}", { status: 401 });
    if (!url.pathname.endsWith("/rest/v1/kv_store"))
      return new Response("{}", { status: 404 });

    if (method === "POST") {
      const body = JSON.parse(init.body);
      rows.set(body.key, {
        key: body.key,
        value: body.value,
        expires_at: body.expires_at ?? null,
      });
      return new Response(null, { status: 201 });
    }

    const filter = url.searchParams.get("key") || "";
    let matched = [];
    if (filter.startsWith("eq.")) {
      const row = rows.get(filter.slice(3));
      matched = row ? [row] : [];
    } else if (filter.startsWith("like.")) {
      const re = likeMatcher(filter.slice(5));
      matched = [...rows.values()]
        .filter((row) => re.test(row.key))
        .sort((a, b) => a.key.localeCompare(b.key));
    }

    if (method === "DELETE") {
      for (const row of matched) rows.delete(row.key);
      return new Response(null, { status: 204 });
    }
    requests.push(url.search);
    const offset = Number(url.searchParams.get("offset") || 0);
    const limit = Math.min(
      Number(url.searchParams.get("limit") || Infinity),
      maxRows,
    );
    const page = matched.slice(offset, offset + limit);
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  return { fetch: handle, rows, requests };
}

const storeOver = (server, options = {}) =>
  postgrestFedifyKv({
    url: "https://db.test",
    apiKey: API_KEY,
    fetch: server.fetch,
    ...options,
  });

describe("key encoding", () => {
  it("round-trips every character a LIKE pattern or the separator would misread", () => {
    const key = ["_fedify", "remote%Document", "https://a.example/x_y/z~w\\q"];
    expect(decodeKey(encodeKey(key))).toEqual(key);
  });

  it("leaves no wildcard in the encoded key", () => {
    expect(encodeKey(["_fedify", "50%", "a\\b"])).not.toMatch(/[%_\\]/);
  });

  it("does not claim keys that are not its own", () => {
    expect(decodeKey("ratelimit:ai:1.2.3.4")).toBeNull();
  });
});

describe("postgrestFedifyKv", () => {
  it("stores and reads back JSON values, with null as a value and undefined as a miss", async () => {
    const store = storeOver(fakePostgrest());
    await store.set(["a", "b"], { n: 1, s: "x" });
    await store.set(["a", "null"], null);
    expect(await store.get(["a", "b"])).toEqual({ n: 1, s: "x" });
    expect(await store.get(["a", "null"])).toBeNull();
    expect(await store.get(["a", "missing"])).toBeUndefined();
  });

  it("expires an entry whose Temporal-style ttl has passed", async () => {
    const server = fakePostgrest();
    const store = storeOver(server);
    await store.set(["t"], "v", { ttl: { total: () => 60_000 } });
    expect(await store.get(["t"])).toBe("v");
    // Rewind the stored expiry rather than waiting for it.
    const row = server.rows.get(encodeKey(["t"]));
    row.expires_at = new Date(Date.now() - 1000).toISOString();
    expect(await store.get(["t"])).toBeUndefined();
  });

  it("deletes", async () => {
    const store = storeOver(fakePostgrest());
    await store.set(["d"], 1);
    await store.delete(["d"]);
    expect(await store.get(["d"])).toBeUndefined();
    // Deleting an absent key is not an error.
    await store.delete(["d"]);
  });

  it("lists exactly the keys under a prefix, however the prefix is spelled", async () => {
    const server = fakePostgrest();
    const store = storeOver(server);
    await store.set(["_fedify", "publicKey", "k1"], 1);
    await store.set(["_fedify", "publicKey", "k2"], 2);
    await store.set(["_fedify", "remoteDocument", "d1"], 3);
    await store.set(["xfedifyx", "publicKey", "k3"], 4);
    // A rate-limit row sharing the table is never one of ours.
    server.rows.set("ratelimit:ai:x", {
      key: "ratelimit:ai:x",
      value: "{}",
      expires_at: null,
    });

    const keys = [];
    for await (const entry of store.list(["_fedify", "publicKey"]))
      keys.push(entry.key.join("/"));
    expect(keys).toEqual(["_fedify/publicKey/k1", "_fedify/publicKey/k2"]);

    const all = [];
    for await (const entry of store.list()) all.push(entry.key[0]);
    expect(all).toEqual(["_fedify", "_fedify", "_fedify", "xfedifyx"]);
  });

  it("lists whole segments, never a key that only starts with the same letters", async () => {
    const store = storeOver(fakePostgrest());
    await store.set(["_fedify", "publicKey"], "exact");
    await store.set(["_fedify", "publicKey", "k"], "below");
    await store.set(["_fedify", "publicKeyX", "k"], "neighbour");
    const listed = [];
    for await (const entry of store.list(["_fedify", "publicKey"]))
      listed.push(entry.value);
    expect(listed).toEqual(["exact", "below"]);
  });

  it("pages through a listing longer than one response", async () => {
    // PostgREST would cut a single unpaged response at max-rows (3 here) and
    // say nothing; every key has to come back regardless.
    const server = fakePostgrest({ maxRows: 3 });
    const store = storeOver(server, { pageRows: 3 });
    for (let i = 0; i < 8; i++)
      await store.set(["_fedify", "remoteDocument", `d${i}`], i);
    const listed = [];
    for await (const entry of store.list(["_fedify", "remoteDocument"]))
      listed.push(entry.value);
    expect(listed.sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(server.requests.filter((q) => q.includes("like.")).length).toBe(3);
  });

  it("reads an unreachable store as a miss rather than failing the caller", async () => {
    const store = postgrestFedifyKv({
      url: "https://db.test",
      apiKey: API_KEY,
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(await store.get(["x"])).toBeUndefined();
    await expect(store.set(["x"], 1)).rejects.toThrow();
  });
});
