// The wrapper itself, driven directly: requests to the origin being served are
// answered in-process, and nothing else is touched. Runs in both test projects,
// because both entries install it — the Worker's own-origin fetches die as 522s
// without it (src/index.js), the Node host's inside a container (src/node/
// server.js). The integration half, which server-renders a lesson page through
// the Node entry, lives in src/node/selfFetch.test.js.

import { afterEach, describe, expect, it, vi } from "vitest";

import { createSelfFetch, servingSelf } from "./selfFetch.js";

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
