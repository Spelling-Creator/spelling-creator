// check_facts: claims in, Wikidata's verdict out, with nothing else called.
//
// Wikidata is stubbed at the global fetch, which is what the shared checker
// uses when it isn't handed one. The checking itself is tested in core
// (packages/core/src/factCheck.test.js); this covers the tool's contract: that
// it reaches Wikidata politely, sorts the verdicts, and says why it dropped a
// claim.

import assert from "node:assert/strict";
import test from "node:test";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { registerTools } from "../src/tools.js";

const EVEREST = {
  item: { value: "http://www.wikidata.org/entity/Q513" },
  pid: { value: "P2044" },
  st: { value: "s1" },
  rank: { value: "http://wikiba.se/ontology#PreferredRank" },
  amount: { value: "8848.86" },
  unit: { value: "http://www.wikidata.org/entity/Q11573" },
};

test("check_facts sorts claims by verdict and says why it dropped the rest", async (t) => {
  const seen = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    seen.push({ url: String(url), userAgent: init?.headers?.["User-Agent"] });
    const { hostname } = new URL(url);
    if (hostname === "www.wikidata.org") {
      return Response.json({
        search: [
          {
            id: "Q513",
            label: "Mount Everest",
            description: "Earth's highest mountain",
          },
        ],
      });
    }
    return Response.json({ results: { bindings: [EVEREST] } });
  });

  const server = new McpServer({ name: "test", version: "0" });
  registerTools(server, {
    api: {
      getLesson() {
        throw new Error("check_facts must not call the hub");
      },
    },
    config: { apiUrl: "https://example.test" },
  });
  const client = new Client({ name: "test", version: "0" });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverT), client.connect(clientT)]);

  const result = await client.callTool({
    name: "check_facts",
    arguments: {
      claims: [
        {
          subject: "Mount Everest",
          property: "height",
          value: 8000,
          unit: "m",
          quote: "8,000 METRES",
        },
        {
          subject: "Mount Everest",
          property: "height",
          value: 29032,
          unit: "ft",
        },
        // A height in kilograms can't be checked, and nor can one in nothing.
        { subject: "Mount Everest", property: "height", value: 3, unit: "kg" },
        { subject: "Mount Everest", property: "height", value: 8849 },
      ],
    },
  });
  const body = JSON.parse(result.content[0].text);

  assert.equal(body.checked, 2);
  assert.equal(body.disagrees.length, 1);
  assert.equal(body.disagrees[0].quote, "8,000 METRES");
  assert.equal(body.disagrees[0].wikidata.value, 8848.86);
  assert.equal(body.disagrees[0].item.id, "Q513");
  assert.equal(body.agrees.length, 1);
  assert.equal(body.agrees[0].stated.unit, "ft");
  // Each dropped claim says which it was and why, in words.
  assert.deepEqual(
    body.dropped.map(({ index, reason }) => [index, reason]),
    [
      [2, "unit-wrong"],
      [3, "unit-missing"],
    ],
  );
  assert.match(body.dropped[1].note, /No unit/);

  // Wikimedia's policy: every request names itself.
  assert.ok(seen.length >= 2);
  for (const call of seen) assert.match(call.userAgent, /SpellingCreatorMCP/);

  await client.close();
  await server.close();
});
