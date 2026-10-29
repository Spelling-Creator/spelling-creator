// The case selfFetch exists for on this host, end to end: a lesson page is
// server-rendered through createHandler with only PostgREST faked, while the
// public address does not lead back to the process. The wrapper's own unit
// suite lives next to the module (src/lib/selfFetch.test.js) and runs in both
// test projects; this half stays in node/ because it drives the Node entry and
// its filesystem asset server, which the workers project excludes.

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";

import { createHandler } from "./server.js";

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
