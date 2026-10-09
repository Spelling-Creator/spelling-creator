// One structured-output call to Claude through the Claude Code CLI
// (`claude -p`), so the experiment runs on a Claude subscription with no API
// key. No tools, no MCP servers, no settings files, and run outside the repo
// so no project instructions ride along: the prompt is the whole input.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

// An empty folder (gitignored) to run in, so no CLAUDE.md is picked up.
const CWD = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  ".cache",
  "claude",
);

/**
 * @param {string} prompt
 * @param {{ model: string, system: string, schema: object }} opts
 * @returns {Promise<object>} the reply, matching `schema`
 */
export function askClaude(prompt, { model, system, schema }) {
  mkdirSync(CWD, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(
      "claude",
      [
        "-p",
        "--model",
        model,
        "--tools",
        "",
        "--strict-mcp-config",
        "--setting-sources",
        "",
        "--no-session-persistence",
        "--system-prompt",
        system,
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(schema),
      ],
      { cwd: CWD, stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        const result = JSON.parse(out);
        if (code !== 0 || result.is_error || !result.structured_output) {
          throw new Error(result.result || err || `exit ${code}`);
        }
        resolve(result.structured_output);
      } catch (e) {
        reject(new Error(`claude -p failed: ${e.message}`));
      }
    });
    child.stdin.end(prompt);
  });
}
