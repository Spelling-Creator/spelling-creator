// Lesson hub — a public, read-only gallery of lessons other users have
// published. Summaries come from the Worker (GET /lessons); clicking a card
// navigates to that lesson's own page (/hub/:id), where the full document is
// fetched and rendered. Each lesson therefore has a shareable URL.

import { hasApi } from "@spelling-creator/core/config";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link as RouterLink, useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  BookMarkedIcon,
  CloudIcon,
  FileTextIcon,
  PencilIcon,
  RefreshCwIcon,
  RssIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import PageBar from "../components/layout/PageBar.jsx";
import PageBody from "../components/layout/PageBody.jsx";
import IconActionButton from "../components/IconActionButton.jsx";
import { Button } from "../components/ui/button.jsx";
import { Badge } from "../components/ui/badge.jsx";
import { Alert, AlertDescription } from "../components/ui/alert.jsx";
import { Field, FieldLabel } from "../components/ui/field.jsx";
import { Input } from "../components/ui/input.jsx";
import { Spinner } from "../components/ui/spinner.jsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../components/ui/dialog.jsx";
import {
  fetchPublishedLessons,
  fetchMyLessons,
  deleteLesson,
  lessonsFeedUrl,
  EDIT_REQUEST_KEY,
} from "@spelling-creator/core/lessons";
import { LessonListSkeleton } from "../components/Skeletons.jsx";
import {
  buildLessonIndex,
  searchLessons,
} from "@spelling-creator/core/lessonSearch";
import { useAuth } from "../lib/auth.jsx";
import { DocumentMeta, JsonLd, buildLessonListSchema } from "../lib/seo.jsx";
import { useServerData, useSiteOrigin } from "../lib/ssr.jsx";

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// One lesson in a listing: an icon saying what it is, the title as the link,
// a meta line, and the owner's edit/delete controls at the end of the row.
//
// This was a card in a three-across grid, and the row is not only a denser
// shape — it's a simpler one. The card made the *whole tile* the link, which
// meant nothing interactive could be nested inside it: the author's name had to
// be a `role="link"` span faking a link with its own click and keydown handlers
// and a stopPropagation to keep the card from navigating too, and the owner's
// buttons had to be absolutely positioned over the top as siblings. With only
// the title as the link, the author is a plain <RouterLink> and the buttons are
// just the end of a flex row — no fake links, no overlay, and the two
// destinations a lesson row offers are both real, focusable anchors.
function LessonRow({ lesson, draft, editable, onEdit, onDelete }) {
  const { t } = useTranslation("hub");
  return (
    <div className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/50">
      {draft ? (
        <CloudIcon className="mt-0.5 size-4 shrink-0 text-focus" />
      ) : (
        <FileTextIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <RouterLink
            to={`/hub/${lesson.id}`}
            className="truncate text-sm font-semibold text-foreground no-underline hover:underline"
          >
            {lesson.title || t("card.untitledLesson")}
          </RouterLink>
          {draft && (
            <Badge
              variant="outline"
              className="border-focus/40 bg-focus/10 text-focus"
            >
              {t("card.draftBadge")}
            </Badge>
          )}
        </div>

        <p className="mt-0.5 text-xs text-muted-foreground">
          {!draft &&
            (lesson.authorId ? (
              <RouterLink
                to={`/users/${lesson.authorId}`}
                className="text-inherit no-underline hover:underline"
              >
                {lesson.author || t("card.anonymousAuthor")}
              </RouterLink>
            ) : (
              lesson.author || t("card.anonymousAuthor")
            ))}
          {!draft && " · "}
          {typeof lesson.sectionCount === "number"
            ? t("card.sectionCount", { count: lesson.sectionCount })
            : ""}
          {lesson.createdAt ? ` · ${formatDate(lesson.createdAt)}` : ""}
        </p>
      </div>

      {editable && (
        <div className="flex shrink-0 gap-0.5">
          <IconActionButton
            tooltip={
              draft ? t("card.editDraftTooltip") : t("card.editLessonTooltip")
            }
            aria-label={
              draft ? t("card.editDraftAria") : t("card.editLessonAria")
            }
            onClick={(e) => onEdit(e, lesson)}
          >
            <PencilIcon />
          </IconActionButton>
          <IconActionButton
            tooltip={
              draft
                ? t("card.deleteDraftTooltip")
                : t("card.deleteLessonTooltip")
            }
            aria-label={
              draft ? t("card.deleteDraftAria") : t("card.deleteLessonAria")
            }
            onClick={(e) => onDelete(e, lesson)}
            destructive
          >
            <Trash2Icon />
          </IconActionButton>
        </div>
      )}
    </div>
  );
}

export default function HubPage() {
  const { t } = useTranslation("hub");
  const { user, accessToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const origin = useSiteOrigin();

  // The published listing the Worker already fetched and rendered, on a
  // server-rendered page load. undefined otherwise — see lib/ssr.jsx.
  const serverLessons = useServerData("lessons");

  const [lessons, setLessons] = useState(serverLessons ?? []);
  const [loading, setLoading] = useState(!serverLessons);
  const [error, setError] = useState("");

  // The signed-in user's own drafts (lessons backed up to the cloud but not
  // published). They're excluded from the public listing above, so we fetch them
  // separately and show them in their own section. Failing to load them is
  // non-fatal — drafts are a convenience on top of browsing the public hub.
  const [drafts, setDrafts] = useState([]);

  // Client-side search. `query` is what the user typed; `debouncedQuery` lags it
  // by 200ms so we don't re-run the index on every keystroke. The Fuse index is
  // rebuilt only when the lesson list changes.
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const searchIndex = useMemo(() => buildLessonIndex(lessons), [lessons]);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(id);
  }, [query]);

  // null when the box is empty -> show the full, newest-first listing.
  const searchResults = useMemo(
    () => searchLessons(searchIndex, debouncedQuery),
    [searchIndex, debouncedQuery],
  );
  const visibleLessons = searchResults ?? lessons;
  const searching = searchResults !== null;

  // schema.org Course-list carousel for the published lessons — the still-
  // supported Course rich result (the per-lesson "Course info" markup was
  // retired by Google in Sept 2025). Each entry embeds a full named Course, as
  // the carousel requires. We always describe the full published set (not the
  // transient search view), and the builder emits nothing below Google's three-
  // course minimum.
  const listSchema = buildLessonListSchema({ lessons, origin });

  // Delete-confirmation dialog. `deleting` holds the lesson summary being
  // deleted (null when closed); the user must retype its title to confirm, which
  // guards against an accidental, irreversible delete. `deleteText` is what they
  // typed, `deleteBusy` disables the action while the request is in flight.
  const [deleting, setDeleting] = useState(null);
  const [deleteText, setDeleteText] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setLessons(await fetchPublishedLessons());
    } catch (err) {
      setError(err.message || t("errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadDrafts = useCallback(async () => {
    if (!accessToken) {
      setDrafts([]);
      return;
    }
    try {
      const mine = await fetchMyLessons(accessToken);
      setDrafts(mine.filter((l) => l.published === false));
    } catch {
      setDrafts([]); // non-fatal — the public listing still works
    }
  }, [accessToken]);

  // The published hub is public, so the Worker's copy is the same listing this
  // would fetch — no reason to ask for it again on a server-rendered load. Held
  // until something actually re-fetches rather than being spent on the first
  // effect run, which fires again whenever `load` changes identity.
  const haveServerLessons = useRef(Boolean(serverLessons));

  useEffect(() => {
    if (!hasApi()) {
      setLoading(false);
      return;
    }
    if (haveServerLessons.current) return;
    load();
  }, [load]);

  // Load (or clear) the user's drafts whenever their sign-in state changes.
  useEffect(() => {
    if (hasApi()) loadDrafts();
  }, [loadDrafts]);

  // The lesson page hands us a one-shot toast (e.g. after a delete) via router
  // state when it navigates back here. Show it once, then clear the state so it
  // doesn't reappear on refresh or back-navigation.
  useEffect(() => {
    const deletedTitle = location.state?.deletedTitle;
    if (deletedTitle) {
      toast(t("toast.deleted", { title: deletedTitle }));
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location, navigate, t]);

  // Send the user to the editor to edit one of their own lessons. The editor
  // fetches the full lesson and warns before replacing any in-progress work, so
  // we only hand it which lesson to load (via sessionStorage, consumed once on
  // the editor's mount). stopPropagation keeps the card's preview click from
  // also firing.
  const editLesson = (e, summary) => {
    e.stopPropagation();
    try {
      sessionStorage.setItem(EDIT_REQUEST_KEY, summary.id);
    } catch {
      /* ignore — navigation below still works, the editor just won't preload */
    }
    navigate("/editor");
  };

  // Open the delete-confirmation dialog for one of the user's own lessons.
  // stopPropagation keeps the card's preview click from also firing.
  const askDelete = (e, summary) => {
    e.stopPropagation();
    setDeleting(summary);
    setDeleteText("");
    setDeleteError("");
  };

  const closeDelete = () => {
    if (deleteBusy) return; // don't abandon an in-flight request
    setDeleting(null);
  };

  // The title the user must type to confirm. Mirrors the fallback the card and
  // backend use for an untitled lesson, so an "Untitled Lesson" card is
  // confirmable by typing exactly that.
  const deleteTarget = deleting
    ? deleting.title || t("card.untitledLesson")
    : "";
  const deleteConfirmed = deleteText.trim() === deleteTarget;

  const confirmDelete = async () => {
    if (!deleting || !deleteConfirmed) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteLesson(deleting.id, accessToken);
      // Drop it from whichever list held it (published gallery or drafts) so it
      // disappears immediately.
      setLessons((prev) => prev.filter((l) => l.id !== deleting.id));
      setDrafts((prev) => prev.filter((l) => l.id !== deleting.id));
      toast(t("toast.deleted", { title: deleteTarget }));
      setDeleting(null);
    } catch (err) {
      setDeleteError(err.message || t("errors.deleteFailed"));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <>
      <DocumentMeta
        title={t("meta.title")}
        description={t("meta.description")}
      />
      <JsonLd data={listSchema} />
      {/* The "Editor" link that used to sit on the left of this bar is now the
          sidebar's "New lesson" action, which every page has. */}
      <PageBar crumbs={[{ label: t("header.title") }]} />

      <PageBody>
        <div className="mb-4 flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {t("toolbar.description")}
          </p>
          {hasApi() && (
            <div className="flex shrink-0 items-center gap-0.5">
              <IconActionButton
                tooltip={t("toolbar.feedTooltip")}
                aria-label={t("toolbar.feedAria")}
                asChild
              >
                <a
                  href={lessonsFeedUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <RssIcon />
                </a>
              </IconActionButton>
              <IconActionButton
                tooltip={t("toolbar.refreshTooltip")}
                aria-label={t("toolbar.refreshAria")}
                disabled={loading}
                onClick={() => {
                  load();
                  loadDrafts();
                }}
              >
                <RefreshCwIcon />
              </IconActionButton>
            </div>
          )}
        </div>

        {hasApi() &&
          drafts.length > 0 && (
            // The heading moved inside the box, onto a tinted strip, and it is
            // the pattern every listing on the page now follows: the box has an
            // edge, and the strip says what is in it and how much. Stacked
            // headings floating above borderless grids were exactly what stopped
            // scaling once the hub held more than a screenful.
            <div className="mb-6 overflow-hidden rounded-panel border border-border bg-card">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface-muted px-4 py-2.5">
                <CloudIcon className="size-4 shrink-0 text-focus" />
                <h2 className="text-sm font-semibold">{t("drafts.heading")}</h2>
                <span className="text-xs text-muted-foreground">
                  {t("list.count", { count: drafts.length })}
                </span>
                <p className="w-full text-xs text-muted-foreground sm:w-auto">
                  {t("drafts.description")}
                </p>
              </div>
              <div className="flex flex-col divide-y divide-border">
                {drafts.map((lesson) => (
                  <LessonRow
                    key={lesson.id}
                    lesson={lesson}
                    draft
                    editable
                    onEdit={editLesson}
                    onDelete={askDelete}
                  />
                ))}
              </div>
            </div>
          )}

        {/* Present while loading too, disabled — not gated on `!loading`.
            There is nothing to search yet, but the field is 52px of layout and
            appearing only once the fetch lands pushed the whole listing down
            at the moment the content arrived. That is the same shift the
            listing's skeleton exists to prevent, and the larger half of it. */}
        {hasApi() && !error && (loading || lessons.length > 0) && (
          <Field className="mb-4">
            <FieldLabel htmlFor="hub-search" className="sr-only">
              {t("search.label")}
            </FieldLabel>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="hub-search"
                placeholder={t("search.placeholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={loading}
                className="pl-9 pr-9"
              />
              {query && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("search.clearAria")}
                  onClick={() => setQuery("")}
                  className="absolute top-1/2 right-1 -translate-y-1/2"
                >
                  <XIcon />
                </Button>
              )}
            </div>
          </Field>
        )}

        {!hasApi() && (
          <Alert className="border-primary/40 bg-primary/10 text-primary">
            <AlertDescription className="text-primary">
              {t("alerts.hubDisabled")}
            </AlertDescription>
          </Alert>
        )}

        {hasApi() && error && (
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-2">
              {error}
              <Button variant="ghost" size="sm" onClick={load}>
                {t("alerts.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {hasApi() && loading && <LessonListSkeleton />}

        {hasApi() && !loading && !error && lessons.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-12 text-center">
            <p className="mb-1 text-lg font-semibold">
              {t("emptyState.noLessonsTitle")}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("emptyState.noLessonsHintPrefix")}{" "}
              <strong>{t("emptyState.publishToHub")}</strong>.
            </p>
          </div>
        )}

        {hasApi() &&
          !loading &&
          !error &&
          lessons.length > 0 &&
          searching &&
          visibleLessons.length === 0 && (
            <div className="rounded-md border border-dashed border-border p-12 text-center">
              <p className="mb-1 text-lg font-semibold">
                {t("emptyState.noMatchesTitle")}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("emptyState.noMatchesHint", { query: debouncedQuery })}
              </p>
            </div>
          )}

        {hasApi() && !loading && !error && visibleLessons.length > 0 && (
          <div className="overflow-hidden rounded-panel border border-border bg-card">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface-muted px-4 py-2.5">
              <BookMarkedIcon className="size-4 shrink-0 text-muted-foreground" />
              <h2 className="text-sm font-semibold">
                {t("list.publishedHeading")}
              </h2>
              {/* The count is of what's on screen, so it stays true while a
                  search is narrowing the list rather than reporting a total
                  nobody can see. */}
              <span className="text-xs text-muted-foreground">
                {t("list.count", { count: visibleLessons.length })}
              </span>
            </div>
            <div className="flex flex-col divide-y divide-border">
              {visibleLessons.map((lesson) => (
                <LessonRow
                  key={lesson.id}
                  lesson={lesson}
                  editable={Boolean(
                    user && lesson.authorId && lesson.authorId === user.id,
                  )}
                  onEdit={editLesson}
                  onDelete={askDelete}
                />
              ))}
            </div>
          </div>
        )}
      </PageBody>

      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(next) => !next && closeDelete()}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("deleteDialog.title")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("deleteDialog.confirmPrefix")} <strong>{deleteTarget}</strong>.{" "}
            {t("deleteDialog.confirmSuffix")}
          </p>
          <Field>
            <FieldLabel htmlFor="hub-delete-name" className="sr-only">
              {t("deleteDialog.nameLabel")}
            </FieldLabel>
            <Input
              id="hub-delete-name"
              autoFocus
              placeholder={deleteTarget}
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && deleteConfirmed && !deleteBusy) {
                  confirmDelete();
                }
              }}
              disabled={deleteBusy}
            />
          </Field>
          {deleteError && (
            <Alert variant="destructive">
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeDelete}
              disabled={deleteBusy}
            >
              {t("deleteDialog.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={!deleteConfirmed || deleteBusy}
            >
              {deleteBusy ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Trash2Icon data-icon="inline-start" />
              )}
              {t("deleteDialog.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
