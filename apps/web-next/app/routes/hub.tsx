// Lesson hub: a public, read-only gallery of lessons other users have
// published. Summaries come from the Worker (GET /lessons), fetched by the
// loader so the listing is in the served HTML; clicking a row navigates to
// that lesson's own page (/hub/:id). A signed-in author's own drafts, which
// the public listing leaves out, are fetched in the browser after
// hydration, since the server renders anonymously.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  BookMarkedIcon,
  CloudIcon,
  FileTextIcon,
  GlobeIcon,
  PencilIcon,
  RefreshCwIcon,
  RssIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { hasApi } from "@spelling-creator/core/config";
import {
  fetchPublishedLessons,
  fetchMyLessons,
  deleteLesson,
  lessonsFeedUrl,
  remoteForkAvailable,
  EDIT_REQUEST_KEY,
  REMOTE_FORK_REQUEST_KEY,
  type LessonSummary,
} from "@spelling-creator/core/lessons";
import {
  buildLessonIndex,
  searchLessons,
} from "@spelling-creator/core/lessonSearch";
import type { Route } from "./+types/hub";
import PageBody from "@/components/layout/PageBody";
import IconActionButton from "@/components/IconActionButton";
import RouteErrorBoundary from "@/components/RouteErrorBoundary";
import { LessonListSkeleton } from "@/components/Skeletons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { i18n } from "@/lib/i18n";
import { buildLessonListSchema, jsonLd, pageMeta } from "@/lib/seo";
import { siteOriginOf } from "@/lib/site";
import { useHydrated } from "@/lib/useHydrated";

// The published listing. A failure is the page's to show (with a retry),
// not the error boundary's: the hub is the site's front door, and an
// alert in the usual chrome is a better answer than an error page.
export async function loader() {
  if (!hasApi()) return { lessons: null, error: "" };
  try {
    return { lessons: await fetchPublishedLessons(), error: "" };
  } catch (err) {
    return {
      lessons: null,
      error: errorMessage(err, i18n.t("hub:errors.loadFailed")),
    };
  }
}

// schema.org ItemList of the published lessons, each embedded as a full
// LearningResource (see lib/seo.ts for why not Course). Always the full
// published set, never the transient search view.
export const meta: Route.MetaFunction = ({ loaderData, location, matches }) => {
  const origin = siteOriginOf(matches);
  return [
    ...pageMeta({
      origin,
      pathname: location.pathname,
      title: i18n.t("hub:meta.title"),
      description: i18n.t("hub:meta.description"),
    }),
    ...jsonLd(buildLessonListSchema({ lessons: loaderData?.lessons, origin })),
  ];
};

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteErrorBoundary error={error} />;
}

// One lesson in a listing: an icon saying what it is, the title as the
// link, a meta line, and the owner's edit and delete controls at the end of
// the row. Only the title is the link, so the author is a plain link too and
// the buttons are just the end of a flex row: no fake links, no overlay.
function LessonRow({
  lesson,
  draft = false,
  editable = false,
  onEdit,
  onDelete,
}: {
  lesson: LessonSummary;
  draft?: boolean;
  editable?: boolean;
  onEdit: (lesson: LessonSummary) => void;
  onDelete: (lesson: LessonSummary) => void;
}) {
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
          <Link
            to={`/hub/${lesson.id}`}
            className="truncate text-sm font-semibold text-foreground no-underline hover:underline"
          >
            {lesson.title || t("card.untitledLesson")}
          </Link>
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
              <Link
                to={`/users/${lesson.authorId}`}
                className="text-inherit no-underline hover:underline"
              >
                {lesson.author || t("card.anonymousAuthor")}
              </Link>
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
            onClick={() => onEdit(lesson)}
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
            onClick={() => onDelete(lesson)}
            destructive
          >
            <Trash2Icon />
          </IconActionButton>
        </div>
      )}
    </div>
  );
}

export default function Hub({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("hub");
  const { user, accessToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // "Copy a lesson from another instance": the address of a lesson on
  // another hub, to fork here. The hub only collects the address; the editor
  // fetches the lesson through this hub's API and lands it as a fork. The
  // API reads on the signed-in caller's behalf, so the dialog asks for a
  // sign-in first. The button only shows once this instance has said it
  // federates.
  const [remoteAvailable, setRemoteAvailable] = useState(false);
  useEffect(() => {
    if (!hasApi()) return undefined;
    let current = true;
    remoteForkAvailable().then((available) => {
      if (current) setRemoteAvailable(available);
    });
    return () => {
      current = false;
    };
  }, []);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [remoteError, setRemoteError] = useState("");
  const openRemote = () => {
    setRemoteUrl("");
    setRemoteError("");
    setRemoteOpen(true);
  };
  const forkRemote = (e: FormEvent) => {
    e.preventDefault();
    const raw = remoteUrl.trim();
    let parsed: URL | null = null;
    try {
      parsed = new URL(raw);
    } catch {
      parsed = null;
    }
    if (!parsed || !/^https?:$/.test(parsed.protocol)) {
      setRemoteError(t("remoteDialog.invalid"));
      return;
    }
    if (!user) {
      setRemoteError(t("remoteDialog.signIn"));
      return;
    }
    try {
      sessionStorage.setItem(REMOTE_FORK_REQUEST_KEY, parsed.href);
    } catch {
      setRemoteError(t("remoteDialog.storageUnavailable"));
      return;
    }
    navigate("/editor");
  };

  // The published listing, seeded from the loader; refetched in the browser
  // only when someone asks (Refresh, Retry).
  const [lessons, setLessons] = useState<LessonSummary[]>(
    loaderData.lessons ?? [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(loaderData.error);

  // The signed-in user's own drafts (lessons backed up to the cloud but not
  // published). Excluded from the public listing above, so fetched
  // separately and shown in their own section. Failing to load them is
  // non-fatal.
  const [drafts, setDrafts] = useState<LessonSummary[]>([]);

  // Client-side search. `query` is what the user typed; `debouncedQuery`
  // lags it by 200ms so the index isn't queried on every keystroke. The
  // index is rebuilt only when the lesson list changes.
  const hydrated = useHydrated();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const searchIndex = useMemo(() => buildLessonIndex(lessons), [lessons]);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(id);
  }, [query]);

  // null when the box is empty: show the full, newest-first listing.
  const searchResults = useMemo(
    () => searchLessons(searchIndex, debouncedQuery),
    [searchIndex, debouncedQuery],
  );
  const visibleLessons = searchResults ?? lessons;
  const searching = searchResults !== null;

  // Delete-confirmation dialog. `deleting` holds the lesson being deleted
  // (null when closed); the user must retype its title to confirm, which
  // guards against an accidental, irreversible delete.
  const [deleting, setDeleting] = useState<LessonSummary | null>(null);
  const [deleteText, setDeleteText] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setLessons(await fetchPublishedLessons());
    } catch (err) {
      setError(errorMessage(err, t("errors.loadFailed")));
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
      setDrafts([]); // non-fatal: the public listing still works
    }
  }, [accessToken]);

  // Load (or clear) the user's drafts whenever their sign-in state changes.
  useEffect(() => {
    if (hasApi()) loadDrafts();
  }, [loadDrafts]);

  // The lesson page hands over a one-shot toast (after a delete) through
  // router state when it navigates back here. Shown once, then the state is
  // cleared so it doesn't reappear on refresh or back-navigation.
  useEffect(() => {
    const deletedTitle = (location.state as { deletedTitle?: string } | null)
      ?.deletedTitle;
    if (deletedTitle) {
      toast(t("toast.deleted", { title: deletedTitle }));
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location, navigate, t]);

  // Send the user to the editor to edit one of their own lessons. The editor
  // fetches the full lesson and warns before replacing in-progress work, so
  // only which lesson to load is handed over (sessionStorage, consumed once
  // on the editor's mount).
  const editLesson = (summary: LessonSummary) => {
    try {
      sessionStorage.setItem(EDIT_REQUEST_KEY, summary.id);
    } catch {
      // The navigation below still works; the editor just won't preload.
    }
    navigate("/editor");
  };

  const askDelete = (summary: LessonSummary) => {
    setDeleting(summary);
    setDeleteText("");
    setDeleteError("");
  };

  const closeDelete = () => {
    if (deleteBusy) return; // don't abandon an in-flight request
    setDeleting(null);
  };

  // The title the user must type to confirm. Mirrors the fallback the row
  // and backend use for an untitled lesson, so an "Untitled Lesson" row is
  // confirmable by typing exactly that.
  const deleteTarget = deleting
    ? deleting.title || t("card.untitledLesson")
    : "";
  const deleteConfirmed = deleteText.trim() === deleteTarget;

  const confirmDelete = async () => {
    if (!deleting || !deleteConfirmed || !accessToken) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteLesson(deleting.id, accessToken);
      // Drop it from whichever list held it so it disappears immediately.
      setLessons((prev) => prev.filter((l) => l.id !== deleting.id));
      setDrafts((prev) => prev.filter((l) => l.id !== deleting.id));
      toast(t("toast.deleted", { title: deleteTarget }));
      setDeleting(null);
    } catch (err) {
      setDeleteError(errorMessage(err, t("errors.deleteFailed")));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <>
      {/* No PageBar: the hub is a top-level destination, already named in
          the header's nav, so its title belongs to the page body. */}
      <PageBody>
        <h1 className="text-2xl font-bold md:text-3xl">{t("header.title")}</h1>
        <div className="mt-1 mb-4 flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {t("toolbar.description")}
          </p>
          {hasApi() && (
            <div className="flex shrink-0 items-center gap-0.5">
              {remoteAvailable && (
                <IconActionButton
                  tooltip={t("toolbar.remoteTooltip")}
                  aria-label={t("toolbar.remoteAria")}
                  onClick={openRemote}
                >
                  <GlobeIcon />
                </IconActionButton>
              )}
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

        {hasApi() && drafts.length > 0 && (
          // The heading sits inside the box, on a tinted strip, the pattern
          // every listing on the page follows: the box has an edge, and the
          // strip says what is in it and how much.
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

        {/* Present while loading too, disabled: the field is 52px of layout,
            and appearing only once the fetch lands would push the whole
            listing down at the moment the content arrived. */}
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
                // The box arrives in the server's HTML before the script
                // that filters on it; until that has run, typing would go
                // nowhere, so the box doesn't take it.
                readOnly={!hydrated}
                className="pr-9 pl-9"
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
                  search is narrowing the list. */}
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

      <Dialog open={remoteOpen} onOpenChange={setRemoteOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={forkRemote} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t("remoteDialog.title")}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {t("remoteDialog.description")}
            </p>
            <Field>
              <FieldLabel htmlFor="hub-remote-url">
                {t("remoteDialog.urlLabel")}
              </FieldLabel>
              <Input
                id="hub-remote-url"
                type="url"
                autoFocus
                placeholder={t("remoteDialog.urlPlaceholder")}
                value={remoteUrl}
                onChange={(e) => {
                  setRemoteUrl(e.target.value);
                  setRemoteError("");
                }}
              />
            </Field>
            {remoteError && (
              <Alert variant="destructive">
                <AlertDescription>{remoteError}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRemoteOpen(false)}
              >
                {t("remoteDialog.cancel")}
              </Button>
              <Button type="submit" disabled={!remoteUrl.trim()}>
                <GlobeIcon data-icon="inline-start" />
                {t("remoteDialog.copy")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
