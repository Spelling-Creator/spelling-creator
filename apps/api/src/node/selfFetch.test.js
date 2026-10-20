// Requests to the origin being served are answered in-process, and nothing else
// is touched: the unit half drives the wrapper directly, and the second half
// server-renders a lesson page through createHandler with only PostgREST faked,
// which is the case this exists for.

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSelfFetch, servingSelf } from "./selfFetch.js";
import { createHandler } from "./server.js";

describe("createSelfFetch", () => {
  const network = vi.fn(
    async (input) =>
      new Response(`network:${input instanceof Request ? input.url : input}`),
  );
  const fetch = createSelfFetch(network);

  afterEach(() => network.mockClear());

  // A handler that answers /b itself, and for /a fetches whatever URL it is
  // told to. Wrapped, so fetches it makes see the origin it is serving.
  const handler = servingSelf(async (request) => {
    const url = new URL(request.url);
    if (url.pathname !== "/a")
      return new Response(`self:${request.method}:${await request.text()}`);
    const target = url.searchParams.get("fetch");
    const init = url.searchParams.has("post")
      ? { method: "POST", body: "hello" }
      : undefined;
    return fetch(target, init);
  });
  const ask = async (target, extra = "") =>
    (
      await handler(
        new Request(
          `http://localhost:8080/a?fetch=${encodeURIComponent(target)}${extra}`,
        ),
      )
    ).text();

  it("answers a fetch to the origin being served without the network", async () => {
    expect(await ask("http://localhost:8080/b")).toBe("self:GET:");
    expect(network).not.toHaveBeenCalled();
  });

  it("passes the method and body through", async () => {
    expect(await ask("http://localhost:8080/b", "&post")).toBe(
      "self:POST:hello",
    );
  });

  it("sends every other origin to the network, as it was called", async () => {
    // A different port is a different origin.
    expect(await ask("http://localhost:8787/b")).toBe(
      "network:http://localhost:8787/b",
    );
    expect(await ask("http://db.test/rest/v1/lessons")).toBe(
      "network:http://db.test/rest/v1/lessons",
    );
    expect(network).toHaveBeenCalledTimes(2);

    // Untouched: the same arguments, not a rebuilt Request, so the method and
    // body of a write to another service arrive as they were sent.
    await ask("http://db.test/rest/v1/lessons", "&post");
    const [input, init] = network.mock.calls.at(-1);
    expect(input).toBe("http://db.test/rest/v1/lessons");
    expect(init).toEqual({ method: "POST", body: "hello" });
  });

  it("sends PostgREST and GoTrue paths to the network even on our own origin", async () => {
    // One origin can serve the app and, through a proxy, PostgREST and GoTrue
    // too. The app answers neither path, so they must go to the proxy.
    expect(await ask("http://localhost:8080/rest/v1/lessons")).toBe(
      "network:http://localhost:8080/rest/v1/lessons",
    );
    expect(await ask("http://localhost:8080/auth/v1/user")).toBe(
      "network:http://localhost:8080/auth/v1/user",
    );
    expect(await ask("http://localhost:8080/auth/v1")).toBe(
      "network:http://localhost:8080/auth/v1",
    );
    expect(network).toHaveBeenCalledTimes(3);

    // Only those paths: anything merely starting with the same letters is ours.
    expect(await ask("http://localhost:8080/restful")).not.toContain(
      "network:",
    );
  });

  it("uses the network outside a request", async () => {
    expect(await (await fetch("http://localhost:8080/b")).text()).toBe(
      "network:http://localhost:8080/b",
    );
  });
});

describe("server rendering behind a proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  const LESSON_ID = "7296d446-4039-4c2d-8393-9d46a1dda3d3";
  const row = {
    id: LESSON_ID,
    author_id: "00000000-0000-0000-0000-000000000001",
    title: "Volcano words",
    author: "Self Host Test",
    section_count: 1,
    published: true,
    shadowbanned: false,
    forked_from: null,
    created_at: "2026-10-18T00:00:00Z",
    doc: {
      title: "Volcano words",
      sections: [
        {
          id: "s1",
          name: "One",
          blocks: [{ id: "b1", type: "text", text: "Hello" }],
        },
      ],
    },
  };

  it("renders a lesson page when its public address does not lead back here", async () => {
    const root = await mkdtemp(join(tmpdir(), "spelling-ssr-"));
    await writeFile(
      join(root, "index.html"),
      '<!doctype html><html><head><title>shell</title></head><body><div id="root"></div></body></html>',
    );

    // The only network this process has: a fake PostgREST. A request for
    // localhost:8080 reaching it would mean the self-request went out.
    const network = vi.fn(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.origin !== "http://db.test")
        return Promise.reject(new TypeError("fetch failed"));
      if (url.pathname === "/rest/v1/lessons") return Response.json([row]);
      return Response.json([]);
    });
    vi.stubGlobal("fetch", network);

    const handler = createHandler({
      WEB_DIST: root,
      SUPABASE_URL: "http://db.test",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SUPABASE_ANON_KEY: "anon",
    });
    const res = await handler(
      new Request(`http://localhost:8080/hub/${LESSON_ID}`, {
        headers: { accept: "text/html" },
      }),
    );

    expect(res.headers.get("x-rendered")).toBe("ssr");
    expect(await res.text()).toContain("Volcano words");
    const origins = network.mock.calls.map(
      ([input]) => new URL(input instanceof Request ? input.url : input).origin,
    );
    expect(origins).not.toContain("http://localhost:8080");
  });
});
