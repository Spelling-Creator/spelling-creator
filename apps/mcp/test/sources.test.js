// The lesson's sources through the writing tools, and the formatting checks'
// promise that a person's own formatting never blocks an assistant's edit.

import assert from "node:assert/strict";
import test from "node:test";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { buildDoc } from "@spelling-creator/core/lessonBuild";
import { applyPatch } from "@spelling-creator/core/lessonPatch";
import { registerTools, SERVER_INFO } from "../src/tools.js";
import { newFindings, validateLesson } from "../src/validate.js";
import { fakeHub } from "./fake-hub.js";

async function connect(api) {
  const server = new McpServer(SERVER_INFO);
  registerTools(server, { api, config: { apiUrl: "https://example.test" } });
  const client = new Client({ name: "test", version: "0" });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return {
    async call(name, args) {
      const res = await client.callTool({ name, arguments: args });
      return {
        error: res.isError ? res.content[0].text : null,
        text: res.content[0].text,
      };
    },
    close: () => Promise.all([client.close(), server.close()]),
  };
}

// Sources as the web editor may store them: an empty row someone added and
// never filled in, and a link typed without its scheme.
const EDITOR_SOURCES = [
  { id: "a1", title: "", author: "", publisher: "", year: "", url: "" },
  {
    id: "b2",
    title: "Cats",
    author: "",
    publisher: "",
    year: "",
    url: "example.com",
  },
];

async function seed(hub) {
  return hub.api.createLesson({
    title: "Cats",
    doc: {
      title: "Cats",
      sources: EDITOR_SOURCES,
      sections: [
        {
          id: "s1",
          name: "One",
          blocks: [{ id: "t1", type: "text", text: "Cats purr." }],
        },
      ],
    },
  });
}

const SECTIONS = [
  { name: "One", blocks: [{ type: "text", text: "Cats purr loudly." }] },
];

test("update_lesson keeps stored sources when `sources` is left out, even half-filled ones", async () => {
  const hub = fakeHub();
  const lesson = await seed(hub);
  const mcp = await connect(hub.api);
  const res = await mcp.call("update_lesson", {
    id: lesson.id,
    title: "Cats",
    sections: SECTIONS,
    skipValidation: true,
  });
  assert.equal(res.error, null);
  assert.deepEqual(
    (await hub.api.getLesson(lesson.id)).doc.sources,
    EDITOR_SOURCES,
  );
  await mcp.close();
});

test("update_lesson accepts the sources get_lesson returned, passed back unchanged", async () => {
  const hub = fakeHub();
  const lesson = await seed(hub);
  const mcp = await connect(hub.api);
  const read = JSON.parse(
    (await mcp.call("get_lesson", { id: lesson.id })).text,
  );
  const res = await mcp.call("update_lesson", {
    id: lesson.id,
    title: "Cats",
    sections: SECTIONS,
    sources: read.doc.sources,
    skipValidation: true,
  });
  assert.equal(res.error, null);
  assert.deepEqual(
    (await hub.api.getLesson(lesson.id)).doc.sources,
    EDITOR_SOURCES,
  );
  await mcp.close();
});

test("a changed source is still checked", () => {
  assert.throws(
    () =>
      buildDoc(
        {
          title: "t",
          sections: SECTIONS,
          sources: [{ id: "b2", title: "Cats", url: "example.org" }],
        },
        { existingSources: EDITOR_SOURCES },
      ),
    /url/,
  );
});

test("update_lesson refuses to write when it can't read the sources it was told to keep", async () => {
  const hub = fakeHub();
  const lesson = await seed(hub);
  const flaky = {
    ...hub.api,
    getLesson: async () => Promise.reject(new Error("503")),
  };
  const mcp = await connect(flaky);
  const res = await mcp.call("update_lesson", {
    id: lesson.id,
    title: "Cats",
    sections: SECTIONS,
    skipValidation: true,
  });
  assert.match(res.error, /Couldn't read the lesson to keep its sources/);
  assert.deepEqual(
    (await hub.api.getLesson(lesson.id)).doc.sources,
    EDITOR_SOURCES,
  );
  assert.equal(
    (await hub.api.getLesson(lesson.id)).doc.sections[0].blocks[0].text,
    "Cats purr.",
  );
  await mcp.close();
});

test("rewording a section a person formatted heavily is not held against the edit", () => {
  const formatted =
    "Read *Whiskers*, *Paws*, *Tails* and *Purrs*, four books about cats. Cats nap a lot.";
  const before = buildDoc({
    title: "t",
    sections: [
      {
        name: "One",
        blocks: [
          { type: "text", text: formatted },
          { type: "text", text: "A second paragraph." },
        ],
      },
    ],
  });
  assert.ok(
    validateLesson(before).errors.some((e) => e.code === "E_FORMAT_HEAVY"),
  );

  const [first, second] = before.sections[0].blocks;
  const reworded = applyPatch(before, [
    {
      op: "replace_block",
      blockId: first.id,
      block: { type: "text", text: formatted.replace("nap", "sleep") },
    },
    {
      op: "replace_block",
      blockId: second.id,
      block: { type: "text", text: "A different second paragraph." },
    },
  ]);
  const fresh = (doc) =>
    newFindings(validateLesson(before).errors, validateLesson(doc).errors).map(
      (e) => e.code,
    );
  assert.deepEqual(fresh(reworded), []);

  // Adding formatting to that section is the edit's own doing.
  const more = applyPatch(before, [
    {
      op: "replace_block",
      blockId: second.id,
      block: { type: "text", text: "A *fifth* title." },
    },
  ]);
  assert.ok(fresh(more).includes("E_FORMAT_HEAVY"));
});
