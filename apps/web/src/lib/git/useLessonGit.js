// The editor's version-control controller, as React sees it.
//
// The controller itself (repository setup, the periodic commits, history,
// restore and variations) is createLessonHistory in
// @spelling-creator/core/browser/git/lessonHistory, which knows nothing about
// React and takes the git engine as a loader, so load.js keeps isomorphic-git
// behind its dynamic import. What is left here is the wiring: one controller
// per editor, the lesson opened as the props name it, the document and the
// identity fed to it as they change, its snapshot read as state, and the
// controller closed with the editor. See
// apps/docs/docs/developers/version-history.md.

import { useEffect, useState } from "react";
import { createLessonHistory } from "@spelling-creator/core/browser/git/lessonHistory";
import { repoIdFor } from "@spelling-creator/core/git/doc";
import { DEFAULT_BRANCH } from "@spelling-creator/core/git/refs";
import { useStore } from "../useStore.js";
import { loadGitEngine } from "./load.js";

/**
 * @param {object}  opts.doc         The live editor document.
 * @param {string}  [opts.editingId] The hub lesson being edited, if any.
 * @param {string}  [opts.localId]   The lesson's id in this device's library:
 *                                   the repository it uses until it's published.
 * @param {object}  [opts.identity]  { uid, name }: stamped on commits.
 * @param {object}  [opts.coAuthors] A live session's `coAuthors` (core/browser/collabSession):
 *                                   who else's edits a commit holds, credited
 *                                   with a `Co-authored-by` trailer each.
 * @param {boolean} [opts.enabled]   Set false to disable version control entirely.
 */
export function useLessonGit({
  doc,
  editingId,
  localId,
  identity,
  coAuthors,
  enabled = true,
}) {
  const [history] = useState(() =>
    createLessonHistory({
      loadEngine: loadGitEngine,
      doc,
      identity,
      coAuthors,
    }),
  );

  // The latest identity, co-author list and document, for the commits that
  // run later than the render that produced them.
  useEffect(() => {
    history.setIdentity(identity);
  }, [history, identity]);
  useEffect(() => {
    history.setCoAuthors(coAuthors);
  }, [history, coAuthors]);
  useEffect(() => {
    history.setDoc(doc);
  }, [history, doc]);

  // Which lesson's history. Every flow that swaps a repository out (a fork, an
  // import, a duplicate) does it by opening a *new* lesson, which changes the
  // ids here and so opens the other lesson's repository on its own.
  useEffect(() => {
    if (!enabled) {
      history.close();
      return;
    }
    history.open({ editingId, localId });
  }, [history, editingId, localId, enabled]);

  // No more periodic commits once the editor is gone.
  useEffect(() => () => history.close(), [history]);

  const { ready, pending, lastCommit, error, branch, branches } =
    useStore(history);

  return {
    ready,
    pending,
    lastCommit,
    error,
    clearError: history.clearError,
    repoId: repoIdFor(editingId, localId),
    branch,
    branches,
    onDefaultBranch: branch === DEFAULT_BRANCH,
    refreshBranches: history.refreshBranches,
    switchBranch: history.switchBranch,
    createVariation: history.createVariation,
    renameVariation: history.renameVariation,
    deleteVariation: history.deleteVariation,
    commitNow: history.commitNow,
    loadHistory: history.loadHistory,
    diffFor: history.diffFor,
    diffAgainstCurrent: history.diffAgainstCurrent,
    restore: history.restore,
    adoptDraft: history.adoptDraft,
    /** Queue work against this lesson's repo (used by the fork/merge flows). */
    run: history.run,
  };
}
