// The share code in a letterboard session path (parsePracticeCode in practice.js).
//
// The code is the only thing that identifies a session, so the parse has to hold
// it to the collaboration rule, and to fold case: the Practice page shows a code
// in capitals and a partner typing it on a tablet may not.

import { describe, expect, it } from "vitest";

import {
  handlePractice,
  handlePracticeInfo,
  parsePracticeCode,
} from "./practice.js";

// An env with an injected platform (see platform/index.js) and a room namespace
// that records what reached it instead of running a Durable Object.
function fakeEnv({ ip }) {
  const rows = new Map();
  const reached = [];
  return {
    reached,
    env: {
      PLATFORM: {
        rateLimit: {
          get: async (k) => rows.get(k) ?? null,
          put: async (k, v) => void rows.set(k, v),
        },
        clientIp: () => ip,
      },
      PRACTICE_ROOM: {
        idFromName: (name) => name,
        get: (id) => ({
          fetch: async (request) => {
            reached.push({
              id,
              url: request.url,
              role: request.headers.get("X-Practice-Role"),
            });
            return new Response(null, { status: 204 });
          },
        }),
      },
    },
  };
}

const upgrade = (path, headers = {}) => {
  const url = new URL(`https://hub.test${path}`);
  return [
    new Request(url, { headers: { Upgrade: "websocket", ...headers } }),
    url,
  ];
};

describe("handlePractice, for a board", () => {
  it("refuses a board whose address is unknown instead of sharing one bucket", async () => {
    const { env, reached } = fakeEnv({ ip: "" });
    const [request, url] = upgrade("/practice/k7pm2x");
    const res = await handlePractice(request, env, url, {});
    expect(res.status).toBe(400);
    expect(reached).toEqual([]);
  });

  it("forwards a board as a board, to the room for the code in capitals", async () => {
    const { env, reached } = fakeEnv({ ip: "203.0.113.7" });
    // A claimed role and a stray query are the client's, and neither survives.
    const [request, url] = upgrade("/practice/k7pm2x?token=x", {
      "X-Practice-Role": "host",
    });
    expect((await handlePractice(request, env, url, {})).status).toBe(204);
    expect(reached).toEqual([
      { id: "K7PM2X", url: "https://hub.test/practice/K7PM2X", role: "board" },
    ]);
  });
});

describe("handlePracticeInfo", () => {
  it("says whether this hub can host letterboard sessions", async () => {
    expect(await handlePracticeInfo({ PRACTICE_ROOM: {} }, {}).json()).toEqual({
      available: true,
    });
    expect(await handlePracticeInfo({}, {}).json()).toEqual({
      available: false,
    });
  });
});

describe("parsePracticeCode", () => {
  it("reads the code from the session path, in capitals", () => {
    expect(parsePracticeCode("/practice/K7PM2X")).toBe("K7PM2X");
    expect(parsePracticeCode("/practice/k7pm2x")).toBe("K7PM2X");
    expect(parsePracticeCode("/practice/k7pm2x/")).toBe("K7PM2X");
  });

  it("is only the session path", () => {
    expect(parsePracticeCode("/practice")).toBeNull();
    expect(parsePracticeCode("/practice/")).toBeNull();
    expect(parsePracticeCode("/practice/abc/agent")).toBeNull();
    expect(parsePracticeCode("/collab/abc")).toBeNull();
  });

  it("holds the code to the characters the collaboration path allows", () => {
    expect(parsePracticeCode("/practice/has%20space")).toBeNull();
    expect(parsePracticeCode("/practice/%E2%9C%93")).toBeNull();
    expect(parsePracticeCode(`/practice/${"a".repeat(129)}`)).toBeNull();
    expect(parsePracticeCode("/practice/%ZZ")).toBeNull();
  });
});
