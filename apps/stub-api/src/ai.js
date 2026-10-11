// The Turnstile-gated AI routes (POST /): AI writing help, lesson ideas, AI
// lesson fixes and fact checking.
//
// Nothing here is a copy of the Worker. The request goes to the Worker's own
// handler (apps/api/src/routes/ai.js), so the prompts, the fix validation, the
// fact check's Wikidata, Smithsonian and Wikipedia lookups and the response
// shapes are all the real ones. Three things are swapped out:
//
// - Turnstile: the check always passes. The app's widget is a stand-in served by
//   ./turnstile.js, so there is no challenge to verify.
// - Storage: an in-memory key-value store for the rate limiter and answer cache.
// - The model: the Worker's "openai-compatible" provider, pointed back at this
//   stub's /stub-model endpoint (handled below), which answers from a cache on
//   disk, or from `claude -p` when the stub was started with STUB_AI=claude.
//
// The disk cache is what makes demos repeatable: a first run with Claude fills
// it, and every later run replays the same answers without a model at all.

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { textCacheKey } from "@spelling-creator/api/src/lib/cache.js";
import { noopCache } from "@spelling-creator/api/src/platform/cache.js";
import {
  expiryFrom,
  isExpired,
} from "@spelling-creator/api/src/platform/kv.js";
import { handleAi } from "@spelling-creator/api/src/routes/ai.js";

// Lesson, block and section ids are random per lesson, and the fix prompt names
// blocks by id, so they are swapped for placeholders before a prompt becomes a
// cache key. A replayed answer gets this lesson's ids back.
const UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Swap each distinct id in `text` for `<id:N>`, in order of first appearance. */
export function normalizeIds(text) {
  const ids = [];
  const normal = text.replace(UUID, (id) => {
    let i = ids.indexOf(id.toLowerCase());
    if (i === -1) i = ids.push(id.toLowerCase()) - 1;
    return `<id:${i}>`;
  });
  return { normal, ids };
}

/** Put a prompt's ids back into an answer stored with placeholders. */
export function restoreIds(text, ids) {
  return text.replace(/<id:(\d+)>/g, (m, i) => ids[Number(i)] ?? m);
}

/** Store an answer with the prompt's ids as placeholders. */
function placeholderIds(text, ids) {
  return text.replace(UUID, (id) => {
    const i = ids.indexOf(id.toLowerCase());
    return i === -1 ? id : `<id:${i}>`;
  });
}

// What the model is told it is. The prompts themselves say everything else.
const SYSTEM_PROMPT =
  "You are the language model behind a web app for writing Spelling lessons. Do exactly what the prompt asks, and answer with only what it asks for.";

// How long one `claude -p` answer may take before it's given up on.
const CLAUDE_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Ask `claude -p` for one answer: plain text, or JSON matching `schema`. Runs in
 * `cwd`, a fresh temporary directory outside any project, with no tools,
 * settings or MCP servers and its own system prompt, so nothing from the repo
 * or the person's setup reaches the answer. Gives up after `timeoutMs`.
 */
export function askClaude({
  prompt,
  schema,
  model,
  cwd,
  timeoutMs = CLAUDE_TIMEOUT_MS,
}) {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--model",
    model,
    "--tools",
    "",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--system-prompt",
    SYSTEM_PROMPT,
  ];
  if (schema) args.push("--json-schema", JSON.stringify(schema));
  // Claude Code's own environment marks a nested run as a Node process.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`claude gave no answer in ${timeoutMs / 1000} seconds`));
    }, timeoutMs);
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      let data;
      try {
        data = JSON.parse(out);
      } catch {
        return reject(new Error(`claude exited ${code}: ${err || out}`));
      }
      if (data.is_error) return reject(new Error(String(data.result)));
      resolve(
        schema
          ? JSON.stringify(data.structured_output)
          : String(data.result).trim(),
      );
    });
    proc.stdin.end(prompt);
  });
}

/** The cache file name for a prompt (with its ids as placeholders) and schema. */
export function answerKey(normalPrompt, schema) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([normalPrompt, schema ?? null]))
    .digest("hex");
}

/**
 * The model behind the Worker's handler.
 *
 * @param {object} opts
 * @param {string} opts.dataDir       Answers are cached in <dataDir>/ai.
 * @param {"claude" | ""} opts.ai     "claude" asks `claude -p` on a cache miss;
 *                                    anything else only replays the cache.
 * @param {string} opts.model         Claude model alias, e.g. "sonnet".
 * @param {number} opts.replayDelayMs How long a cached answer takes, so the app's
 *                                    loading state shows as it would for real.
 * @param {Function} opts.log
 */
export function createModel({ dataDir, ai, model, replayDelayMs, log }) {
  const dir = path.join(dataDir, "ai");
  const inFlight = new Map();
  let claudeDir = "";

  return async function answer({ prompt, schema }) {
    const { normal, ids } = normalizeIds(prompt);
    const key = answerKey(normal, schema);
    const file = path.join(dir, `${key}.json`);

    if (fs.existsSync(file)) {
      const { text } = JSON.parse(fs.readFileSync(file, "utf8"));
      await new Promise((r) => setTimeout(r, replayDelayMs));
      return restoreIds(text, ids);
    }
    if (ai !== "claude") return null;

    // The Worker gives up on a model after 20 seconds, but a long answer is
    // still worth having: it is finished and cached, so asking again replays it.
    if (!inFlight.has(key)) {
      const started = Date.now();
      fs.mkdirSync(dir, { recursive: true });
      claudeDir ||= fs.mkdtempSync(path.join(os.tmpdir(), "stub-api-claude-"));
      const job = askClaude({ prompt, schema, model, cwd: claudeDir })
        .then((text) => {
          // Written whole, then moved into place, so a half-written answer is
          // never read.
          const partial = `${file}.${process.pid}.partial`;
          fs.writeFileSync(
            partial,
            JSON.stringify(
              { prompt: normal, schema, text: placeholderIds(text, ids) },
              null,
              2,
            ),
          );
          fs.renameSync(partial, file);
          log(
            `ai: answered in ${Date.now() - started} ms (${key.slice(0, 8)})`,
          );
          return text;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, job);
    }
    return inFlight.get(key);
  };
}

// An in-memory KvStore (see apps/api/src/platform/kv.js) for the rate limiter
// and the Worker's own answer cache, with the API's own expiry rules.
function memoryKv() {
  const map = new Map();
  return {
    async get(key) {
      const e = map.get(key);
      if (!e) return null;
      if (isExpired(e.expiresAt)) {
        map.delete(key);
        return null;
      }
      return e.value;
    },
    async put(key, value, opts) {
      map.set(key, { value, expiresAt: expiryFrom(opts) });
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

/**
 * Whether a saved prompt is the text suggestion for this section and lesson,
 * by the opening the Worker's text prompt has (apps/api/src/routes/ai.js):
 * the subject, then the lesson's title when it has one, and nothing about a
 * lesson when it hasn't.
 */
export function isTextPromptFor(prompt, subject, documentName) {
  const opening = `Suggest a block of text about the following subject: "${subject}".`;
  if (!prompt.startsWith(opening)) return false;
  const rest = prompt.slice(opening.length);
  const titled = "\n\nThis text is a section of a lesson titled ";
  return documentName
    ? rest.startsWith(`${titled}"${documentName}".`)
    : !rest.startsWith(titled);
}

/**
 * The AI routes.
 *
 * @param {object} opts
 * @param {() => string} opts.selfUrl  This stub's own URL, known once it listens.
 * @param {string} opts.dataDir
 * @param {"claude" | ""} [opts.ai]
 * @param {string} [opts.model]
 * @param {number} [opts.replayDelayMs]
 * @param {Function} opts.log
 * @returns {{ handle: Function, model: Function, dislike: Function }}
 */
export function createAi({
  selfUrl,
  dataDir,
  ai = "",
  model = "sonnet",
  replayDelayMs = 1200,
  log,
}) {
  const answer = createModel({ dataDir, ai, model, replayDelayMs, log });
  const env = {
    PLATFORM: {
      images: null,
      lessonGit: null,
      oauthState: null,
      rateLimit: memoryKv(),
      cache: noopCache,
      clientIp: () => "127.0.0.1",
    },
    AI_PROVIDER_ORDER: "openai-compatible",
    OPENAI_COMPATIBLE_MODELS: "stub",
    // Ask for real JSON Schema output, which `claude -p` enforces.
    OPENAI_COMPATIBLE_JSON: "schema",
    // Pixabay works when the person running the stub has a key of their own.
    PIXABAY_API_KEY: process.env.PIXABAY_API_KEY || "",
  };
  const passes = async () => ({ ok: true });
  // When the last model request had nothing to answer with, so the app can be
  // told why instead of the Worker's "Upstream AI error".
  let lastMiss = 0;

  return {
    // POST / from the app: the Worker's handler, as is.
    async handle(ctx, body) {
      const started = Date.now();
      env.OPENAI_COMPATIBLE_URL = `${selfUrl()}/stub-model/v1`;
      const request = new Request(`${selfUrl()}/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const res = await handleAi(request, env, {}, ["localhost"], {
        verify: passes,
      });
      if (res.status === 502 && lastMiss >= started) {
        return ctx.send(
          503,
          "The stub API has no saved answer for this. Start it with STUB_AI=claude to ask Claude.",
        );
      }
      ctx.send(
        res.status,
        Buffer.from(await res.arrayBuffer()),
        res.headers.get("Content-Type") || "text/plain; charset=utf-8",
      );
    },

    // POST /ai-text/dislike: the thumbs down under a text suggestion. Drops it
    // from the Worker's cache, as the real route does, and from the saved
    // answers, so the next try is newly written.
    async dislike(ctx, body) {
      const { subject = "", documentName = "" } = JSON.parse(
        body.toString() || "{}",
      );
      if (!String(subject).trim()) {
        return ctx.send(400, 'Missing "subject" in request body');
      }
      await env.PLATFORM.rateLimit.delete(
        await textCacheKey(String(subject).trim(), String(documentName)),
      );
      // The prompt has the subject and title exactly as the app sent them.
      const dir = path.join(dataDir, "ai");
      for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
        if (!name.endsWith(".json")) continue;
        const file = path.join(dir, name);
        let saved;
        try {
          saved = JSON.parse(fs.readFileSync(file, "utf8"));
        } catch {
          continue;
        }
        if (
          saved.schema == null &&
          typeof saved.prompt === "string" &&
          isTextPromptFor(saved.prompt, String(subject), String(documentName))
        ) {
          fs.rmSync(file);
          log(`ai: removed a disliked answer (${name.slice(0, 8)})`);
        }
      }
      ctx.json(200, { ok: true });
    },

    // POST /stub-model/v1/chat/completions from the Worker's provider.
    async model(ctx, body) {
      const request = JSON.parse(body.toString() || "{}");
      const prompt = request.messages?.at(-1)?.content || "";
      const schema = request.response_format?.json_schema?.schema;
      let text;
      try {
        text = await answer({ prompt, schema });
      } catch (err) {
        log(`ai: ${err.message}`);
        return ctx.send(502, "The model failed. See the stub's log.");
      }
      if (text == null) {
        lastMiss = Date.now();
        log(
          "ai: no cached answer for this request. Start the stub with STUB_AI=claude to ask Claude.",
        );
        return ctx.send(503, "No model");
      }
      ctx.json(200, { choices: [{ message: { content: text } }] });
    },
  };
}
