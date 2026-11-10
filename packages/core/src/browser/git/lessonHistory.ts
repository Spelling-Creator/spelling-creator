// The editor's version-control controller: keeps a lesson's repository in step
// with the document being edited, and commits periodically.
//
// Why periodically, rather than per edit? A commit per keystroke would be
// unreadable as history and would churn IndexedDB. So edits accumulate in the
// document, and a commit is taken when the user *pauses* (IDLE_MS), or, if they
// never pause, at least every MAX_WAIT_MS, so a long uninterrupted stretch of
// typing still gets checkpointed. A commit whose tree matches HEAD is skipped
// outright (see repo.ts commitDoc), so an idle editor never accretes empty
// commits.
//
// The repository is set up when a lesson is opened:
//   - a lesson that already has a local repo just opens it
//   - a hub lesson with no local repo clones its published history (so opening
//     the same lesson on another machine brings its whole timeline with it)
//   - anything else gets a fresh repo, seeded with a root commit of the current
//     doc, so there is always a baseline to diff against
//
// Which repository that is comes from the lesson being edited: its hub id once
// it has one, and otherwise its id in this device's library. Opening another
// lesson in the editor therefore opens the other lesson's history; nothing here
// has to be told about it beyond `open`.
//
// The git engine (isomorphic-git, LightningFS and everything that touches the
// object store) is handed in as a loader rather than imported, so the app keeps
// it behind a dynamic import and off the bundle every homepage visitor
// downloads (see apps/web/src/lib/git/load.js).
//
// Nothing here knows about React. The controller is a store (see
// ../../store.ts): the editor reads its snapshot and calls its methods, and
// feeds it the document, the identity and the session's co-author list as they
// change. apps/web/src/lib/git/useLessonGit.js is the hook over it.

import { repoIdFor } from "../../git/doc.ts";
import { diffDocs, type Op } from "../../git/ops.ts";
import { fetchPack } from "../../git/remote.ts";
import { DEFAULT_BRANCH, toBranchName } from "../../git/refs.ts";
import type {
  BranchInfo,
  CommitIdentity,
  GitContext,
  HistoryEntry,
} from "../../git/repo.ts";
import { createStore, type ReadableStore } from "../../store.ts";
import type { LessonDoc } from "../../types.ts";
import type { CoAuthors } from "../collabSession.ts";

// Commit once the user has been still for this long.
const IDLE_MS = 4000;
// ...but never let unsaved work sit longer than this, however fast they type.
const MAX_WAIT_MS = 60000;

type Repo = typeof import("../../git/repo.ts");

/**
 * What the controller needs from the git engine: the object-store half of
 * git/repo.ts and git/pack.ts, plus where a lesson's repository lives. The
 * app's lazily loaded engine module satisfies this as it is.
 */
export interface LessonHistoryEngine extends Pick<
  Repo,
  | "ensureRepo"
  | "headOid"
  | "readDocAt"
  | "commitDoc"
  | "pendingOps"
  | "currentBranch"
  | "listBranches"
  | "history"
  | "diffFromParent"
  | "restoreCommit"
  | "checkoutBranch"
  | "createBranch"
  | "renameBranch"
  | "deleteBranch"
> {
  /** `{ fs, gitdir }` for a lesson's repository. */
  repoCtx(repoId: string): GitContext;
  repoExists(repoId: string): Promise<boolean>;
  deleteRepo(repoId: string): Promise<void>;
  /** Carry a draft's repository over to the id it was published under. */
  adoptDraftRepo(
    lessonId: string | null | undefined,
    draftRepoId?: string | null,
  ): Promise<void>;
  cloneFromPack: (typeof import("../../git/pack.ts"))["cloneFromPack"];
}

export interface LessonHistoryState {
  /** The repository being edited (see repoIdFor). */
  repoId: string;
  /** Whether the repository is open and can be committed to. */
  ready: boolean;
  /** How many block operations the document holds that HEAD doesn't. */
  pending: number;
  lastCommit: { oid: string; at: number } | null;
  error: string | null;
  /** The variation being edited: the repository's current branch. */
  branch: string;
  branches: BranchInfo[];
}

/** Which lesson's history to open. */
export interface LessonHistoryTarget {
  /** The hub lesson being edited, if any. */
  editingId?: string | null;
  /** The lesson's id in this device's library: its repository until it's published. */
  localId?: string | null;
}

export interface LessonHistoryOptions {
  /** Fetches the git engine. Awaited the first time the controller needs it. */
  loadEngine: () => Promise<LessonHistoryEngine>;
  /** The live editor document. */
  doc?: LessonDoc | null;
  /** Stamped on commits. */
  identity?: CommitIdentity | null;
  /**
   * A live session's co-author list (see browser/collabSession.ts): who
   * else's edits a commit holds, credited with a `Co-authored-by` trailer each.
   */
  coAuthors?: CoAuthors | null;
}

export interface LessonHistory extends ReadableStore<LessonHistoryState> {
  /**
   * Open a lesson's repository, setting it up if need be. Opening the one
   * already open is nothing; opening another leaves the first behind,
   * including whatever credit was still pending for it.
   */
  open(target: LessonHistoryTarget): void;
  /** Stop watching: no more periodic commits. `open` starts again. */
  close(): void;
  /** The live editor document, as it stands now. */
  setDoc(doc: LessonDoc | null | undefined): void;
  setIdentity(identity: CommitIdentity | null | undefined): void;
  setCoAuthors(coAuthors: CoAuthors | null | undefined): void;
  clearError(): void;
  /** Commit the document now, whatever the timers say. Null when nothing changed. */
  commitNow(): Promise<{ oid: string; ops: Op[] } | null>;
  loadHistory(): Promise<HistoryEntry[]>;
  /** What a commit changed, as block operations, against its first parent. */
  diffFor(oid: string): Promise<Op[]>;
  /** What restoring a version would change, against the live document. */
  diffAgainstCurrent(oid: string): Promise<Op[]>;
  /** Restore an earlier version. Returns the restored doc for the editor to adopt. */
  restore(oid: string): Promise<LessonDoc>;
  refreshBranches(): Promise<BranchInfo[]>;
  /** Move to a branch and hand back the document as it stands there. */
  switchBranch(name: string): Promise<LessonDoc | null>;
  /** Start a variation from where we are and switch to it. Returns its name. */
  createVariation(label: string): Promise<string>;
  renameVariation(from: string, label: string): Promise<string>;
  deleteVariation(name: string): Promise<void>;
  /** Take the draft repo's history along when a draft is first published. */
  adoptDraft(lessonId: string | null | undefined): Promise<void>;
  /** Queue work against this lesson's repo (used by the fork/merge flows). */
  run<T>(task: () => Promise<T>): Promise<T>;
}

/** A doc worth committing. The starter doc (no sections) isn't. */
function worthCommitting(doc: LessonDoc | null): doc is LessonDoc {
  return Boolean(doc && Array.isArray(doc.sections) && doc.sections.length > 0);
}

function messageOf(err: unknown, fallback: string) {
  return (err instanceof Error && err.message) || fallback;
}

export function createLessonHistory(
  options: LessonHistoryOptions,
): LessonHistory {
  const { loadEngine } = options;
  const store = createStore<LessonHistoryState>({
    repoId: repoIdFor(null, null),
    ready: false,
    pending: 0,
    lastCommit: null,
    error: null,
    branch: DEFAULT_BRANCH,
    branches: [],
  });

  let doc: LessonDoc | null = options.doc ?? null;
  let identity: CommitIdentity | null = options.identity ?? null;
  let coAuthors: CoAuthors | null = options.coAuthors ?? null;

  let repoId = repoIdFor(null, null);
  let editingId: string | null = null;
  let opened = false;
  // Bumped by every open and close, so a setup that finishes after the lesson
  // it was for has been left behind changes nothing.
  let generation = 0;
  // Likewise for the pending-ops check that follows every edit: only the
  // latest one is worth finishing.
  let checkSeq = 0;

  // Set when this lesson deliberately has no repository: its published history
  // was unreachable, so setup left the slot empty for a later open to clone
  // into. Nothing may write git objects there in the meantime.
  let noRepo = false;

  // Timers for the two commit triggers, and the wall-clock time the current
  // batch of unsaved edits began (so MAX_WAIT_MS is measured from the first
  // unsaved edit, not the most recent one).
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let dirtySince: number | null = null;

  // Commits are serialized through this promise chain. Two commits racing on
  // one repo would interleave their ref writes, and the loser's work would
  // vanish.
  let queue: Promise<unknown> = Promise.resolve();

  function run<T>(task: () => Promise<T>): Promise<T> {
    const next = queue.then(task, task);
    // Keep the chain alive even if a task rejects, or every later commit dies too.
    queue = next.catch(() => {});
    return next;
  }

  function clearIdle() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function headAt(engine: LessonHistoryEngine, ctx: GitContext) {
    return engine
      .headOid(ctx)
      .then((head) => (head ? { oid: head, at: Date.now() } : null));
  }

  /**
   * Commit the document being edited, crediting everyone in a live session
   * whose edits arrived since the last commit. Every path that checkpoints the
   * live document goes through here, so whichever of them picks a session's
   * edits up is the one that names who made them. A restore, undo or merge
   * doesn't: those are the local user's own decision.
   *
   * The people it checked are forgotten whether or not there was anything to
   * commit. A commit holds their edits; finding nothing means the document
   * already matches HEAD, so their edits are in an earlier commit or were
   * undone, and either way they have nothing left to be credited for. Only a
   * failed commit leaves them waiting.
   */
  async function commitLive(
    engine: LessonHistoryEngine,
    ctx: GitContext,
    current: LessonDoc | null = doc,
  ) {
    if (!current) return null;
    const credited = coAuthors?.peek() || [];
    const result = await engine.commitDoc({
      ...ctx,
      doc: current,
      author: identity,
      coAuthors: credited,
    });
    coAuthors?.clear(credited);
    return result;
  }

  // ---- committing ----------------------------------------------------------

  function commitNow() {
    const repo = repoId;
    return run(async () => {
      const current = doc;
      // A commit queued for a lesson the editor has since left must not land
      // in the repository that is open now.
      if (repo !== repoId || !worthCommitting(current) || noRepo) return null;

      try {
        const engine = await loadEngine();
        const result = await commitLive(engine, engine.repoCtx(repo), current);
        // Whatever happened, the doc now matches HEAD: clear the dirty state.
        dirtySince = null;
        store.patch({ pending: 0 });
        if (result) {
          store.patch({ lastCommit: { oid: result.oid, at: Date.now() } });
        }
        return result;
      } catch (err) {
        // The edits are still outstanding, but counted from now: otherwise,
        // past the one-minute mark, every keystroke would retry at once.
        dirtySince = Date.now();
        store.patch({ error: messageOf(err, "Could not save a version.") });
        return null;
      }
    });
  }

  // ---- the periodic trigger ------------------------------------------------
  // Recompute what's outstanding, then decide whether this edit should commit
  // now (we've been dirty too long) or reset the idle countdown.
  function scheduleCheck() {
    if (!opened || !store.getSnapshot().ready) return;
    const current = doc;
    if (!worthCommitting(current)) return;
    const mine = ++checkSeq;
    const repo = repoId;

    run(async () => {
      if (mine !== checkSeq) return;
      const engine = await loadEngine();
      const ops = await engine
        .pendingOps({ ...engine.repoCtx(repo), doc: current })
        .catch((): Op[] | null => null);
      if (mine !== checkSeq) return;
      if (!ops) {
        // Couldn't tell what is outstanding. Not "nothing": the count stays
        // as it was, and a commit is still taken at the next pause, which
        // finds out for itself.
        clearIdle();
        idleTimer = setTimeout(() => {
          idleTimer = null;
          commitNow();
        }, IDLE_MS);
        return;
      }
      store.patch({ pending: ops.length });
      if (ops.length === 0) {
        dirtySince = null;
        return;
      }
      if (dirtySince === null) dirtySince = Date.now();

      if (Date.now() - dirtySince >= MAX_WAIT_MS) {
        commitNow();
        return;
      }
      clearIdle();
      idleTimer = setTimeout(() => {
        idleTimer = null;
        commitNow();
      }, IDLE_MS);
    });
  }

  // Commit whatever is outstanding when the tab is hidden, so closing it
  // mid-edit doesn't lose the checkpoint.
  const flush = () => {
    if (document.visibilityState === "hidden") commitNow();
  };
  let watching = false;
  function watchVisibility() {
    if (watching || typeof document === "undefined") return;
    document.addEventListener("visibilitychange", flush);
    watching = true;
  }
  function unwatchVisibility() {
    if (!watching) return;
    document.removeEventListener("visibilitychange", flush);
    watching = false;
  }

  // ---- repository setup ----------------------------------------------------

  function open(target: LessonHistoryTarget) {
    const nextRepo = repoIdFor(target.editingId, target.localId);
    const nextEditing = target.editingId || null;
    if (opened && nextRepo === repoId && nextEditing === editingId) return;

    opened = true;
    repoId = nextRepo;
    editingId = nextEditing;
    const mine = ++generation;
    checkSeq++;
    clearIdle();
    dirtySince = null;
    watchVisibility();

    // A different lesson's repository. Whatever was still waiting for credit
    // belongs to the lesson being left, which was checkpointed on the way out,
    // so none of it may land on this one.
    coAuthors?.discard();

    // Nothing of the lesson being left stays on show while this one opens.
    store.patch({
      repoId,
      ready: false,
      pending: 0,
      lastCommit: null,
      error: null,
      branch: DEFAULT_BRANCH,
      branches: [],
    });
    // The document as it is now, which is this lesson's: the editor hands the
    // controller a lesson's document before opening its history. By the time
    // a setup queued behind another runs, the live one may be the next
    // lesson's, which must never seed this one's repository.
    const seed = doc;
    // Whether the editor has opened something else since. Checked before
    // every write, not only at the end, so a setup left behind writes nothing.
    const left = () => mine !== generation;
    run(async () => {
      if (left()) return;
      try {
        noRepo = false;
        const engine = await loadEngine();
        const ctx = engine.repoCtx(nextRepo);

        // Give this lesson a repository. A published one brings its history
        // down first, so the timeline follows the lesson rather than the
        // browser; anything else starts empty.
        //
        // fetchPack distinguishes the two failures that matter here, and this
        // must not flatten them: it returns null when the lesson genuinely has
        // no published history (a 404, or a pack with no tip), and *throws*
        // when the hub couldn't be reached at all. Only the first means "start
        // empty". If a dropped connection were read that way, the empty
        // repository would take a baseline commit of the current document, and
        // every later open would find a repository that exists with a readable
        // head and leave it alone: the published timeline never cloned, and the
        // local one diverged from the hub for good. So a throw propagates:
        // setup fails, no repository is left behind, and the next open tries
        // the clone again.
        const createRepo = async () => {
          if (nextEditing) {
            const pack = await fetchPack(nextEditing);
            if (left()) return;
            if (pack) {
              await engine.cloneFromPack({ ...ctx, ...pack });
              return;
            }
          }
          await engine.ensureRepo(ctx);
        };

        if (left()) return;
        if (!(await engine.repoExists(nextRepo))) {
          await createRepo();
        } else {
          // A repository we already hold, which we are about to read the whole
          // timeline out of, so check first that we actually can.
          //
          // A browser closed (or reloaded) in the middle of a commit can leave
          // the branch pointing at a commit whose object never made it to
          // disk: LightningFS persists file contents and its directory index
          // separately, so a torn write is possible however careful the code
          // above it is. Every later read then throws on the same missing
          // object, and the lesson is stuck with no history at all rather
          // than a shortened one. Starting the repository again costs the old
          // timeline, which was already unreadable; the *document* is never at
          // stake, since it lives in the library, not in here.
          //
          // Rebuilt through the same createRepo as a lesson we never had,
          // which is what makes a published lesson whole again rather than
          // merely working: its history is on the hub, so the replacement is
          // a clone of it. An empty repository would look established enough
          // for every later open to leave alone, stranding the published
          // timeline for good.
          const existingHead = await engine.headOid(ctx).catch(() => null);
          if (existingHead) {
            const readable = await engine
              .readDocAt({ ...ctx, oid: existingHead })
              .then(() => true)
              .catch(() => false);
            if (!readable) {
              if (left()) return;
              await engine.deleteRepo(nextRepo);
              await createRepo();
            }
          }
        }

        // Seed a baseline so the first real edit has something to diff against.
        if (left()) return;
        if (!(await engine.headOid(ctx)) && worthCommitting(seed)) {
          if (left()) return;
          await engine.commitDoc({
            ...ctx,
            doc: seed,
            author: identity,
            message: "Start the lesson\n",
          });
        }

        const lastCommit = await headAt(engine, ctx);
        if (left()) return;
        const pending = worthCommitting(doc)
          ? (await engine.pendingOps({ ...ctx, doc })).length
          : 0;
        const branch = await engine.currentBranch(ctx);
        const branches = await engine.listBranches(ctx);
        if (left()) return;
        store.patch({ lastCommit, pending, branch, branches, ready: true });
        // The document may have moved on while the repository was opening.
        scheduleCheck();
      } catch (err) {
        console.error("[lesson-git] setup failed", err);
        if (left()) return;
        // Nothing usable was left on disk, and commitNow must not put anything
        // there either: a stray object store would be indistinguishable from a
        // real repository next time, and the clone would never be retried.
        noRepo = true;
        store.patch({
          error: messageOf(err, "Version history is unavailable."),
          ready: false,
        });
      }
    });
  }

  function close() {
    if (!opened) return;
    opened = false;
    generation++;
    checkSeq++;
    clearIdle();
    unwatchVisibility();
    store.patch({ ready: false });
  }

  // ---- variations ----------------------------------------------------------
  //
  // A variation is a branch, and the four things you can do to one are create,
  // switch, rename and delete. Every one of them commits what's outstanding
  // first: the editor's rule is that work is checkpointed when you pause, so a
  // variation must never be the thing that loses the last few seconds of it.
  //
  // Which is why the checkpoint below is *not* wrapped in a catch. commitDoc
  // returns null when there is nothing to commit (the ordinary case, needing
  // no handling), so the only thing a catch could swallow is a real failure,
  // and swallowing that would let the checkout replace the document and clear
  // the dirty markers with the edits still uncommitted. The caller shows the
  // error instead, and nothing moves.

  async function branchState(engine: LessonHistoryEngine, ctx: GitContext) {
    const branches = await engine.listBranches(ctx);
    const branch = await engine.currentBranch(ctx);
    // Re-read the tip too. A merge doesn't always leave a commit behind (a
    // fast-forward moves the branch instead, see completeMerge), so the chip
    // would otherwise still be timing the commit before it.
    const lastCommit = await headAt(engine, ctx);
    store.patch({ branches, branch, lastCommit });
    return branches;
  }

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    open,
    close,
    run,
    commitNow,
    clearError: () => store.patch({ error: null }),

    setDoc(next) {
      doc = next ?? null;
      scheduleCheck();
    },
    setIdentity(next) {
      identity = next ?? null;
    },
    setCoAuthors(next) {
      coAuthors = next ?? null;
    },

    loadHistory() {
      const repo = repoId;
      return run(async () => {
        try {
          const engine = await loadEngine();
          return await engine.history(engine.repoCtx(repo));
        } catch {
          return [];
        }
      });
    },

    diffFor(oid) {
      const repo = repoId;
      return run(async () => {
        try {
          const engine = await loadEngine();
          return await engine.diffFromParent({ ...engine.repoCtx(repo), oid });
        } catch {
          return [];
        }
      });
    },

    // A different question from `diffFor`, and the one actually being asked
    // at the moment somebody hovers over Restore. "What changed in this
    // version" is history; "what would I get back" is a decision.
    //
    // Against the *live* document, not the last commit. Restoring replaces
    // what is on screen, so edits made inside the four-second commit window
    // are part of what would be lost, and a preview that omitted them would
    // understate the cost of the one action it exists to inform.
    diffAgainstCurrent(oid) {
      const repo = repoId;
      return run(async () => {
        try {
          const engine = await loadEngine();
          const ctx = engine.repoCtx(repo);
          return diffDocs(doc, await engine.readDocAt({ ...ctx, oid }));
        } catch {
          return [];
        }
      });
    },

    restore(oid) {
      const repo = repoId;
      return run(async () => {
        const engine = await loadEngine();
        const ctx = engine.repoCtx(repo);
        const result = await engine.restoreCommit({
          ...ctx,
          oid,
          author: identity,
        });
        store.patch({ lastCommit: await headAt(engine, ctx), pending: 0 });
        dirtySince = null;
        return result.doc;
      });
    },

    refreshBranches() {
      const repo = repoId;
      return run(async () => {
        const engine = await loadEngine();
        return branchState(engine, engine.repoCtx(repo));
      });
    },

    switchBranch(name) {
      const repo = repoId;
      return run(async () => {
        const engine = await loadEngine();
        const ctx = engine.repoCtx(repo);

        await commitLive(engine, ctx);

        const result = await engine.checkoutBranch({ ...ctx, name });
        dirtySince = null;
        store.patch({ pending: 0 });
        await branchState(engine, ctx);
        return result.doc;
      });
    },

    // `label` is what the author typed; the branch takes the name that
    // survives git's rules (see git/refs.ts). An empty result means they typed
    // nothing git could keep, which is the caller's to report.
    createVariation(label) {
      const repo = repoId;
      return run(async () => {
        const name = toBranchName(label);
        if (!name) throw new Error("Please give this variation a name.");

        const engine = await loadEngine();
        const ctx = engine.repoCtx(repo);

        await commitLive(engine, ctx);

        await engine.createBranch({ ...ctx, name });
        dirtySince = null;
        store.patch({ pending: 0 });
        // The checkpoint above may have moved the tip, so the chip is
        // refreshed along with the list.
        await branchState(engine, ctx);
        return name;
      });
    },

    renameVariation(from, label) {
      const repo = repoId;
      return run(async () => {
        const to = toBranchName(label);
        if (!to) throw new Error("Please give this variation a name.");

        const engine = await loadEngine();
        const ctx = engine.repoCtx(repo);
        await engine.renameBranch({ ...ctx, from, to });
        await branchState(engine, ctx);
        return to;
      });
    },

    deleteVariation(name) {
      const repo = repoId;
      return run(async () => {
        const engine = await loadEngine();
        const ctx = engine.repoCtx(repo);
        await engine.deleteBranch({ ...ctx, name });
        store.patch({ branches: await engine.listBranches(ctx) });
      });
    },

    // Commits everything outstanding first, so nothing is stranded in the
    // draft.
    adoptDraft(lessonId) {
      const repo = repoId;
      return run(async () => {
        // Nothing to adopt once the repo is already the lesson's own, which is
        // the case for every save after the first.
        if (!lessonId || repo === lessonId) return;
        const engine = await loadEngine();
        await commitLive(engine, engine.repoCtx(repo)).catch(() => null);
        await engine.adoptDraftRepo(lessonId, repo);
      });
    },
  };
}
