// Lesson-hub API — talks to the companion `apps/api` Worker, which
// owns the Supabase Postgres connection. The browser never touches the database
// directly; it only ever calls these Worker endpoints (mirroring how aiSuggest
// and pixabay already proxy through the same Worker).
//
// Worker endpoints this expects (see README "Lesson hub" for the full contract):
//   GET  {apiUrl()}/lessons          -> { lessons: LessonSummary[] }   (public; published only)
//   GET  {apiUrl()}/lessons/mine     -> { lessons: LessonSummary[] }   (auth: Bearer; caller's own, incl. drafts)
//   GET  {apiUrl()}/lessons/:id      -> { lesson: Lesson }             (public)
//   POST {apiUrl()}/lessons          -> { lesson: LessonSummary }      (auth: Bearer Supabase JWT)
//   PUT  {apiUrl()}/lessons/:id      -> { lesson: LessonSummary }      (auth: Bearer; author only)
//   DELETE {apiUrl()}/lessons/:id    -> { ok: true }                   (auth: Bearer; author only)
//
// LessonSummary: { id, authorId, title, author, sectionCount, published, createdAt }
//                `published` is false for a draft — a lesson backed up to the
//                database but kept out of the public hub listing.
// Lesson:        LessonSummary & { doc, avgRating, ratingCount }
//                `doc` is the editor document shape { title, sections: [...] } used
//                everywhere else. `avgRating` is the mean of its 1–5 star ratings
//                (null when unrated) and `ratingCount` how many it has — shown on
//                the lesson page (see CommentsSection for how ratings are left).
//                `authorId` is the publisher's Supabase user id — the hub compares
//                it with the signed-in user to decide whether to offer "Edit".
import { apiUrl, hasApi } from "./config.ts";
import type { LessonDoc } from "./types.ts";

/** A lesson as the hub lists it (see rowToLesson in apps/api/src/lib/lesson.js). */
export interface LessonSummary {
  id: string;
  authorId: string;
  title: string;
  author: string | null;
  sectionCount: number;
  published: boolean;
  /** Whether a moderator has hidden it from the public hub. */
  shadowbanned: boolean;
  forkedFrom: string | null;
  forkedFromUrl: string | null;
  createdAt: string;
  /** The author's IP, on a moderator's or admin's read only. */
  authorIp?: string | null;
}

/** A single lesson read, with its document and its ratings. */
export interface Lesson extends LessonSummary {
  doc: LessonDoc;
  avgRating: number | null;
  ratingCount: number;
}

/** A lesson on another instance, as this hub's API found it. */
export interface RemoteLesson {
  /** Its page on the other instance. */
  url: string;
  origin: string;
  title: string;
  author: string;
  sectionCount: number;
  createdAt: string | null;
  doc: LessonDoc;
  /** Where its history can be fetched from, or null when it offers none. */
  packUrl: string | null;
}

/** What the API's lesson routes answer with, as far as this module reads it. */
interface LessonsResponse {
  lessons?: LessonSummary[];
  lesson?: LessonSummary;
}

// sessionStorage key the hub uses to hand the editor the id of a lesson to open
// for editing. The hub sets it then navigates to the editor, which consumes and
// clears it once on mount (see HubPage.editLesson / EditorPage's load effect).
export const EDIT_REQUEST_KEY = "s2c-lesson-maker:edit-lesson-id";

// sessionStorage key the lesson page uses to hand the editor the id of a lesson
// to fork: the editor loads its document as a fresh, unattached draft (no
// editingId), so publishing creates a new lesson rather than touching the
// original. Unlike editing, forking needs no special permission — the original
// row is never modified. Consumed and cleared once on the editor's mount.
export const FORK_REQUEST_KEY = "s2c-lesson-maker:fork-lesson-id";

// sessionStorage key the hub uses to hand the editor the web address of a
// lesson on ANOTHER instance to fork. The editor asks this hub's API to read it
// (see fetchRemoteLesson) and then proceeds as for a fork from here, with the
// address as the lesson's pointer home instead of a hub id. Consumed and
// cleared once on the editor's mount.
export const REMOTE_FORK_REQUEST_KEY = "s2c-lesson-maker:fork-remote-url";

// Whether the hub can reach a backend at all. Browsing needs only this; the
// publish step additionally needs a signed-in Supabase session.

function endpoint(path = ""): string {
  return `${apiUrl()}/lessons${path}`;
}

/**
 * The absolute URL of the hub's "latest lessons" Atom feed, for the "RSS"
 * subscribe link on the hub. Served by the Worker at /feed.xml (a site-wide feed,
 * not under /lessons). Returns "" when no backend is configured.
 */
export function lessonsFeedUrl(): string {
  if (!hasApi()) return "";
  return `${apiUrl()}/feed.xml`;
}

/**
 * An error from the hub's API, carrying the HTTP status that produced it.
 * Mostly read as a plain Error; the status is for the rare caller that must
 * tell "missing" apart from "broken" — the server render answers a deleted
 * lesson's URL with a real 404 rather than a soft one (apps/api/src/routes/ssr.js).
 */
export interface ApiError extends Error {
  status?: number;
}

async function readError(res: Response): Promise<ApiError> {
  // The Worker returns a plain-text reason for 4xx/5xx; surface it directly.
  const detail = await res.text().catch(() => "");
  const error: ApiError = new Error(
    detail || `Request failed (${res.status}).`,
  );
  error.status = res.status;
  return error;
}

/**
 * List published lessons, newest first. Public — no auth required.
 */
export async function fetchPublishedLessons(): Promise<LessonSummary[]> {
  if (!hasApi()) throw new Error("The lesson hub is not configured.");

  let res;
  try {
    res = await fetch(endpoint(), { method: "GET" });
  } catch {
    throw new Error("Could not reach the lesson hub.");
  }
  if (!res.ok) throw await readError(res);

  const data: LessonsResponse = await res.json().catch(() => ({}));
  return Array.isArray(data.lessons) ? data.lessons : [];
}

/**
 * List the signed-in user's own lessons (drafts and published), newest first.
 * Requires a Supabase session JWT. Used by the hub to show a user their drafts,
 * which are excluded from the public listing.
 * @param accessToken  Supabase session JWT.
 */
export async function fetchMyLessons(
  accessToken: string,
): Promise<LessonSummary[]> {
  if (!hasApi()) throw new Error("The lesson hub is not configured.");
  if (!accessToken) throw new Error("Please sign in to see your lessons.");

  let res;
  try {
    res = await fetch(endpoint("/mine"), {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new Error("Could not reach the lesson hub.");
  }
  if (!res.ok) throw await readError(res);

  const data: LessonsResponse = await res.json().catch(() => ({}));
  return Array.isArray(data.lessons) ? data.lessons : [];
}

/**
 * Fetch a single lesson, including its full editor `doc`. Public for published
 * lessons; a private draft (published === false) requires the caller to be
 * signed in as its author, a trusted collaborator, or a moderator — `accessToken`
 * is sent along whenever one is available so those cases keep working.
 * @param accessToken Supabase session JWT, if signed in.
 */
export async function fetchLesson(
  id: string,
  accessToken?: string,
): Promise<Lesson> {
  if (!hasApi()) throw new Error("The lesson hub is not configured.");
  if (!id) throw new Error("Missing lesson id.");

  let res;
  try {
    res = await fetch(endpoint(`/${encodeURIComponent(id)}`), {
      method: "GET",
      ...(accessToken
        ? { headers: { Authorization: `Bearer ${accessToken}` } }
        : {}),
    });
  } catch {
    throw new Error("Could not reach the lesson hub.");
  }
  if (!res.ok) throw await readError(res);

  const data: { lesson?: Lesson } = await res.json().catch(() => ({}));
  if (!data.lesson) throw new Error("Lesson not found.");
  return data.lesson;
}

/**
 * Whether this hub can copy lessons from other instances, which it can only
 * when it federates (GET /remote). Asked before offering the action, so that
 * an instance that cannot never shows it. False when the API is unreachable or
 * too old to know, which is the same answer as far as the button is concerned.
 */
export async function remoteForkAvailable(): Promise<boolean> {
  if (!hasApi()) return false;
  try {
    const res = await fetch(`${apiUrl()}/remote`, { method: "GET" });
    if (!res.ok) return false;
    const data: { available?: unknown } = await res.json().catch(() => ({}));
    return data.available === true;
  } catch {
    return false;
  }
}

/**
 * A lesson on another instance, read through this hub's API so it can be forked
 * here. The address is the lesson's page there; the API finds the lesson through
 * federation and answers with its document and where its history can be fetched
 * from (`packUrl`, which fetchRemotePackFile in git/remote.ts takes). Needs a
 * signed-in session, since the API fetches on the caller's behalf.
 * @param accessToken  Supabase session JWT.
 */
export async function fetchRemoteLesson(
  url: string,
  accessToken: string,
): Promise<RemoteLesson> {
  if (!hasApi()) throw new Error("The lesson hub is not configured.");
  if (!accessToken) {
    throw new Error("Please sign in to copy a lesson from another instance.");
  }

  let res;
  try {
    res = await fetch(
      `${apiUrl()}/remote/lesson?url=${encodeURIComponent(url)}`,
      { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } },
    );
  } catch {
    throw new Error("Could not reach the lesson hub.");
  }
  if (!res.ok) throw await readError(res);

  const data: { lesson?: RemoteLesson } = await res.json().catch(() => ({}));
  if (!data.lesson?.doc) throw new Error("Lesson not found.");
  return data.lesson;
}

/**
 * Save the current editor document to the cloud as a new lesson. Requires a
 * signed-in Supabase session: the access token is sent as a Bearer credential and
 * the Worker verifies it (and derives the author) before inserting the row.
 * `published` chooses whether the lesson is shared on the public hub (true,
 * the default) or kept as a private draft backup (false).
 * @param doc          The editor document ({ title, sections }).
 * @param accessToken  Supabase session JWT.
 * @param opts
 *        `forkedFrom` is the id of the lesson this one was forked from, when it
 *        was. The server records it so the fork can later pull the original's
 *        changes in (see browser/git/sync.ts). `forkedFromUrl` is the same pointer
 *        home for a lesson forked from another instance: the page it was forked
 *        from there.
 */
export async function publishLesson(
  doc: LessonDoc,
  accessToken: string,
  {
    published = true,
    forkedFrom = null,
    forkedFromUrl = null,
  }: {
    published?: boolean;
    forkedFrom?: string | null;
    forkedFromUrl?: string | null;
  } = {},
): Promise<Partial<LessonSummary>> {
  if (!hasApi()) throw new Error("The lesson hub is not configured.");
  if (!accessToken) throw new Error("Please sign in before saving.");
  if (!doc || !Array.isArray(doc.sections) || doc.sections.length === 0) {
    throw new Error("Add at least one section before saving.");
  }

  let res;
  try {
    res = await fetch(endpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        title: doc.title || "Untitled Lesson",
        doc,
        published,
        ...(forkedFrom ? { forkedFrom } : {}),
        ...(forkedFromUrl ? { forkedFromUrl } : {}),
      }),
    });
  } catch {
    throw new Error("Could not reach the lesson hub.");
  }
  if (!res.ok) throw await readError(res);

  const data: LessonsResponse = await res.json().catch(() => ({}));
  return data.lesson || {};
}

/**
 * Update a lesson the signed-in user previously saved to the cloud. Requires a
 * Supabase session JWT; the Worker only applies the change when the verified user
 * is the lesson's author (otherwise it responds 403). Overwrites the stored title
 * and doc with the supplied document. When `published` is given, it also flips the
 * lesson between draft and hub-published; omit it to leave the current state alone.
 * @param id           The id of the lesson to update.
 * @param doc          The editor document ({ title, sections }).
 * @param accessToken  Supabase session JWT.
 */
export async function updateLesson(
  id: string,
  doc: LessonDoc,
  accessToken: string,
  { published }: { published?: boolean } = {},
): Promise<Partial<LessonSummary>> {
  if (!hasApi()) throw new Error("The lesson hub is not configured.");
  if (!id) throw new Error("Missing lesson id.");
  if (!accessToken) throw new Error("Please sign in before editing.");
  if (!doc || !Array.isArray(doc.sections) || doc.sections.length === 0) {
    throw new Error("Add at least one section before saving.");
  }

  const body: { title: string; doc: LessonDoc; published?: boolean } = {
    title: doc.title || "Untitled Lesson",
    doc,
  };
  // Only send `published` when explicitly chosen, so an update that isn't meant to
  // change visibility leaves the lesson's current draft/published state untouched.
  if (typeof published === "boolean") body.published = published;

  let res;
  try {
    res = await fetch(endpoint(`/${encodeURIComponent(id)}`), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Could not reach the lesson hub.");
  }
  if (!res.ok) throw await readError(res);

  const data: LessonsResponse = await res.json().catch(() => ({}));
  return data.lesson || {};
}

/**
 * Permanently delete a lesson the signed-in user previously published. Requires
 * a Supabase session JWT; the Worker only deletes the row when the verified user
 * is the lesson's author (otherwise it responds 403). This cannot be undone.
 * @param id           The id of the lesson to delete.
 * @param accessToken  Supabase session JWT.
 */
export async function deleteLesson(
  id: string,
  accessToken: string,
): Promise<void> {
  if (!hasApi()) throw new Error("The lesson hub is not configured.");
  if (!id) throw new Error("Missing lesson id.");
  if (!accessToken) throw new Error("Please sign in before deleting.");

  let res;
  try {
    res = await fetch(endpoint(`/${encodeURIComponent(id)}`), {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    throw new Error("Could not reach the lesson hub.");
  }
  if (!res.ok) throw await readError(res);
}
