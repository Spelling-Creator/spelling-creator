// The editor's version history controller, against the real git plumbing on
// an in-memory filesystem. Only the engine's whereabouts (where a lesson's
// repository lives, and the draft adoption that LightningFS does by copying)
// are stood in for; every commit, branch and diff is the real thing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureCore } from "../../config.ts";
import { memFs } from "../../git/memfs.ts";
import { cloneFromPack } from "../../git/pack.ts";
import { toBranchName } from "../../git/refs.ts";
import * as repo from "../../git/repo.ts";
import type { LessonDoc } from "../../types.ts";
import type { CoAuthors } from "../collabSession.ts";
import {
  createLessonHistory,
  type LessonHistory,
  type LessonHistoryEngine,
} from "./lessonHistory.ts";

// ---- the engine ---------------------------------------------------------------

function testEngine() {
  const fs = memFs();
  const gitdirOf = (id: string) => `/${id}`;
  const exists = async (path: string) => {
    try {
      await fs.promises.stat(path);
      return true;
    } catch {
      return false;
    }
  };
  async function removeDir(path: string) {
    if (!(await exists(path))) return;
    for (const name of await fs.promises.readdir(path)) {
      const child = `${path}/${name}`;
      const stat = await fs.promises.stat(child);
      if (stat.isDirectory()) await removeDir(child);
      else await fs.promises.unlink(child);
    }
    await fs.promises.rmdir(path);
  }
  const adoptDraftRepo = vi.fn(
    async (_lessonId?: string | null, _draftRepoId?: string | null) => {},
  );
  const engine: LessonHistoryEngine = {
    ...repo,
    cloneFromPack,
    repoCtx: (id) => ({ fs, gitdir: gitdirOf(id) }),
    repoExists: (id) => exists(`${gitdirOf(id)}/config`),
    deleteRepo: (id) => removeDir(gitdirOf(id)),
    adoptDraftRepo,
  };
  return { fs, engine, adoptDraftRepo };
}

// ---- documents ------------------------------------------------------------------

const DOC = {
  title: "Rivers",
  sections: [
    {
      id: "s1",
      name: "One",
      blocks: [{ id: "b1", type: "text", text: "A river." }],
    },
  ],
} as unknown as LessonDoc;

const withText = (text: string): LessonDoc =>
  ({
    ...DOC,
    sections: [
      { ...DOC.sections[0], blocks: [{ id: "b1", type: "text", text }] },
    ],
  }) as unknown as LessonDoc;

// ---- the harness ----------------------------------------------------------------

/** A co-author list with one person waiting for credit. */
function coAuthorsWith(
  name: string,
  uid: string,
): CoAuthors & {
  cleared: unknown[];
  discard: ReturnType<typeof vi.fn>;
} {
  let seq = 1;
  const cleared: unknown[] = [];
  return {
    cleared,
    peek: () => [{ uid, name, seq }],
    clear: (credited) => {
      cleared.push(credited);
      seq += 1;
    },
    discard: vi.fn(),
  };
}

/** Everything queued so far has run. */
const drain = (history: LessonHistory) => history.run(async () => {});

function controller(
  engine: LessonHistoryEngine,
  extra: Partial<Parameters<typeof createLessonHistory>[0]> = {},
) {
  return createLessonHistory({
    loadEngine: async () => engine,
    doc: DOC,
    identity: { uid: "u1", name: "Alex" },
    ...extra,
  });
}

async function opened(engine: LessonHistoryEngine, localId = "l1") {
  const history = controller(engine);
  history.open({ localId });
  await drain(history);
  return history;
}

beforeEach(() => {
  configureCore({ apiUrl: "" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---- tests ------------------------------------------------------------------------

describe("opening a lesson's history", () => {
  it("gives a local lesson a repository seeded with the document", async () => {
    const { engine } = testEngine();
    const history = await opened(engine);

    expect(history.getSnapshot()).toMatchObject({
      repoId: "l1",
      ready: true,
      pending: 0,
      error: null,
      branch: "main",
    });
    expect(history.getSnapshot().lastCommit?.oid).toMatch(/^[0-9a-f]{40}$/);
    expect(history.getSnapshot().branches.map((b) => b.name)).toEqual(["main"]);

    const entries = await history.loadHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      summary: "Start the lesson",
      author: "Alex",
    });
    expect(await engine.repoExists("l1")).toBe(true);
  });

  it("opens the repository it already has, and starts over on another lesson", async () => {
    const { engine } = testEngine();
    const coAuthors = coAuthorsWith("Sam", "u2");
    const history = controller(engine, { coAuthors });
    history.open({ localId: "l1" });
    await drain(history);
    const first = history.getSnapshot().lastCommit?.oid;

    // The same lesson again is nothing.
    const listener = vi.fn();
    history.subscribe(listener);
    history.open({ localId: "l1" });
    expect(listener).not.toHaveBeenCalled();

    // Another lesson: its own repository, and whatever credit was pending
    // belongs to the one being left.
    history.setDoc(withText("Another lesson's words."));
    history.open({ localId: "l2" });
    expect(coAuthors.discard).toHaveBeenCalled();
    expect(history.getSnapshot()).toMatchObject({ repoId: "l2", ready: false });
    await drain(history);
    expect(history.getSnapshot()).toMatchObject({ repoId: "l2", ready: true });
    expect(history.getSnapshot().lastCommit?.oid).not.toBe(first);

    // Back to the first: its timeline is still there.
    history.open({ localId: "l1" });
    await drain(history);
    expect(history.getSnapshot().lastCommit?.oid).toBe(first);
    expect(await history.loadHistory()).toHaveLength(1);
  });

  it("starts a published lesson empty when the hub has no history for it", async () => {
    configureCore({ apiUrl: "https://api.example.test" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 404, ok: false })),
    );
    const { engine } = testEngine();
    const history = controller(engine);
    history.open({ editingId: "pub-1", localId: "l1" });
    await drain(history);
    expect(history.getSnapshot()).toMatchObject({
      repoId: "pub-1",
      ready: true,
    });
    expect(await engine.repoExists("pub-1")).toBe(true);
  });

  it("leaves nothing behind when the published history can't be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    configureCore({ apiUrl: "https://api.example.test" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    const { engine } = testEngine();
    const history = controller(engine);
    history.open({ editingId: "pub-1", localId: "l1" });
    await drain(history);

    expect(history.getSnapshot()).toMatchObject({
      ready: false,
      error: "Could not reach the lesson history.",
    });
    expect(await engine.repoExists("pub-1")).toBe(false);

    // Nothing may be written there meanwhile, or the clone is never retried.
    history.setDoc(withText("typed while offline"));
    expect(await history.commitNow()).toBeNull();
    expect(await engine.repoExists("pub-1")).toBe(false);
  });

  it("rebuilds a repository whose head can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { engine, fs } = testEngine();
    const history = await opened(engine);
    const head = history.getSnapshot().lastCommit!.oid;

    // A torn write: the branch points at a commit whose object never landed.
    await fs.promises.unlink(
      `/l1/objects/${head.slice(0, 2)}/${head.slice(2)}`,
    );
    history.close();
    history.setDoc(withText("as it stands after the reload"));
    history.open({ localId: "l1" });
    await drain(history);

    // Started again, from the document as it is now.
    expect(history.getSnapshot()).toMatchObject({ ready: true, error: null });
    const rebuilt = history.getSnapshot().lastCommit!.oid;
    expect(rebuilt).not.toBe(head);
    expect(await history.loadHistory()).toHaveLength(1);
    expect(
      await engine.readDocAt({ ...engine.repoCtx("l1"), oid: rebuilt }),
    ).toEqual(withText("as it stands after the reload"));
  });
});

describe("committing", () => {
  it("commits when the writer pauses, crediting the session's co-authors", async () => {
    vi.useFakeTimers();
    const { engine } = testEngine();
    const coAuthors = coAuthorsWith("Sam", "u2");
    const history = controller(engine, { coAuthors });
    history.open({ localId: "l1" });
    await drain(history);
    const baseline = history.getSnapshot().lastCommit!.oid;

    history.setDoc(withText("A long river."));
    await drain(history);
    expect(history.getSnapshot().pending).toBe(1);
    expect(history.getSnapshot().lastCommit?.oid).toBe(baseline);

    // Still typing: the countdown starts over.
    await vi.advanceTimersByTimeAsync(3000);
    history.setDoc(withText("A long, wide river."));
    await drain(history);
    await vi.advanceTimersByTimeAsync(3000);
    await drain(history);
    expect(history.getSnapshot().lastCommit?.oid).toBe(baseline);

    await vi.advanceTimersByTimeAsync(1000);
    await drain(history);
    expect(history.getSnapshot().pending).toBe(0);
    expect(history.getSnapshot().lastCommit?.oid).not.toBe(baseline);

    const entries = await history.loadHistory();
    expect(entries).toHaveLength(2);
    expect(entries[0].coAuthors).toEqual(["Sam"]);
    expect(coAuthors.cleared).toEqual([[{ uid: "u2", name: "Sam", seq: 1 }]]);
  });

  it("never lets unsaved work sit longer than a minute", async () => {
    vi.useFakeTimers();
    const { engine } = testEngine();
    const history = await opened(engine);
    const baseline = history.getSnapshot().lastCommit!.oid;

    // Typing without a four-second pause, for over a minute.
    for (let i = 0; i < 25; i++) {
      history.setDoc(withText(`draft ${i}`));
      await drain(history);
      await vi.advanceTimersByTimeAsync(3000);
    }
    await drain(history);
    expect(history.getSnapshot().lastCommit?.oid).not.toBe(baseline);
    expect((await history.loadHistory()).length).toBeGreaterThanOrEqual(2);
  });

  it("commits when the tab is hidden, until closed", async () => {
    vi.useFakeTimers();
    const listeners = new Set<() => void>();
    const page = {
      visibilityState: "visible",
      addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_type: string, fn: () => void) =>
        listeners.delete(fn),
    };
    vi.stubGlobal("document", page);
    const { engine } = testEngine();
    const history = await opened(engine);

    history.setDoc(withText("about to close the tab"));
    await drain(history);
    page.visibilityState = "hidden";
    for (const fn of listeners) fn();
    await drain(history);
    expect(history.getSnapshot().pending).toBe(0);
    expect(await history.loadHistory()).toHaveLength(2);

    // Closed: no listener, no idle timer.
    history.close();
    expect(listeners.size).toBe(0);
    history.setDoc(withText("after closing"));
    await drain(history);
    await vi.advanceTimersByTimeAsync(10_000);
    await drain(history);
    expect(await history.loadHistory()).toHaveLength(2);
  });

  it("commits now on request, and skips a commit for a lesson since left", async () => {
    const { engine } = testEngine();
    const history = await opened(engine);

    history.setDoc(withText("changed"));
    const result = await history.commitNow();
    expect(result?.oid).toBe(history.getSnapshot().lastCommit?.oid);
    expect(await history.commitNow()).toBeNull();

    // Queued for l1, run after the editor moved to l2: nothing is written.
    history.setDoc(withText("l1's last words"));
    const late = history.commitNow();
    history.open({ localId: "l2" });
    expect(await late).toBeNull();
    await drain(history);
    history.open({ localId: "l1" });
    await drain(history);
    expect(await history.loadHistory()).toHaveLength(2);
  });

  it("reports a commit that failed", async () => {
    const { engine } = testEngine();
    const history = await opened(engine);
    engine.commitDoc = async () => {
      throw new Error("Quota exceeded");
    };
    history.setDoc(withText("changed"));
    expect(await history.commitNow()).toBeNull();
    expect(history.getSnapshot().error).toBe("Quota exceeded");
    history.clearError();
    expect(history.getSnapshot().error).toBeNull();
  });
});

describe("history, restore and variations", () => {
  it("reads a version's changes, and what restoring it would cost", async () => {
    const { engine } = testEngine();
    const history = await opened(engine);
    const first = history.getSnapshot().lastCommit!.oid;
    history.setDoc(withText("A long river."));
    const second = (await history.commitNow())!.oid;

    expect(await history.diffFor(second)).toMatchObject([
      { op: "block.edit", blockId: "b1" },
    ]);
    // The first commit, against nothing: everything was added.
    expect((await history.diffFor(first)).map((op) => op.op)).toContain(
      "block.add",
    );

    // Against the live document, edits since the last commit included.
    history.setDoc(withText("A long river, unsaved."));
    expect(await history.diffAgainstCurrent(second)).toMatchObject([
      { op: "block.edit", blockId: "b1" },
    ]);

    const restored = await history.restore(first);
    expect(restored).toEqual(DOC);
    expect(history.getSnapshot().pending).toBe(0);
    expect(history.getSnapshot().lastCommit?.oid).not.toBe(second);
    expect(await history.loadHistory()).toHaveLength(3);
  });

  it("branches a variation off, switches, renames and deletes it", async () => {
    const { engine } = testEngine();
    const history = await opened(engine);

    await expect(history.createVariation("   ")).rejects.toThrow(
      "Please give this variation a name.",
    );

    // Outstanding edits are committed before the branch is made.
    history.setDoc(withText("before branching"));
    const name = await history.createVariation("Shorter version");
    expect(name).toBe(toBranchName("Shorter version"));
    expect(history.getSnapshot()).toMatchObject({ branch: name, pending: 0 });
    expect(
      history
        .getSnapshot()
        .branches.map((b) => b.name)
        .sort(),
    ).toEqual(["main", name].sort());

    history.setDoc(withText("the short one"));
    await history.commitNow();
    const onMain = await history.switchBranch("main");
    expect(onMain).toEqual(withText("before branching"));
    expect(history.getSnapshot().branch).toBe("main");
    expect(
      history.getSnapshot().branches.find((b) => b.name === name)?.ahead,
    ).toBe(1);

    const renamed = await history.renameVariation(name, "Brief");
    expect(renamed).toBe(toBranchName("Brief"));
    expect(
      history
        .getSnapshot()
        .branches.map((b) => b.name)
        .sort(),
    ).toEqual(["main", renamed].sort());

    await history.deleteVariation(renamed);
    expect(history.getSnapshot().branches.map((b) => b.name)).toEqual(["main"]);
    expect(await history.refreshBranches()).toHaveLength(1);
  });

  it("takes the draft's history along when the lesson is first published", async () => {
    const { engine, adoptDraftRepo } = testEngine();
    const history = await opened(engine);

    await history.adoptDraft("l1");
    await history.adoptDraft(null);
    expect(adoptDraftRepo).not.toHaveBeenCalled();

    history.setDoc(withText("published as is"));
    await history.adoptDraft("pub-1");
    expect(adoptDraftRepo).toHaveBeenCalledWith("pub-1", "l1");
    // Committed first, so nothing is stranded in the draft.
    expect(await history.loadHistory()).toHaveLength(2);
  });
});
