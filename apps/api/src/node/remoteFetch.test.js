// The connect-time address check that stops DNS rebinding. It is tested on its
// own rather than through a fetch, because the cases worth having (a name that
// resolves to a private address) are about what DNS answers, and `localhost`
// and literal addresses give those answers without a network.

import { describe, expect, it } from "vitest";

import { publicOnlyLookup } from "./remoteFetch.js";

const resolve = (hostname, options = {}) =>
  new Promise((ok, fail) => {
    publicOnlyLookup(hostname, options, (error, address, family) =>
      error ? fail(error) : ok({ address, family }),
    );
  });

describe("publicOnlyLookup", () => {
  it("refuses a name that resolves to a loopback address", async () => {
    await expect(resolve("localhost")).rejects.toMatchObject({
      code: "EPRIVATE",
    });
  });

  it("refuses private and loopback addresses however they are written", async () => {
    for (const host of [
      "127.0.0.1",
      "10.0.0.5",
      "192.168.5.129",
      "169.254.169.254",
      "::1",
    ]) {
      await expect(resolve(host), host).rejects.toMatchObject({
        code: "EPRIVATE",
      });
    }
  });

  it("answers a public address, in the shape the caller asked for", async () => {
    expect(await resolve("1.1.1.1")).toEqual({ address: "1.1.1.1", family: 4 });
    const all = await new Promise((ok, fail) =>
      publicOnlyLookup("1.1.1.1", { all: true }, (e, list) =>
        e ? fail(e) : ok(list),
      ),
    );
    expect(all).toEqual([{ address: "1.1.1.1", family: 4 }]);
  });
});
