// Behind a proxy that terminates TLS, the API's absolute URLs say https.

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { withForwardedScheme } from "./forwardedScheme.js";
import { createHandler } from "./server.js";

const get = (url, headers = {}) => new Request(url, { headers });

describe("withForwardedScheme", () => {
  it("takes https from the proxy", () => {
    const request = withForwardedScheme(
      get("http://spelling.example.org/a?b=1", {
        "x-forwarded-proto": "https",
      }),
      {},
    );
    expect(request.url).toBe("https://spelling.example.org/a?b=1");
  });

  it("leaves a request alone when there is nothing to change", () => {
    const plain = get("http://spelling.example.org/");
    expect(withForwardedScheme(plain, {})).toBe(plain);
    const already = get("http://spelling.example.org/", {
      "x-forwarded-proto": "http",
    });
    expect(withForwardedScheme(already, {})).toBe(already);
  });

  it("ignores the header when nothing is in front of the process", () => {
    // Exposed directly, the caller wrote the header and could have written
    // anything.
    const request = get("http://spelling.example.org/", {
      "x-forwarded-proto": "https",
    });
    expect(withForwardedScheme(request, { TRUSTED_PROXY_COUNT: "0" }).url).toBe(
      "http://spelling.example.org/",
    );
  });

  it("believes the last entry of a list, and nothing that is not a scheme", () => {
    const listed = get("http://h.test/", {
      "x-forwarded-proto": "http, https",
    });
    expect(withForwardedScheme(listed, {}).url).toBe("https://h.test/");
    const junk = get("http://h.test/", { "x-forwarded-proto": "gopher" });
    expect(withForwardedScheme(junk, {}).url).toBe("http://h.test/");
  });

  it("keeps the method, headers and a streamed body", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("lesson bytes"));
        controller.close();
      },
    });
    const upload = new Request("http://h.test/images", {
      method: "PUT",
      headers: { "x-forwarded-proto": "https", "content-type": "image/png" },
      body,
      duplex: "half",
    });
    const forwarded = withForwardedScheme(upload, {});
    expect(forwarded.url).toBe("https://h.test/images");
    expect(forwarded.method).toBe("PUT");
    expect(forwarded.headers.get("content-type")).toBe("image/png");
    expect(await forwarded.text()).toBe("lesson bytes");
  });
});

describe("createHandler", () => {
  let root;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "spelling-scheme-"));
    await writeFile(join(root, "index.html"), "<!doctype html><head></head>");
  });

  const robots = async (env, headers) =>
    (
      await createHandler({ WEB_DIST: root, ...env })(
        get("http://spelling.example.org/robots.txt", headers),
      )
    ).text();

  it("builds absolute URLs with the scheme the browser used", async () => {
    expect(await robots({}, { "x-forwarded-proto": "https" })).toContain(
      "Sitemap: https://spelling.example.org/sitemap.xml",
    );
  });

  it("stays on http without a trusted proxy to say otherwise", async () => {
    expect(
      await robots(
        { TRUSTED_PROXY_COUNT: "0" },
        { "x-forwarded-proto": "https" },
      ),
    ).toContain("Sitemap: http://spelling.example.org/sitemap.xml");
  });
});
