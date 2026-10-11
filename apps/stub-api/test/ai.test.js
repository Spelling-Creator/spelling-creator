import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startStub } from "../src/server.js";
import { tokenFor } from "../src/sessions.js";
import { answerKey, createModel, normalizeIds, restoreIds } from "../src/ai.js";

const fixtures = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

const A = "3626ef89-0e27-4a31-afbc-425e21eb131e";
const B = "8b0f6c2e-5d1a-4c3b-9e7f-1a2b3c4d5e6f";
const C = "11111111-2222-4333-8444-555555555555";
const D = "66666666-7777-4888-9999-aaaaaaaaaaaa";

describe("ids in prompts", () => {
  it("swaps each distinct id for a placeholder, in order", () => {
    const { normal, ids } = normalizeIds(`${A} then ${B} then ${A}`);
    expect(normal).toBe("<id:0> then <id:1> then <id:0>");
    expect(ids).toEqual([A, B]);
    expect(restoreIds(normal, ids)).toBe(`${A} then ${B} then ${A}`);
  });

  it("replays a saved answer with this prompt's ids", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stub-ai-"));
    const schema = { type: "object" };
    const { normal } = normalizeIds(`Fix block ${A} in section ${B}.`);
    fs.mkdirSync(path.join(dataDir, "ai"));
    fs.writeFileSync(
      path.join(dataDir, "ai", `${answerKey(normal, schema)}.json`),
      JSON.stringify({ text: '{"blockId":"<id:0>"}' }),
    );
    const answer = createModel({
      dataDir,
      ai: "",
      model: "sonnet",
      replayDelayMs: 0,
      log: () => {},
    });
    // The same lesson made again has new ids; the answer follows them.
    expect(
      await answer({ prompt: `Fix block ${C} in section ${D}.`, schema }),
    ).toBe(`{"blockId":"${C}"}`);
    // Without a saved answer, and without Claude, there is nothing to say.
    expect(await answer({ prompt: "Something new.", schema })).toBeNull();
  });
});

describe("AI routes", () => {
  let stub;
  let dataDir;
  beforeAll(async () => {
    // A copy of the fixtures, so nothing is ever saved into them.
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stub-ai-"));
    fs.cpSync(fixtures, dataDir, { recursive: true });
    stub = await startStub({ port: 0, dataDir, aiReplayDelayMs: 0 });
  });
  afterAll(() => stub.close());

  it("serves a stand-in Turnstile script", async () => {
    const res = await fetch(`${stub.url}/turnstile/v0/api.js`);
    expect(res.headers.get("content-type")).toMatch(/javascript/);
    const script = await res.text();
    expect(script).toContain("window.turnstile");
    expect(script).toContain("Success!");
  });

  it("says how to get an answer when none is saved", async () => {
    const res = await fetch(`${stub.url}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: "Penguins", token: "anything" }),
    });
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/STUB_AI=claude/);
  });

  it("answers from a saved model answer through the Worker's handler", async () => {
    // Save an answer for whatever prompt the Worker builds, by catching it.
    const seen = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).includes("/stub-model/")) {
        seen.push(JSON.parse(init.body));
      }
      return original(url, init);
    };
    try {
      await original(`${stub.url}/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "lessonIdea", ageRange: "", token: "x" }),
      });
    } finally {
      globalThis.fetch = original;
    }
    const request = seen[0];
    const prompt = request.messages.at(-1).content;
    const schema = request.response_format.json_schema.schema;
    fs.mkdirSync(path.join(dataDir, "ai"), { recursive: true });
    fs.writeFileSync(
      path.join(
        dataDir,
        "ai",
        `${answerKey(normalizeIds(prompt).normal, schema)}.json`,
      ),
      JSON.stringify({
        text: JSON.stringify({
          ideas: [
            { title: "Tides", description: "Why the sea comes and goes." },
          ],
        }),
      }),
    );
    const res = await fetch(`${stub.url}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "lessonIdea", ageRange: "", token: "x" }),
    });
    expect(await res.json()).toEqual({
      ideas: [{ title: "Tides", description: "Why the sea comes and goes." }],
    });
  });

  it("forgets a disliked text suggestion, for someone signed in", async () => {
    const file = path.join(dataDir, "ai", "disliked.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        prompt: 'About "Huddles". A lesson titled "Penguins".',
        schema: null,
        text: "Penguins huddle.",
      }),
    );
    const dislike = (headers) =>
      fetch(`${stub.url}/ai-text/dislike`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ subject: "Huddles", documentName: "Penguins" }),
      });
    expect((await dislike({})).status).toBe(401);
    expect(fs.existsSync(file)).toBe(true);
    const res = await dislike({ Authorization: `Bearer ${tokenFor("maya")}` });
    expect(await res.json()).toEqual({ ok: true });
    expect(fs.existsSync(file)).toBe(false);
  });
});
