import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Run `fn` with a fresh temporary directory, removed afterwards. */
export async function withTempDir<T>(
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "spelling-creator-cli-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Write a file into `dir` and return its path. */
export async function writeTemp(
  dir: string,
  name: string,
  contents: string | Buffer,
): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, contents);
  return path;
}
