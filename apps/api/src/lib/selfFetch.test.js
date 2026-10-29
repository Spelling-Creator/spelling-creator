// The wrapper itself, driven directly: requests to the origin being served are
// answered in-process, and nothing else is touched. Runs in both test projects,
// because both entries install it. Without it, the Worker's own-origin fetches
// fail with a 522 (src/index.js) and the Node host's fail inside a container
// (src/node/server.js). The integration half, which server-renders a lesson
// page through the Node entry, lives in src/node/selfFetch.test.js.

import { afterEach, describe, expect, it, vi } from "vitest";

import { createSelfFetch, serveSelfAt, servingSelf } from "./selfFetch.js";

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

describe("serveSelfAt", () => {
  const network = vi.fn(
    async (input) =>
      new Response(`network:${input instanceof Request ? input.url : input}`),
  );
  const fetch = createSelfFetch(network);

  afterEach(() => network.mockClear());

  // The case it exists for: the MCP tools fetch the API from a Durable Object,
  // where no request is being served, so only a standing route can catch it.
  it("answers its origin in-process with no request being served", async () => {
    const remove = serveSelfAt("https://hub.test", async (request) => {
      return new Response(`standing:${new URL(request.url).pathname}`);
    });
    try {
      expect(await (await fetch("https://hub.test/lessons")).text()).toBe(
        "standing:/lessons",
      );
      expect(network).not.toHaveBeenCalled();

      // Other origins, and the upstreams' paths on this one, still go out.
      await fetch("https://other.test/x");
      await fetch("https://hub.test/rest/v1/lessons");
      expect(network).toHaveBeenCalledTimes(2);
    } finally {
      remove();
    }
    // Removed: the network again.
    expect(await (await fetch("https://hub.test/lessons")).text()).toBe(
      "network:https://hub.test/lessons",
    );
  });

  it("serves its requests with their own context, so they can call themselves", async () => {
    // The standing handler fetches /b on its own origin while serving /a,
    // which only works if the request it serves carries a serving context.
    const remove = serveSelfAt("https://hub.test", async (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/a") return fetch("https://hub.test/b");
      return new Response("inner");
    });
    try {
      expect(await (await fetch("https://hub.test/a")).text()).toBe("inner");
      expect(network).not.toHaveBeenCalled();
    } finally {
      remove();
    }
  });

  it("gives way to the origin of the request being served", async () => {
    const remove = serveSelfAt("http://localhost:8080", async () => {
      return new Response("standing");
    });
    const handler = servingSelf(async (request) =>
      new URL(request.url).pathname === "/a"
        ? fetch("http://localhost:8080/b")
        : new Response("request"),
    );
    try {
      expect(
        await (await handler(new Request("http://localhost:8080/a"))).text(),
      ).toBe("request");
    } finally {
      remove();
    }
  });
});
