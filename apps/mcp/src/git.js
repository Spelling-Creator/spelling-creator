// Version history for an AI assistant: committing its edits, forking a lesson,
// proposing changes back — and, at the other end, reading a proposal and
// merging it when the reviewer says so (see reviewProposal and mergeProposal,
// which are the proposal view's half of this file).
//
// This is the assistant's version of what the editor does in the browser (see
// packages/core/src/browser/git/sync.js, which is the same flow bound to
// LightningFS). Two rules it exists to respect, both the hub's rather than ours:
//
//   - Every edit is a commit. A lesson is a real git repository (see
//     docs monorepo/version-history), and the editor commits as the user works,
//     so the History tab is the record of how the lesson got here. An assistant
//     writing over MCP is one more writer, and its edits belong in that record
//     alongside the rest — attributed, diffable, and revertable.
//   - Nobody writes a lesson from a fork. Work travels back through a proposal,
//     which a human reads and merges. So an assistant asked to change somebody
//     else's lesson does not save over it — it forks, edits its own copy, and
//     opens a proposal.
//
// ---- Why there is no state between calls ------------------------------------
//
// A repository here lives in memory (core/git/memfs.js) and is thrown away when
// the tool call returns. It doesn't need to survive, because the durable state is
// the lesson's row (its document) and its packfile in R2. Each call rebuilds
// exactly what it needs by cloning that pack, which means the history survives
// the server restarting, a conversation being resumed days later, and the remote
// transport moving a connection between Worker instances.
//
// ---- What a proposal contains -----------------------------------------------
//
// The fork's history as it stands: the commits recordLessonHistory made as the
// assistant edited it, against the commit the fork and the lesson diverged from.
// That diff is the thing being reviewed, and it's exact; the shared ancestry is
// what makes it a true three-way merge rather than a guess.

import {
  preserveLocalFields,
  stripLocalFields,
} from "@spelling-creator/core/git/doc";
import { memRepo } from "@spelling-creator/core/git/memfs";
import { mergeDocs } from "@spelling-creator/core/git/merge";
import {
  describeOp,
  describeOps,
  diffDocs,
  summaryOf,
} from "@spelling-creator/core/git/ops";
import {
  cloneFromPack,
  contains,
  fetchRemotePack,
  mergeBase,
  packRepo,
} from "@spelling-creator/core/git/pack";
import { DEFAULT_BRANCH } from "@spelling-creator/core/git/refs";
import {
  ORIGIN_REF,
  UPSTREAM_REF,
  authorFrom,
  commitDoc,
  headOid,
  pendingOps,
  pullRef,
  readDocAt,
} from "@spelling-creator/core/git/repo";
import { PULL_BODY_MAX, PULL_TITLE_MAX } from "@spelling-creator/core/pulls";

/**
 * The signature to stamp the assistant's commits with.
 *
 * The hub attributes everything to the account whose token this is — the
 * assistant acts as the signed-in user, and there is no separate identity to
 * claim. So the commit carries that user's name, and `assistantNote` below is
 * where the fact that an assistant wrote it is recorded.
 */
async function commitAuthor(api) {
  const me = await api.whoami().catch(() => null);
  return authorFrom({ name: me?.displayName, email: me?.email });
}

/** Trim to a limit on a word boundary where there is one nearby. */
function clamp(value, limit) {
  const text = (value || "").trim();
  if (limit <= 0) return ""; // no room at all; slicing by a negative would cut from the end
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit * 0.8 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// A client's self-reported name is used in the provenance notes below, so it is
// bounded before it gets there: it is arbitrary text from the connecting client,
// and an absurd one must not crowd out the text it is annotating.
const CLIENT_NAME_MAX = 80;

/**
 * One line saying an assistant did this, and which client it came through.
 *
 * Worth the line wherever it appears. The hub attributes everything to the
 * account whose token this is, so without it the user sees their own name
 * against a commit they didn't write and a proposal they didn't make. `client`
 * is the MCP client's own reported name (Claude Desktop, claude.ai, Cursor, …),
 * which is the closest thing to an honest answer available — we know what
 * connected, not what model it drove.
 */
function assistantNote(client, verb) {
  const named = clamp(client, CLIENT_NAME_MAX);
  return named
    ? `${verb} by an AI assistant via ${named} (Spelling Creator MCP).`
    : `${verb} by an AI assistant via the Spelling Creator MCP server.`;
}

/**
 * The same provenance line for the one thing here an assistant does *not* do.
 *
 * A merge lands in the lesson's history under the reviewer's own name, and it
 * should: they decided it. But the commit still wants to say where the decision
 * was made, because "merged in the web app" and "merged by clicking Merge in an
 * assistant's proposal view" are different enough that a reader looking for the
 * review later should be able to tell which happened. The distinction from
 * assistantNote is deliberate — claiming an assistant merged this would be
 * false, and it is exactly the claim the proposal view exists to avoid making.
 */
function reviewerNote(client) {
  const named = clamp(client, CLIENT_NAME_MAX);
  return named
    ? `Merged by the reviewer from the proposal view in ${named} (Spelling Creator MCP).`
    : "Merged by the reviewer from the Spelling Creator MCP proposal view.";
}

/** The proposal's body, with a note saying which assistant wrote it. */
export function proposalBody(body, client) {
  const note = assistantNote(client, "Proposed");
  const text = (body || "").trim();
  if (!text) return note;
  // Keep the whole note: it's the provenance, and it's what tells a reviewer to
  // read the diff rather than assume they wrote it.
  return `${clamp(text, PULL_BODY_MAX - note.length - 2)}\n\n${note}`;
}

/**
 * Build an in-memory repository holding a lesson's history, cloned from its
 * stored pack. The clone carries the original's commit oids, so the fork shares
 * ancestry with it — which is what a reviewer's three-way merge needs.
 *
 * `keepVariations` says whether the lesson's other branches come too. Cloning our
 * own lesson to push it back again, they must — dropping one would delete it. But
 * a fork takes the lesson and not its author's half-finished ideas, so forking
 * asks for the default branch alone.
 */
async function cloneRepo(pack, { keepVariations = true } = {}) {
  const ctx = memRepo();
  await cloneFromPack({
    ...ctx,
    ...pack,
    refs: keepVariations ? pack.refs : null,
  });
  return ctx;
}

/**
 * What the compare-and-swap on a push should claim about each branch.
 *
 * The pack we just downloaded is what the hub held a moment ago, so its branch
 * map is exactly what we believe. A pack stored before variations existed
 * advertises no map, which reads as the one branch it has. No pack at all means
 * a lesson with no history yet, and an empty claim says "all of this is new".
 */
function believedRefs(pack) {
  if (!pack) return {};
  return pack.refs || { [DEFAULT_BRANCH]: pack.head };
}

/**
 * Commit a lesson's document into its stored history, so an edit made here shows
 * up in the lesson's History tab beside the ones made in the editor.
 *
 * ---- Why the writing tools call this ----------------------------------------
 *
 * The hub's row and the hub's repository are two separate stores, and saving a
 * document only writes the first. The browser editor writes both — it commits as
 * the user works and pushes on save — so a lesson only ever touched there has a
 * history that explains it. An assistant that wrote the row alone left the
 * History tab saying nothing had happened, which is worse than unhelpful: it is
 * the record the user checks to see what an assistant did to their lesson, and
 * there is nothing to revert to if they don't like it.
 *
 * ---- Two commits, not one ---------------------------------------------------
 *
 * The row can be ahead of the history: a lesson edited over MCP before this
 * existed, or one whose earlier push failed, has content in its document that no
 * commit accounts for. Committing the new document straight on top would fold
 * that drift into the assistant's commit and attribute it there. So the document
 * as it stood *before* this edit is committed first, plainly labelled, and the
 * assistant's commit is then the diff a reader expects it to be. Both are no-ops
 * in the ordinary case — commitDoc compares trees and declines to write an empty
 * commit — so the usual result is the one commit the edit deserves.
 *
 * ---- Never throws -----------------------------------------------------------
 *
 * The document is already saved by the time this runs, and no failure here can
 * unsave it. A conflict (someone saved the lesson from the editor in between), a
 * lesson whose history is stored under an id we may not write, an R2 hiccup — all
 * of them mean "the edit stands but the history didn't move", which is reported
 * rather than raised. The tool result carries it so the assistant can say so.
 *
 * @param {object} args.doc          The document as it now stands (already saved).
 * @param {object} [args.previousDoc] The document as it stood before this edit.
 * @param {string} [args.summary]    Overrides the derived commit summary line.
 * @param {string} [args.client]     The MCP client's name, for the provenance note.
 * @returns {Promise<{ recorded: boolean, commit?: string, summary?: string,
 *          seeded?: boolean, caughtUp?: boolean, reason?: string }>}
 */
export async function recordLessonHistory(
  api,
  { lessonId, doc: nextDoc, previousDoc, summary, client },
) {
  try {
    const doc = stripLocalFields(nextDoc);
    // Read the history *after* the document has been written, not before, which
    // is the opposite of forking (see forkLesson) and right for the opposite
    // reason. Nothing here is being paired with the document — it is already
    // saved — so the only thing the timing affects is the compare-and-swap below,
    // and the later this is read the smaller the window in which somebody else's
    // push can land between reading and pushing.
    const pack = await api.fetchLessonPack(lessonId);
    const ctx = pack ? await cloneRepo(pack) : memRepo();
    const author = await commitAuthor(api);

    // The catch-up commit described above. A lesson with no stored history at all
    // gets the same treatment for the same reason: its existing content becomes
    // the starting point, so what follows reads as this edit and not as the
    // lesson appearing from nowhere.
    const before = previousDoc ? stripLocalFields(previousDoc) : null;
    const base = before
      ? await commitDoc({
          ...ctx,
          doc: before,
          author,
          message: pack
            ? "Record the lesson as it was last saved\n\nBrings the history up to the lesson's stored document, which had changes no commit accounted for.\n"
            : "Record the lesson as it was last saved\n\nThis lesson had no stored history, so its existing content starts one.\n",
        })
      : null;

    // Derived from the previous commit rather than from the tool's own arguments:
    // what the history should say is what actually changed, which is not always
    // what the assistant asked for (a patch can set a field to the value it
    // already had). An empty list means this edit changed nothing git stores.
    const ops = await pendingOps({ ...ctx, doc });
    const note = assistantNote(client, "Made");
    const message = ops.length
      ? summary
        ? `${clamp(summary, 72)}\n\n${ops.map(describeOp).join("\n")}\n\n${note}\n`
        : `${describeOps(ops)}\n${note}\n`
      : null;
    const commit = message
      ? await commitDoc({ ...ctx, doc, author, message })
      : null;

    if (!commit && !base) return { recorded: false, reason: "unchanged" };

    const packed = await packRepo(ctx);
    await api.pushLessonPack(lessonId, {
      packfile: packed.packfile,
      head: packed.head,
      // The compare-and-swap: the tip we just downloaded. If the lesson has moved
      // on since — a collaborator saving from the editor — the hub refuses, and it
      // is right to: our pack does not contain their commits.
      parent: pack?.head || null,
      // Every branch we hold, because a push that named only the lesson's own
      // would leave the hub advertising variations this pack no longer carries.
      refs: packed.refs,
      expected: believedRefs(pack),
    });

    return {
      recorded: true,
      commit: (commit || base).oid,
      summary: summaryOf(message || "Record the lesson as it was last saved"),
      seeded: !pack,
      caughtUp: Boolean(base),
    };
  } catch (err) {
    return { recorded: false, reason: err.message };
  }
}

/**
 * Fork a lesson into a new private draft owned by the caller.
 *
 * The fork is a genuine clone wherever it can be: its repository is the source
 * lesson's, downloaded and re-uploaded under the new id, with the original's tip
 * recorded at refs/remotes/upstream/main so the fork knows where it came from.
 *
 * A lesson with no stored history (one written before version history existed)
 * can't be cloned, so the fork's history is seeded from its document instead.
 * That fork still works — it just shares no commit with the original, so a later
 * merge compares two sides rather than three. The result says which happened,
 * because it changes what a reviewer will see.
 *
 * @returns {Promise<{ lesson: object, head: string, clonedHistory: boolean }>}
 */
export async function forkLesson(api, { lessonId, title }) {
  // Read the history *before* the document, which is the safe order rather than
  // the obvious one. A lesson being saved in the browser at this moment pushes
  // its history first and its document row second (see the ordering note in
  // apps/web/src/pages/EditorPage.jsx), so a document read after a pack is never
  // older than that pack. Read the other way round and we could pair yesterday's
  // document with today's history — and the reconciliation commit below would
  // then commit stale content on top of newer commits, quietly reverting the save
  // it raced. This way that pairing can't arise: at worst the document is newer,
  // which the reconciliation commit simply carries forward.
  const pack = await api.fetchLessonPack(lessonId);

  const source = await api.getLesson(lessonId);
  if (!source.doc?.sections?.length) {
    throw new Error("That lesson has no content to fork.");
  }

  // The fork's document. Local-only fields never travel (see core/git/doc.js):
  // the trusted-collaborator list belongs to the lesson it was named on, not to
  // a copy of it, and it must not be carried into a new lesson's document.
  const doc = stripLocalFields(source.doc);
  const forkTitle = (title || "").trim() || source.title;

  // Create the row first: the history is pushed under the new lesson's id, so
  // there has to be a new lesson to push it to. `forkedFrom` is the pointer home.
  const lesson = await api.createLesson({
    title: forkTitle,
    doc: { ...doc, title: forkTitle },
    published: false,
    forkedFrom: lessonId,
  });

  const author = await commitAuthor(api);
  let ctx;
  if (pack) {
    ctx = await cloneRepo(pack, { keepVariations: false });
    // Record where we came from, so a later sync has a base before it fetches
    // anything new.
    await fetchRemotePack({ ...ctx, ...pack, ref: UPSTREAM_REF });

    // The row's document and the history's tip can disagree — an edit whose
    // history push failed, or one made over MCP before edits were committed,
    // leaves the stored pack lagging. Commit the difference now, under the fork,
    // so the fork is self-consistent from the start and the proposal's diff later
    // shows only what the assistant changed. A no-op when they already agree,
    // which is the normal case.
    await commitDoc({
      ...ctx,
      doc: { ...doc, title: forkTitle },
      author,
      message: `Fork "${source.title}"\n\nBrings the fork up to the lesson's saved document.\n`,
    });
  } else {
    ctx = memRepo();
    await commitDoc({
      ...ctx,
      doc: { ...doc, title: forkTitle },
      author,
      message: `Fork "${source.title}"\n\nThe original has no stored history, so this fork starts from its current document.\n`,
    });
  }

  const packed = await packRepo(ctx);
  try {
    // A brand-new lesson has no history, so there is nothing to compare and swap
    // against — every branch we are sending is new to it, which is what an empty
    // `expected` says.
    await api.pushLessonPack(lesson.id, {
      packfile: packed.packfile,
      head: packed.head,
      parent: null,
      refs: packed.refs,
      expected: {},
    });
  } catch (err) {
    // The row exists but has no history behind it, which is the one state the
    // rest of this file can't work from. Say so rather than leaving the assistant
    // to rediscover it at propose time — and don't delete the lesson, which is
    // a real copy of the document and the user's to keep or remove.
    throw new Error(
      `The fork was created (${lesson.id}) but its history could not be stored, so changes to it can't be ` +
        `proposed yet. Delete it and fork again. (${err.message})`,
    );
  }

  return { lesson, head: packed.head, clonedHistory: Boolean(pack) };
}

/**
 * Offer a fork's work back to the lesson it came from, as a proposal.
 *
 * Nothing is written to that lesson — not its document, not its history. What
 * travels is a snapshot of the fork's repository, which its author (or a trusted
 * collaborator) reviews and merges from the web app. Snapshotting is what makes
 * the request stable: the fork can carry on changing and what the reviewer read
 * won't move under them.
 *
 * Opening it is two steps — the request, then its pack — because the pack is
 * uploaded against the request's id. If the upload fails the empty request is
 * withdrawn, rather than left in a review queue with nothing in it.
 *
 * The fork's own history is pushed *last*, deliberately: see below.
 *
 * @returns {Promise<{ pull: object, lessonId: string, commit: string,
 *          changes: string[], historyPushed: boolean }>}
 */
export async function proposeChanges(
  api,
  { forkLessonId, lessonId, title, body, client },
) {
  const fork = await api.getLesson(forkLessonId);
  const target = (lessonId || fork.forkedFrom || "").trim();
  if (!target) {
    throw new Error(
      `Lesson ${forkLessonId} is not a fork of anything, so there is nobody to propose to. ` +
        "Pass lessonId to say which lesson the changes are for, or fork_lesson first.",
    );
  }
  if (target === forkLessonId) {
    throw new Error("A lesson cannot propose changes to itself.");
  }
  if (!fork.doc?.sections?.length) {
    throw new Error("That fork has no content to propose.");
  }

  const forkPack = await api.fetchLessonPack(forkLessonId);
  if (!forkPack) {
    throw new Error(
      `Lesson ${forkLessonId} has no stored history, so there is no fork to propose from. ` +
        "Create the fork with fork_lesson, edit that, then propose.",
    );
  }

  const ctx = await cloneRepo(forkPack);
  const doc = stripLocalFields(fork.doc);

  // The fork's edits were committed as they were made (recordLessonHistory), so
  // its history usually already holds this document and there is nothing to add.
  // Commit when it doesn't: an edit whose history push failed leaves the row
  // ahead of the repository, and what a reviewer reads has to be the document the
  // fork actually has. Titled with the proposal's own title, since that is what
  // the assistant is saying about this change.
  const pending = await pendingOps({ ...ctx, doc });
  if (pending.length) {
    await commitDoc({
      ...ctx,
      doc,
      author: await commitAuthor(api),
      message: `${clamp(title, PULL_TITLE_MAX)}\n\n${pending.map(describeOp).join("\n")}\n\n${assistantNote(client, "Made")}\n`,
    });
  }

  // Re-establish the pointer home. fork_lesson recorded the original's tip at
  // refs/remotes/upstream/main, but a packfile carries branches and nothing else,
  // so that ref did not survive the round trip through the hub. Fetching the
  // target's history again puts it back — and, more to the point, puts its
  // objects in the same store as ours, which is what lets findMergeBase walk both
  // sides back to the commit they share. Best-effort: without it the whole
  // document reads as the change, which is a worse summary but not a wrong one,
  // and no reason to refuse a proposal.
  const targetPack = await api.fetchLessonPack(target).catch(() => null);
  if (targetPack) {
    await fetchRemotePack({ ...ctx, ...targetPack, ref: UPSTREAM_REF });
  }

  // What the reviewer will see: this fork against the commit it diverged from,
  // which is the diff the proposal actually asks for — not merely whatever the
  // last edit did. A fork of a lesson that had no history shares no ancestor with
  // it, so there the whole document is the change.
  const changes = await proposedOps(ctx, doc);
  if (!changes.length) {
    throw new Error(
      "This fork is identical to the lesson it came from — there is nothing to propose. " +
        "Edit the fork first (patch_lesson on the fork's id), then try again.",
    );
  }

  // Two packs, because they answer two different questions. The proposal carries
  // the lesson as this fork has it and nothing else — a variation its author is
  // still turning over is not part of what is being offered. The fork's own
  // history, pushed further down, carries everything, because leaving a branch
  // out of that one would delete it.
  const proposed = await packRepo({ ...ctx, only: [DEFAULT_BRANCH] });
  const packed = await packRepo(ctx);

  // Is there already one open from this fork? An assistant asked for a further
  // change should update the proposal a human is already reading, not stack a
  // second one beside it — the review queue would then hold two overlapping
  // proposals and any discussion would be attached to the wrong one.
  //
  // Matched on the fork, not merely on the account: proposing to one lesson from
  // two different forks is legitimate, and those are not updates of each other.
  const existing = await api
    .listPulls(target)
    .then(({ pulls }) =>
      pulls.find(
        (p) =>
          p.status === "open" && p.ready && p.sourceLessonId === forkLessonId,
      ),
    )
    .catch(() => null);

  if (existing) {
    // Nothing has happened to the fork since the reviewer last looked. An upload
    // that didn't move the tip would bump the revision number on a proposal whose
    // contents are identical, which tells the reviewer to read a diff that isn't
    // there — and would let the assistant report a change it hasn't made.
    if (proposed.head === existing.head) {
      throw new Error(
        `Proposal ${existing.id} already holds exactly these changes, so there is nothing to add to it. ` +
          "Edit the fork first (patch_lesson on the fork's id), then try again.",
      );
    }

    // An update may only move the proposal *forward*: the new tip has to contain
    // the one it already points at. Usually it does — the fork's history is one
    // branch advancing — but not always. If an earlier proposal's history push
    // failed (it is best-effort, see pushForkHistory), this call cloned a pack
    // without that commit and built a sibling instead. Uploading it would drop
    // `previous_head` out of the history the pack carries, which is exactly the
    // invariant that lets one pack per proposal answer "what changed in this
    // update". The Worker cannot check this — it holds the pack opaquely — so it
    // is checked here.
    const forward = await contains({
      ...ctx,
      oid: proposed.head,
      ancestor: existing.head,
    });
    if (!forward) {
      throw new Error(
        `This fork's history no longer builds on proposal ${existing.id}, so updating it would replace ` +
          "what the reviewer has been reading rather than adding to it. Close that proposal in the web app " +
          "and call propose_changes again to open a fresh one.",
      );
    }

    const updated = await api.uploadPullPack(target, existing.id, {
      packfile: proposed.packfile,
      head: proposed.head,
    });
    return {
      pull: updated || existing,
      lessonId: target,
      commit: proposed.head,
      changes: changes.map(describeOp),
      historyPushed: await pushForkHistory(api, forkLessonId, packed, forkPack),
      updated: true,
    };
  }

  // The target's tip as it stands, recorded on the request so a reviewer can see
  // what it was built against. Informational: the merge finds its own base from
  // the shared ancestry.
  const base = await api.fetchLessonHead(target).catch(() => null);

  const pull = await api.createPull(target, {
    title: clamp(title, PULL_TITLE_MAX),
    body: proposalBody(body, client),
    head: proposed.head,
    base,
    sourceLessonId: forkLessonId,
  });

  let ready;
  try {
    ready = await api.uploadPullPack(target, pull.id, {
      packfile: proposed.packfile,
      head: proposed.head,
    });
  } catch (err) {
    await api.closePull(target, pull.id).catch(() => {});
    throw err;
  }

  // Only now advance the fork's own stored history, and don't let it fail the
  // call. The proposal does not depend on it — its pack is stored separately, and
  // that is what a reviewer merges — so this is bookkeeping: it usually has
  // nothing to do at all, since each edit committed itself, and it exists for the
  // catch-up commit above and for the edit whose own push failed.
  //
  // Still last, and for the same reason as before: a failure anywhere above
  // leaves the fork exactly as it was, so the retry simply works.
  const historyPushed = await pushForkHistory(
    api,
    forkLessonId,
    packed,
    forkPack,
  );

  return {
    pull: ready || pull,
    lessonId: target,
    commit: proposed.head,
    changes: changes.map(describeOp),
    historyPushed,
    updated: false,
  };
}

/**
 * The operations a proposal is asking for: the fork's document against the
 * commit it and the lesson last had in common.
 *
 * The merge base rather than either tip, because that is the comparison the
 * reviewer's three-way merge makes — a change the lesson has made since the fork
 * left is not something this proposal is asking for. Null when the two share no
 * ancestry (a fork of a lesson that had no history), where a reviewer sees the
 * whole document as the change and so does this.
 */
async function proposedOps(ctx, doc) {
  const ours = await headOid(ctx);
  const theirs = await headOid({ ...ctx, ref: UPSTREAM_REF });
  const base =
    ours && theirs ? await mergeBase({ ...ctx, ours, theirs }) : null;
  const baseDoc = base ? await readDocAt({ ...ctx, oid: base }) : null;
  return diffDocs(baseDoc, doc);
}

/**
 * Read a proposal without merging it: what it changes, and whether it would go
 * in cleanly.
 *
 * This is the server-side twin of prepareProposalReview (core/browser/git/sync.js),
 * which the proposal page in the web app draws from. The two answer the same two
 * questions off the same objects, and the only difference is where the repository
 * lives — LightningFS there, memory here. It is worth saying why they are not one
 * function: that one is bound to the browser's filesystem through repoCtx, and the
 * three calls it makes (fetchRemotePack, mergeBase, readDocAt) are the platform-
 * neutral ones this uses directly. Keeping the answers identical matters more than
 * sharing the wrapper, so review.test.js in core pins the shape both rely on.
 *
 * Nothing is written anywhere: no commit, no push, no branch moved. A reviewer
 * reading a proposal has not yet decided anything, and this must not act as
 * though they have.
 *
 * `ops` is the diff against the **merge base** rather than against the lesson's
 * tip — that is what the proposal is asking for, and the difference is not
 * cosmetic: compared against the tip, every change the lesson's own author has
 * made since the fork left shows up as though the proposer had made it.
 *
 * @returns {Promise<null | object>} null when the proposal's changes are no
 *          longer stored, which is what a resolved proposal looks like — its
 *          pack is dropped when it closes. Anything else throws.
 */
export async function reviewProposal(api, { lessonId, pullId }) {
  const ctx = memRepo();

  // The lesson's own history, so there is something to compare against. A lesson
  // with none (one written before version history) still gets a diff below —
  // just against its current document, which reads as "all of this is new".
  const lessonPack = await api.fetchLessonPack(lessonId).catch(() => null);
  if (lessonPack) {
    await fetchRemotePack({ ...ctx, ...lessonPack, ref: ORIGIN_REF });
  }

  const pack = await api.fetchPullPack(lessonId, pullId);
  if (!pack) return null;
  await fetchRemotePack({ ...ctx, ...pack, ref: pullRef(pullId) });

  const theirs = pack.head;
  const ours = lessonPack?.head || null;

  const base = ours ? await mergeBase({ ...ctx, ours, theirs }) : null;
  // Already landed: every commit the proposal carries is in the lesson's
  // history, so there is nothing left to merge — it went in some other way, or
  // it never diverged.
  const contained = ours
    ? await contains({ ...ctx, oid: ours, ancestor: theirs })
    : false;

  const [baseDoc, theirDoc] = await Promise.all([
    base ? readDocAt({ ...ctx, oid: base }) : Promise.resolve(null),
    readDocAt({ ...ctx, oid: theirs }),
  ]);

  // Our side is the lesson's ROW, not the doc at its stored tip — the two can
  // differ (an edit whose history push failed), and this is where the difference
  // would be felt: mergeProposal merges the row, so judging conflicts against
  // the tip could show a reviewer a live Merge button on a proposal that then
  // refuses. The web app can afford that split because its two answers come from
  // two different pages; here they are one card, and it has to be right.
  const lesson = await api.getLesson(lessonId);
  const current = stripLocalFields(lesson.doc || {});

  const ops = diffDocs(baseDoc || current, theirDoc);
  const merged = mergeDocs(baseDoc, current, theirDoc);

  return {
    // Both shapes, because two different readers want them: `changes` is the
    // wording the commit this becomes will carry (and what the web app's
    // proposal page renders), `counts` is the tally the view chips.
    changes: ops.map(describeOp),
    counts: tally(ops),
    conflicts: briefConflicts(merged.conflicts),
    auto: merged.auto,
    base,
    ours,
    theirs,
    contained,
    hasLesson: Boolean(ours),
  };
}

/**
 * A conflict as a reader needs it: which block, and which fields are contested.
 * The versions themselves are left out on purpose — resolving one means seeing
 * both side by side, which is the web app's dialog, and half of one here would
 * only invite deciding without looking.
 */
function briefConflicts(conflicts) {
  return (conflicts || []).map((c) => ({
    blockId: c.blockId,
    kind: c.kind,
    fields: (c.fields || []).map((f) => f.field || f),
  }));
}

/**
 * The counts a change is badged with: "3 added · 1 changed".
 *
 * Blocks only. Section and title operations are deliberately not tallied — they
 * are structure, they appear in the `changes` lines, and a chip reading "1
 * changed" for a renamed section beside "1 changed" for a rewritten question
 * would flatten a distinction that matters. Kept in step with ChangeSummary.jsx,
 * which does the same arithmetic for the web app's own proposal page.
 */
function tally(ops) {
  const counts = { added: 0, changed: 0, removed: 0, moved: 0 };
  for (const op of ops) {
    if (op.op === "block.add") counts.added++;
    else if (op.op === "block.edit") counts.changed++;
    else if (op.op === "block.remove") counts.removed++;
    else if (op.op === "block.move") counts.moved++;
  }
  return counts;
}

/**
 * Merge a proposal into the lesson it targets, and record it as merged.
 *
 * ---- Why this exists at all --------------------------------------------------
 *
 * Merging has always been the web app's job, and the reason was never that the
 * server couldn't do it: it is that the decision is the reviewer's, and an
 * assistant that merged on their behalf would be settling somebody else's
 * lesson. That reason survives here untouched. What changed is only *where the
 * reviewer can click* — the proposal view renders the diff in the conversation,
 * so the same human decision can be taken there instead of in another tab. The
 * tools that call this are `visibility: ["app"]` and refuse a host that never
 * drew the view; see registerTools.
 *
 * ---- The order is not a convention -----------------------------------------
 *
 * Push the merged history, save the lesson's document, then record the merge.
 * The Worker refuses to mark a proposal merged unless the merge commit is what
 * the lesson's stored history already points at (see mergePull in
 * apps/api/src/routes/pulls.js), so any other order simply fails. If the lesson
 * has moved on underneath us the push is refused rather than overwriting it, and
 * the proposal stays open for whoever pushed to merge it themselves.
 *
 * ---- Conflicts are not merged here ------------------------------------------
 *
 * A contested block is a question for a human with the two versions in front of
 * them, and the web app has the dialog for it. Rather than guess — or invent a
 * second conflict UI in an inline card — this refuses and says where to go. The
 * lesson is untouched when it does.
 *
 * @returns {Promise<object>} `{ merged: true, ... }`, or `{ merged: false }`
 *          with a `reason` of "gone" or "conflicts" — outcomes a reviewer needs
 *          reported, not raised. Anything genuinely wrong throws.
 */
export async function mergeProposal(api, { lessonId, pullId, title, client }) {
  const lessonPack = await api.fetchLessonPack(lessonId).catch(() => null);
  const lesson = await api.getLesson(lessonId);
  const current = stripLocalFields(lesson.doc || {});

  const pack = await api.fetchPullPack(lessonId, pullId);
  if (!pack) return { merged: false, reason: "gone" };

  const ctx = lessonPack ? await cloneRepo(lessonPack) : memRepo();
  const author = await commitAuthor(api);

  // The lesson's row can be ahead of its history — an edit whose history push
  // failed, or one made over MCP before edits were committed. Commit that drift
  // first, on its own, exactly as recordLessonHistory does: merging from the
  // stored tip while the row holds newer content would write the merge result
  // over that content and quietly revert it.
  await commitDoc({
    ...ctx,
    doc: current,
    author,
    message: lessonPack
      ? "Record the lesson as it was last saved\n\nBrings the history up to the lesson's stored document, which had changes no commit accounted for.\n"
      : "Record the lesson as it was last saved\n\nThis lesson had no stored history, so its existing content starts one.\n",
  });

  await fetchRemotePack({ ...ctx, ...pack, ref: pullRef(pullId) });

  const ours = await headOid(ctx);
  const theirs = pack.head;
  const base = await mergeBase({ ...ctx, ours, theirs });
  const [baseDoc, theirDoc] = await Promise.all([
    base ? readDocAt({ ...ctx, oid: base }) : Promise.resolve(null),
    readDocAt({ ...ctx, oid: theirs }),
  ]);

  const merged = mergeDocs(baseDoc, current, theirDoc);
  if (merged.conflicts.length) {
    return {
      merged: false,
      reason: "conflicts",
      conflicts: briefConflicts(merged.conflicts),
    };
  }

  // Local-only fields belong to the lesson they were named on and never travel
  // in a pack (core/git/doc.js), so the merged document has to take them back
  // from the lesson's own — a merge must not drop its trusted-collaborator list.
  const doc = preserveLocalFields(merged.doc, lesson.doc || {});
  const ops = diffDocs(current, doc);

  // Already contained: our history holds every commit the proposal has, so there
  // is no join to record and a merge commit would put a decision in the timeline
  // that nobody made. It still gets marked merged below — that is the true
  // status — against whatever the lesson's tip is.
  const commit = (await contains({ ...ctx, oid: ours, ancestor: theirs }))
    ? null
    : await commitDoc({
        ...ctx,
        doc,
        author,
        message:
          `Merge "${clamp(title || "proposed changes", 60)}"\n\n` +
          (ops.length ? `${ops.map(describeOp).join("\n")}\n\n` : "") +
          `${reviewerNote(client)}\n`,
        // Two parents, because that is what happened: two histories joined.
        parents: [ours, theirs],
      });

  const packed = await packRepo(ctx);
  if (packed.head !== lessonPack?.head) {
    await api.pushLessonPack(lessonId, {
      packfile: packed.packfile,
      head: packed.head,
      parent: lessonPack?.head || null,
      refs: packed.refs,
      expected: believedRefs(lessonPack),
    });
  }

  // The row, now that the history behind it is real. Skipped when the merge
  // changed nothing about the document (the contained case), so landing a
  // proposal that is already in cannot bump the lesson's saved timestamp.
  if (ops.length) {
    await api.updateLesson(lessonId, { title: lesson.title, doc });
  }

  const mergeCommit = await headOid(ctx);
  const pull = await api.mergePull(lessonId, pullId, mergeCommit);

  return {
    merged: true,
    pull,
    commit: mergeCommit,
    commitCreated: Boolean(commit),
    changes: ops.map(describeOp),
    auto: merged.auto,
  };
}

/**
 * Advance the fork's own stored history, and never let it fail the call.
 *
 * The proposal does not depend on it — its pack is stored separately, and that is
 * what a reviewer merges — so this is bookkeeping: it keeps the fork's History tab
 * honest and gives the next proposal this commit to build on.
 */
async function pushForkHistory(api, forkLessonId, packed, forkPack) {
  // The ordinary case now that each edit commits itself: this call added nothing,
  // so the hub already holds what we would send. Only the lesson's own branch can
  // have moved here — the clone is the only thing that touched this repository.
  if (packed.head === forkPack.head) return true;

  try {
    await api.pushLessonPack(forkLessonId, {
      packfile: packed.packfile,
      head: packed.head,
      parent: forkPack.head,
      // The fork may hold variations its author started in the editor. They came
      // down in the pack we cloned and are going back up in the one we packed, so
      // they are named here too — a push that mentioned only the lesson's own
      // branch would leave the hub advertising tips this pack no longer carries.
      refs: packed.refs,
      expected: believedRefs(forkPack),
    });
    return true;
  } catch {
    return false;
  }
}
