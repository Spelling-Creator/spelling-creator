// For the dev servers that need another one's portless address (see "Local
// URLs" in apps/docs/docs/developers/getting-started.md): the stub API and the
// stub-mode app find each other here. Every URL comes from `portless get`,
// which names a server the way `portless run` registered it, worktree prefix
// and TLD included.

import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** The names the stub pair is registered under. Keep in step with their package scripts. */
export const STUB = {
  app: "stub.spelling-creator",
  // The second origin of the stub API's /split page: an alias for the app's
  // own server (see portlessStub in apps/web/vite.config.js).
  peer: "peer.stub.spelling-creator",
  api: "api.stub.spelling-creator",
};

/** Whether this process was started by `portless run`. */
export const underPortless = () => Boolean(process.env.PORTLESS_URL);

/**
 * The URL portless serves `name` on.
 *
 * @param {string} name
 * @param {{ worktree?: boolean }} [opts]  `worktree: false` leaves out the worktree prefix.
 * @returns {Promise<string>}
 */
export async function portlessUrl(name, { worktree = true } = {}) {
  const args = ["get", name];
  if (!worktree) args.push("--no-worktree");
  const { stdout } = await run("portless", args);
  return stdout.trim();
}

/**
 * The name to register with `portless alias` so the alias answers on the same
 * hostname as `portlessUrl(name)`. An alias gets no worktree prefix of its
 * own, so the prefix has to be part of the name, while portless adds the TLD
 * itself. The TLD is whatever follows `name` when the prefix is left out.
 *
 * @param {string} name
 * @returns {Promise<string>}
 */
export async function aliasName(name) {
  const [full, bare] = await Promise.all([
    portlessUrl(name),
    portlessUrl(name, { worktree: false }),
  ]);
  const tld = new URL(bare).hostname.slice(name.length); // ".localhost"
  const host = new URL(full).hostname;
  return host.slice(0, host.length - tld.length);
}

/** Point the alias `name` at `port`, replacing an earlier one. */
export async function addAlias(name, port) {
  await run("portless", ["alias", name, String(port), "--force"]);
}

/**
 * Remove the alias `name`, if it is there. Synchronous so that it still runs
 * from a process's "exit" event.
 */
export function removeAliasSync(name) {
  try {
    execFileSync("portless", ["alias", "--remove", name], { stdio: "ignore" });
  } catch {
    // Already gone, or the proxy has been stopped.
  }
}
