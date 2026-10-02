// The lessons this device is holding, and the way between them.
//
// The editor used to have exactly one working document, so "open a lesson" and
// "throw away what you were doing" were the same act, hence the old "Replace
// your current work?" warning. IndexedDB has no reason to hold one lesson rather
// than fifty (see core/browser/storage.js), so it holds as many as are made and
// this is the list of them: open, copy, rename, delete, start another.
//
// This was a dialog over the editor (/editor/lessons) until it became a page of
// its own. A page is what the header's "On this device" link always promised: a
// destination, reachable without loading a lesson first, with room for a long
// list. It also means none of this needs the editor mounted. Every action here
// works on the library directly, and the editor picks up whatever changed the
// next time it hydrates, which it does on every visit (EditorPage reads the
// current lesson from storage on mount).
//
// Every row is a whole lesson (its document, its images and its git repository)
// so the only destructive action here is deleting one, and that asks twice, the
// same way VariationsDialog does.

import { useCallback, useEffect, useRef, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  CheckIcon,
  CloudIcon,
  CloudUploadIcon,
  CopyIcon,
  LibraryIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  MoreHorizontalIcon,
} from "lucide-react";
import {
  listLessons,
  getLesson,
  createLesson,
  saveLessonDoc,
  deleteLesson,
  getCurrentLessonId,
  setCurrentLessonId,
  migrateLocalStorage,
  migrateToLibrary,
} from "@spelling-creator/core/browser/storage";
import { repoIdFor } from "@spelling-creator/core/git/doc";
import { loadGitEngine } from "../lib/git/load.js";
import PageBody from "../components/layout/PageBody.jsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.jsx";
import { Alert, AlertDescription } from "../components/ui/alert.jsx";
import { Badge } from "../components/ui/badge.jsx";
import { Button } from "../components/ui/button.jsx";
import { Input } from "../components/ui/input.jsx";
import { Skeleton } from "../components/ui/skeleton.jsx";
import { cn } from "../lib/utils.js";
import { timeAgo } from "../components/HistoryDialog.jsx";

// Shaped like the rows it stands in for, so the list doesn't jump when the
// library arrives.
function LibrarySkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-16 rounded-md" />
      ))}
    </div>
  );
}

export default function LibraryPage() {
  const { t } = useTranslation("library");
  const navigate = useNavigate();

  // The library, newest first, or null while it is being read.
  const [lessons, setLessons] = useState(null);
  // The lesson the editor last had open, which is the one it opens next.
  const [currentId, setCurrentId] = useState(null);
  // The lesson being retitled, and the title being typed. One at a time: two
  // open name fields in a list is a puzzle rather than a feature.
  const [naming, setNaming] = useState(null);
  const [name, setName] = useState("");
  // The lesson awaiting a second press before it goes. Deleting one takes its
  // document, its local images and its whole version history with it, and there
  // is no undo for that here.
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(null);
  // Every action here optimistically closes its own bit of UI (the name field,
  // the delete confirmation) before the write it triggered has finished. When
  // one fails, that leaves a list that looks changed and isn't, so the failure is
  // shown rather than swallowed (as VariationsDialog does with its own).
  const [error, setError] = useState(null);
  // Set by the two menu actions that replace this row's menu trigger with a
  // control of their own. See the closing-focus note on DropdownMenuContent.
  const replacesTriggerRef = useRef(false);

  const refresh = useCallback(async () => {
    const [list, current] = await Promise.all([
      listLessons(),
      getCurrentLessonId(),
    ]);
    setLessons(list);
    setCurrentId(current);
  }, []);

  // This can be the first page someone opens on a device that has only ever
  // used the old single-document editor, so the same two migrations the editor
  // runs on mount run here too. Both are idempotent no-ops once done.
  useEffect(() => {
    (async () => {
      try {
        await migrateLocalStorage();
        await migrateToLibrary();
        await refresh();
      } catch (err) {
        setLessons([]);
        setError(t("unavailable"));
        console.error("[lessons] could not open this device's library", err);
      }
    })();
  }, [refresh, t]);

  const run = useCallback(async (id, work) => {
    setBusy(id);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }, []);

  // Opening a lesson is choosing which one the editor hydrates with. The editor
  // isn't mounted while this page is, so there is nothing on screen to save
  // first and no reason to go through ?local=<id>, which would show the old
  // lesson for a moment before switching.
  const openLesson = useCallback(
    (id) =>
      run(id, async () => {
        await setCurrentLessonId(id);
        navigate("/editor");
      }),
    [navigate, run],
  );

  const renameLesson = useCallback(async (id, title) => {
    const record = await getLesson(id);
    if (record?.doc) await saveLessonDoc(id, { ...record.doc, title });
  }, []);

  const duplicateLesson = useCallback(
    async (id) => {
      const source = await getLesson(id);
      if (!source) return;
      const doc = {
        ...(source.doc || { title: "", sections: [] }),
        title: t("copyOf", { title: source.doc?.title || t("untitled") }),
      };
      // Unattached on purpose: a copy is a lesson of its own, so saving it to
      // the cloud creates a separate one rather than overwriting what it was
      // copied from, while remembering what that was so the two can still be
      // merged later.
      const record = await createLesson({
        doc,
        forkedFrom: source.lessonId || source.forkedFrom || null,
      });
      try {
        // A real clone of the repository, not just of the text: the copy keeps
        // the original's history and shares its commit oids.
        const engine = await loadGitEngine();
        await engine.forkLocalRepo(
          repoIdFor(source.lessonId, source.id),
          record.id,
        );
      } catch {
        /* no history to carry over, so the copy starts a fresh one */
      }
    },
    [t],
  );

  const removeLesson = useCallback(async (id) => {
    const record = await getLesson(id);
    // Also clears the current lesson if this was it. The editor then opens the
    // most recent one left, or makes a new one if there are none.
    await deleteLesson(id);
    try {
      const engine = await loadGitEngine();
      // The local repository only. A lesson that reached the cloud keeps its
      // history there, and the lesson page clones it back on demand.
      //
      // Both possible names for it: a published lesson's repository lives under
      // its hub id, but one left under the lesson's own id (by an adoption that
      // found the destination already taken and returned rather than merge two
      // histories) would otherwise be unreachable for ever, since nothing else
      // ever looks there again.
      await engine.deleteRepo(repoIdFor(record?.lessonId, id));
      if (record?.lessonId) await engine.deleteRepo(id);
    } catch {
      /* the repo may never have existed */
    }
  }, []);

  const submitName = useCallback(async () => {
    const title = name.trim();
    const id = naming;
    setNaming(null);
    setName("");
    if (!id || !title) return;
    await run(id, async () => {
      await renameLesson(id, title);
      await refresh();
    });
  }, [name, naming, refresh, renameLesson, run]);

  return (
    <PageBody width="reading">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
        <div className="min-w-0 sm:flex-1">
          <h1 className="text-2xl font-bold md:text-3xl">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("description")}
          </p>
        </div>
        {/* ?new=1 rather than making the lesson here: the editor knows when the
            one it would open is still untouched, and reuses it instead of
            leaving untitled empties behind (see startNewLesson in EditorPage). */}
        <Button asChild className="shrink-0">
          <RouterLink to="/editor?new=1" className="no-underline">
            <PlusIcon data-icon="inline-start" />
            {t("newLesson")}
          </RouterLink>
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mt-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="mt-6">
        {lessons === null ? (
          <LibrarySkeleton />
        ) : lessons.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-md border border-dashed px-4 py-12 text-center">
            <LibraryIcon
              className="size-8 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          </div>
        ) : (
          <ul className="flex list-none flex-col gap-2 p-0">
            {lessons.map((lesson) => {
              const isCurrent = lesson.id === currentId;
              const title = lesson.title || t("untitled");
              return (
                <li
                  key={lesson.id}
                  className={cn(
                    "flex items-center gap-2 rounded-md border bg-card p-3",
                    isCurrent
                      ? "border-primary/40 bg-primary/5"
                      : "border-border",
                  )}
                >
                  {naming === lesson.id ? (
                    <Input
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onBlur={submitName}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitName();
                        if (e.key === "Escape") setNaming(null);
                      }}
                      aria-label={t("titleLabel")}
                      className="h-9"
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => openLesson(lesson.id)}
                        disabled={busy !== null}
                        className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left"
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{title}</span>
                          {isCurrent && (
                            <>
                              <CheckIcon
                                className="size-4 shrink-0 text-primary"
                                aria-hidden="true"
                              />
                              <span className="sr-only">{t("current")}</span>
                            </>
                          )}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          <span>
                            {t("stats", {
                              sections: t("sectionsCount", {
                                count: lesson.sections || 0,
                              }),
                              blocks: t("blocksCount", {
                                count: lesson.blocks || 0,
                              }),
                            })}
                          </span>
                          {lesson.updatedAt && (
                            <span>
                              {t("edited", {
                                time: timeAgo(lesson.updatedAt),
                              })}
                            </span>
                          )}
                        </span>
                      </button>

                      {/* Where this lesson lives besides here. A lesson with no
                          badge exists on this device only, which is worth
                          knowing before clearing your browser data. */}
                      {lesson.lessonId && (
                        <Badge
                          variant="outline"
                          className="hidden shrink-0 gap-1 sm:inline-flex"
                        >
                          {lesson.published === false ? (
                            <CloudIcon />
                          ) : (
                            <CloudUploadIcon />
                          )}
                          {lesson.published === false
                            ? t("cloudDraft")
                            : t("published")}
                        </Badge>
                      )}

                      {confirming === lesson.id ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            autoFocus
                            size="sm"
                            variant="destructive"
                            disabled={busy !== null}
                            onClick={() =>
                              run(lesson.id, async () => {
                                setConfirming(null);
                                await removeLesson(lesson.id);
                                await refresh();
                              })
                            }
                          >
                            {t("confirmDelete")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy !== null}
                            onClick={() => setConfirming(null)}
                          >
                            {t("keepIt")}
                          </Button>
                        </div>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              disabled={busy !== null}
                              aria-label={t("rowActions", { title })}
                            >
                              <MoreHorizontalIcon />
                            </Button>
                          </DropdownMenuTrigger>
                          {/* Rename and Delete unmount this menu's trigger (one
                              swaps the row for a name field, the other for a
                              confirmation) so Radix's closing focus would land
                              on an element that no longer exists, dropping the
                              keyboard user out of the list to the body. Decline
                              it for those two and let the control that replaced
                              the trigger take focus itself. Duplicate leaves the
                              trigger where it is, so Radix's own restoration is
                              what's wanted there. */}
                          <DropdownMenuContent
                            align="end"
                            onCloseAutoFocus={(e) => {
                              if (!replacesTriggerRef.current) return;
                              replacesTriggerRef.current = false;
                              e.preventDefault();
                            }}
                          >
                            <DropdownMenuItem
                              onClick={() => {
                                replacesTriggerRef.current = true;
                                setName(lesson.title || "");
                                setNaming(lesson.id);
                              }}
                            >
                              <PencilIcon />
                              {t("rename")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                run(lesson.id, async () => {
                                  await duplicateLesson(lesson.id);
                                  await refresh();
                                })
                              }
                            >
                              <CopyIcon />
                              {t("duplicate")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => {
                                replacesTriggerRef.current = true;
                                setConfirming(lesson.id);
                              }}
                            >
                              <Trash2Icon />
                              {t("delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Deleting a lesson takes its history with it, and none of this is
          backed up anywhere unless the lesson has been saved to the cloud. Say
          so once, here, rather than in each row. */}
      <p className="mt-6 text-xs text-muted-foreground">{t("storageNote")}</p>
    </PageBody>
  );
}
