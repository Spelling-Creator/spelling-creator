// The new app's routes, driven through the Node entry with only PostgREST
// faked (the harness selfFetch.test.js established): that the paths the new
// app serves reach it and come back rendered, with the settings this host
// hands it in the page, and that every other path still goes where it did.

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createHandler } from "./server.js";

const SHELL =
  '<!doctype html><html><head><title>shell</title></head><body><div id="root"></div></body></html>';

const LESSON_ID = "7296d446-4039-4c2d-8393-9d46a1dda3d3";
const row = {
  id: LESSON_ID,
  author_id: "00000000-0000-0000-0000-000000000001",
  title: "Volcano words",
  author: "Next Test",
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
        blocks: [{ id: "b1", type: "text", text: "Hi" }],
      },
    ],
  },
};

describe("the new app's routes", () => {
  let root;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "spelling-next-"));
    await writeFile(join(root, "index.html"), SHELL);
  });
  afterEach(() => vi.unstubAllGlobals());

  const handler = (env = {}) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) => {
        const url = new URL(input instanceof Request ? input.url : input);
        if (url.pathname === "/rest/v1/lessons") return Response.json([row]);
        return Response.json([]);
      }),
    );
    return createHandler({
      WEB_DIST: root,
      SUPABASE_URL: "http://db.test",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SUPABASE_ANON_KEY: "anon",
      ...env,
    });
  };
  const ask = (handle, path, headers = { accept: "text/html" }) =>
    handle(new Request(`http://localhost:8080${path}`, { headers }));

  it("renders the hub with its listing and its JSON-LD", async () => {
    const res = await ask(handler(), "/hub");

    expect(res.status).toBe(200);
    expect(res.headers.get("x-rendered")).toBe("next");
    expect(res.headers.get("content-type")).toContain("text/html");
    const text = await res.text();
    expect(text).toContain("Volcano words");
    expect(text).toContain('"@type":"ItemList"');
    expect(text).toContain("<title>Lesson hub · Spelling Creator</title>");
  });

  it("writes this host's settings into the page, under the page's own origin", async () => {
    // The browser reaches the API and the identity service at the page's
    // origin unless PUBLIC_SUPABASE_URL says otherwise; the anon key comes
    // from the server's own environment. Nothing unset is written, so a
    // value baked into the build survives.
    const res = await ask(
      handler({ AUTH_MODE: "password", PUBLIC_SUPABASE_URL: "" }),
      "/hub",
    );
    const text = await res.text();
    const script = text.match(/window\.__CONFIG__=(\{[^<]*\})/);
    expect(script).not.toBeNull();
    expect(JSON.parse(script[1])).toEqual({
      apiUrl: "http://localhost:8080",
      supabaseUrl: "http://localhost:8080",
      supabaseAnonKey: "anon",
      authMode: "password",
    });
  });

  it("answers a client navigation's data request for the page", async () => {
    // React Router asks for a page's data under its path with a .data suffix.
    const res = await ask(handler(), "/hub.data", { accept: "*/*" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Volcano words");
  });

  it("leaves the pages the old app still serves to it", async () => {
    const handle = handler();
    const lesson = await ask(handle, `/hub/${LESSON_ID}`);
    expect(lesson.headers.get("x-rendered")).toBe("ssr");

    // An unknown path is the old app's real 404 too, not the new app's.
    const missing = await ask(handle, "/nonsense");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-rendered")).toBeNull();
  });
});
