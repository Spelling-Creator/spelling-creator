// What crawlers are told about pages, driven through the Node entry with only
// PostgREST faked: the sitemap, including on a database that hasn't had the
// updated_at migration yet, and the noindex header on the signed-in pages.

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createHandler } from "./server.js";

const LESSON = {
  id: "7296d446-4039-4c2d-8393-9d46a1dda3d3",
  author_id: "00000000-0000-0000-0000-000000000001",
  created_at: "2026-10-01T09:00:00Z",
};

let root;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "spelling-seo-"));
  await writeFile(
    join(root, "index.html"),
    '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
  );
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
const get = (handle, path, accept = "text/html") =>
  handle(new Request(`http://localhost:8080${path}`, { headers: { accept } }));

describe("sitemap", () => {
  it("dates a lesson by its last edit, to the second", async () => {
    const network = vi.fn(async () =>
      Response.json([{ ...LESSON, updated_at: "2026-10-20T15:30:00Z" }]),
    );
    const xml = await (
      await get(handler(network), "/sitemap.xml", "*/*")
    ).text();
    expect(xml).toContain("<lastmod>2026-10-20T15:30:00.000Z</lastmod>");
    // Shadowbanned lessons stay out, as they do from the public listing.
    expect(String(network.mock.calls[0][0])).toContain("shadowbanned=eq.false");
  });

  it("still lists every lesson before the updated_at migration", async () => {
    // PostgREST rejects a select naming a column the table doesn't have. The
    // sitemap must not lose every lesson over it.
    const network = vi.fn(async (input) =>
      String(input).includes("updated_at")
        ? Response.json(
            {
              code: "42703",
              message: "column lessons.updated_at does not exist",
            },
            { status: 400 },
          )
        : Response.json([LESSON]),
    );
    const xml = await (
      await get(handler(network), "/sitemap.xml", "*/*")
    ).text();
    expect(xml).toContain(`/hub/${LESSON.id}</loc>`);
    expect(xml).toContain("<lastmod>2026-10-01T09:00:00.000Z</lastmod>");
  });
});

describe("noindex on the signed-in pages", () => {
  it("says noindex in a header, for crawlers that never run the app", async () => {
    const handle = handler(vi.fn(async () => Response.json([])));
    for (const path of ["/moderation", "/settings", "/editor", "/library"]) {
      const res = await get(handle, path);
      expect(res.status).toBe(200);
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
    }
  });

  it("leaves the public pages indexable", async () => {
    const res = await get(handler(vi.fn(async () => Response.json([]))), "/");
    expect(res.headers.get("x-robots-tag")).toBeNull();
  });
});
