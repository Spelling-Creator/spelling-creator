// An in-memory filesystem for the git engine, for the hosts that have no other.
//
// repo.ts and pack.ts take `{ fs, gitdir }` precisely so they don't care where
// the objects live: the browser hands them LightningFS over IndexedDB (see
// browser/git/fs.ts), and everywhere else hands them this. "Everywhere else" is
// the MCP server (apps/mcp), which forks a lesson and opens a pull request on an
// assistant's behalf — in Node when it runs over stdio, and inside the Cloudflare
// Worker when it runs remotely. Neither has a disk, and the Worker can't have
// one, so the repository is built, used and thrown away in memory.
//
// That fits what a non-browser caller actually does. It never keeps a working
// copy: it clones a lesson's packed history, commits once on top, packs the
// result back up and uploads it. The repository's durable home is R2 (the
// lesson's stored pack), so nothing is lost when this is garbage collected —
// which is why there is no persistence here and no cache to invalidate.
//
// This implements the subset of node:fs's promise API that isomorphic-git binds
// on construction, with POSIX error codes, because isomorphic-git reads `.code`
// to tell "not there" from "broken" (a missing file must be ENOENT, or a first
// commit looks like a failure rather than an empty repo).
//
// One departure from a real filesystem: file contents are stored and returned by
// reference, not copied. A real fs copies through the kernel, so a caller may
// safely mutate a buffer it wrote or one it read back. Here that would alias.
// Nothing does it — the git engine treats both as immutable — and a packfile runs
// to megabytes, so copying every blob and pack twice per operation would be a
// real cost against a hypothetical caller. Anything else sharing this module must
// keep to the same rule.

import type { PromiseFsClient } from "isomorphic-git";
import type { GitContext } from "./repo.ts";

/** File mode for a regular file, as git and node:fs report it. */
const FILE_MODE = 0o100644;
/** File mode for a directory. */
const DIR_MODE = 0o40755;
/** File mode for a symbolic link. */
const SYMLINK_MODE = 0o120777;

/** What a node holds, before put() stamps it with an inode and a time. */
type NodeBody =
  | { type: "file"; data: Uint8Array; mode: number }
  | { type: "dir"; mode: number }
  | { type: "symlink"; target: string; mode: number };

type FsNode = NodeBody & { ino: number; mtimeMs: number };

/** What `stat` and `lstat` report: the fields isomorphic-git reads. */
export interface MemStats {
  type: "file" | "dir";
  mode: number;
  size: number;
  ino: number;
  dev: number;
  uid: number;
  gid: number;
  mtimeMs: number;
  ctimeMs: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

/** The node:fs promise methods memFs implements. */
export interface MemFsPromises {
  readFile(
    path: string,
    options?: string | { encoding?: string | null } | null,
  ): Promise<Uint8Array | string | undefined>;
  writeFile(
    path: string,
    data: string | ArrayBuffer | ArrayBufferView,
    options?: string | { mode?: number } | null,
  ): Promise<void>;
  unlink(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  mkdir(path: string, options?: { recursive?: boolean } | null): Promise<void>;
  rmdir(path: string): Promise<void>;
  stat(path: string): Promise<MemStats>;
  lstat(path: string): Promise<MemStats>;
  readlink(path: string): Promise<string>;
  symlink(target: string, path: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
}

/** An in-memory filesystem, in the promise style isomorphic-git takes. */
export interface MemFs extends PromiseFsClient {
  promises: MemFsPromises;
}

/** A repository context on an in-memory filesystem. */
export interface MemRepo extends GitContext {
  fs: MemFs;
}

/** A POSIX-shaped error, so isomorphic-git's `err.code` checks work. */
function fsError(code: string, path: string, syscall: string) {
  return Object.assign(new Error(`${code}: ${syscall} '${path}'`), {
    code,
    errno: -1,
    path,
    syscall,
  });
}

/**
 * Resolve a path to a canonical absolute one: no empty segments, no "." and no
 * "..". Everything is keyed by the result, so "/a/b", "/a//b" and "/a/./b" are
 * the same node.
 */
function normalize(path: string) {
  const parts: string[] = [];
  for (const part of String(path).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function dirname(path: string) {
  const at = path.lastIndexOf("/");
  return at <= 0 ? "/" : path.slice(0, at);
}

/** Coerce whatever a caller wrote to bytes. isomorphic-git writes both. */
function toBytes(data: unknown): Uint8Array {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new TypeError("Unsupported data passed to writeFile.");
}

/** The encoding out of node:fs's `options`, which may be a bare string. */
function encodingOf(
  options: string | { encoding?: string | null } | null | undefined,
) {
  if (typeof options === "string") return options;
  return options?.encoding || null;
}

/**
 * A fresh in-memory filesystem, shaped like `node:fs` — pass it straight to any
 * `{ fs, gitdir }` function in repo.ts / pack.ts.
 *
 * Nothing is shared between calls: each one is its own empty volume, with its
 * own root. Two repositories built in the same process therefore cannot see each
 * other, which is what we want when one request forks a lesson while another is
 * merging one.
 *
 * @returns An fs whose `promises` is an own data property, because
 *          isomorphic-git detects the promise API with
 *          `Object.getOwnPropertyDescriptor(fs, 'promises')`, so a getter or an
 *          inherited property would silently drop it back to callback style.
 */
export function memFs(): MemFs {
  // path -> { type, data?, target?, mode, mtimeMs, ino }
  const nodes = new Map<string, FsNode>();
  let nextIno = 1;

  const now = () => Date.now();

  // Overwriting keeps the inode: on a real filesystem rewriting a file in place
  // doesn't make it a different file, and isomorphic-git's index caching reads
  // stat data to decide what it can trust.
  function put(path: string, node: NodeBody) {
    const existing = nodes.get(path);
    nodes.set(path, {
      ino: existing ? existing.ino : nextIno++,
      mtimeMs: now(),
      ...node,
    });
  }

  put("/", { type: "dir", mode: DIR_MODE });

  function lookup(path: string, syscall: string) {
    const node = nodes.get(path);
    if (!node) throw fsError("ENOENT", path, syscall);
    return node;
  }

  /** The parent must exist and be a directory before anything can be made in it. */
  function requireParentDir(path: string, syscall: string) {
    const parent = nodes.get(dirname(path));
    if (!parent) throw fsError("ENOENT", path, syscall);
    if (parent.type !== "dir") throw fsError("ENOTDIR", path, syscall);
  }

  function statsOf(node: FsNode): MemStats {
    const size = node.type === "file" ? node.data.byteLength : 0;
    return {
      type: node.type === "dir" ? "dir" : "file",
      mode: node.mode,
      size,
      ino: node.ino,
      dev: 1,
      uid: 1,
      gid: 1,
      mtimeMs: node.mtimeMs,
      ctimeMs: node.mtimeMs,
      isFile: () => node.type === "file",
      isDirectory: () => node.type === "dir",
      isSymbolicLink: () => node.type === "symlink",
    };
  }

  const promises: MemFsPromises = {
    async readFile(path, options) {
      const full = normalize(path);
      const node = lookup(full, "open");
      if (node.type === "dir") throw fsError("EISDIR", full, "read");
      // A symlink has no bytes of its own, and readFile does not follow it.
      const data = node.type === "file" ? node.data : undefined;
      const encoding = encodingOf(options);
      if (encoding) return new TextDecoder().decode(data);
      return data;
    },

    async writeFile(path, data, options) {
      const full = normalize(path);
      requireParentDir(full, "open");
      const existing = nodes.get(full);
      if (existing && existing.type === "dir") {
        throw fsError("EISDIR", full, "open");
      }
      // A string `options` is an encoding, which carries no mode.
      const mode = typeof options === "object" ? options?.mode : undefined;
      put(full, {
        type: "file",
        data: toBytes(data),
        mode: mode ?? existing?.mode ?? FILE_MODE,
      });
    },

    async unlink(path) {
      const full = normalize(path);
      const node = lookup(full, "unlink");
      if (node.type === "dir") throw fsError("EISDIR", full, "unlink");
      nodes.delete(full);
    },

    async readdir(path) {
      const full = normalize(path);
      const node = lookup(full, "scandir");
      if (node.type !== "dir") throw fsError("ENOTDIR", full, "scandir");

      // Direct children only: every descendant shares the prefix, so a name with
      // a "/" left in it belongs to a deeper directory.
      const prefix = full === "/" ? "/" : `${full}/`;
      const names: string[] = [];
      for (const key of nodes.keys()) {
        if (key === full || !key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (rest && !rest.includes("/")) names.push(rest);
      }
      return names.sort();
    },

    async mkdir(path, options) {
      const full = normalize(path);
      if (options?.recursive) {
        // node:fs makes every missing ancestor and treats an existing directory
        // as success, rather than EEXIST.
        let current = "";
        for (const part of full.split("/").filter(Boolean)) {
          current += `/${part}`;
          const existing = nodes.get(current);
          if (existing) {
            if (existing.type !== "dir")
              throw fsError("ENOTDIR", full, "mkdir");
            continue;
          }
          put(current, { type: "dir", mode: DIR_MODE });
        }
        return;
      }
      if (nodes.has(full)) throw fsError("EEXIST", full, "mkdir");
      requireParentDir(full, "mkdir");
      put(full, { type: "dir", mode: DIR_MODE });
    },

    async rmdir(path) {
      const full = normalize(path);
      const node = lookup(full, "rmdir");
      if (node.type !== "dir") throw fsError("ENOTDIR", full, "rmdir");
      const prefix = `${full}/`;
      for (const key of nodes.keys()) {
        if (key.startsWith(prefix)) throw fsError("ENOTEMPTY", full, "rmdir");
      }
      if (full === "/") throw fsError("EBUSY", full, "rmdir");
      nodes.delete(full);
    },

    async stat(path) {
      const full = normalize(path);
      // Resolve the link, which is the whole difference between stat and lstat.
      const node = lookup(full, "stat");
      if (node.type === "symlink") {
        return statsOf(lookup(normalize(node.target), "stat"));
      }
      return statsOf(node);
    },

    async lstat(path) {
      return statsOf(lookup(normalize(path), "lstat"));
    },

    async readlink(path) {
      const full = normalize(path);
      const node = lookup(full, "readlink");
      if (node.type !== "symlink") throw fsError("EINVAL", full, "readlink");
      return node.target;
    },

    async symlink(target, path) {
      const full = normalize(path);
      requireParentDir(full, "symlink");
      if (nodes.has(full)) throw fsError("EEXIST", full, "symlink");
      put(full, {
        type: "symlink",
        target: String(target),
        mode: SYMLINK_MODE,
      });
    },

    async chmod(path, mode) {
      const full = normalize(path);
      const node = lookup(full, "chmod");
      node.mode = mode;
    },
  };

  // A plain own data property, not a getter — see the return doc above.
  return { promises };
}

/**
 * A brand-new empty repository context, ready for `cloneFromPack` or `commitDoc`.
 *
 * The gitdir path is arbitrary (nothing else lives on this volume) but named for
 * what it holds, so a stack trace from isomorphic-git reads sensibly.
 *
 * @returns The context every function in repo.ts / pack.ts takes.
 */
export function memRepo(name = "lesson"): MemRepo {
  return { fs: memFs(), gitdir: `/${name}/.git` };
}
