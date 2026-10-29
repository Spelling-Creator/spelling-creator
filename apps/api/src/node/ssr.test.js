// What the server render answers when the page's data is missing, driven
// through the Node entry with only PostgREST faked (the harness
// selfFetch.test.js established). The case under test: a lesson or profile the
// API 404s must come back as a real 404 — still carrying the shell, so a
// private draft's author reaches it after hydration — while an API that is
// merely broken keeps the soft 200 fall-through.

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createHandler } from "./server.js";

const SHELL =
  '<!doctype html><html><head><title>shell</title></head><body><div id="root"></div></body></html>';

describe("server rendering a page that does not exist", () => {
  let root;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "spelling-ssr-404-"));
    await writeFile(join(root, "index.html"), SHELL);
  });
  afterEach(() => vi.unstubAllGlobals());

  const handler = (network) => {
    vi.stubGlobal("fetch", network);
    return createHandler({
      WEB_DIST: root,
      SUPABASE_URL: "http://db.test",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SUPABASE_ANON_KEY: "anon",
    });
  };
  const ask = (handle, path) =>
    handle(
      new Request(`http://localhost:8080${path}`, {
        headers: { accept: "text/html" },
      }),
    );

  it("answers a deleted lesson's URL with a real 404, still carrying the shell", async () => {
    // PostgREST finds no row, so the API's lesson route answers 404 — which
    // must reach the crawler as one, not as a page insisting it exists.
    const handle = handler(vi.fn(async () => Response.json([])));
    const res = await ask(handle, "/hub/7296d446-4039-4c2d-8393-9d46a1dda3d3");

    expect(res.status).toBe(404);
    expect(res.headers.get("x-rendered")).toBe("ssr-404");
    // The body is the shell: the SPA ignores the status, hydrates, and lets a
    // signed-in author reach their own private draft.
    expect(await res.text()).toContain('<div id="root">');
  });

  it("answers a missing profile's URL with a real 404", async () => {
    const handle = handler(vi.fn(async () => Response.json([])));
    const res = await ask(
      handle,
      "/users/00000000-0000-0000-0000-000000000001",
    );
    expect(res.status).toBe(404);
  });

  it("keeps the soft 200 fall-through when the API is broken rather than missing", async () => {
    // A timeout and a deletion must not be confused: an unreachable backend
    // still gets the plain shell under 200, exactly what the app served
    // before SSR existed.
    const handle = handler(
      vi.fn(async () => Promise.reject(new TypeError("fetch failed"))),
    );
    const res = await ask(handle, "/hub/7296d446-4039-4c2d-8393-9d46a1dda3d3");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
  });
});
