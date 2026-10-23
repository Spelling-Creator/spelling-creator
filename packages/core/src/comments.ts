// Lesson-comment API — talks to the same `apps/api` Worker as the
// rest of the hub (see lessons.ts). The browser never touches the database
// directly; it only calls these Worker endpoints.
//
// Worker endpoints this expects (see README "Lesson hub" for the full contract):
//   GET   {apiUrl()}/lessons/:id/comments      -> { comments: Comment[] }  (public)
//   POST  {apiUrl()}/lessons/:id/comments      -> { comment: Comment }     (auth: Bearer Supabase JWT)
//   PATCH {apiUrl()}/lessons/:id/comments/:cid -> { comment: Comment }     (auth: the comment's author)
//
// Comment: { id, parentId, authorId, author, body, createdAt, editedAt }
//   parentId is the comment this one replies to, or null for a top-level comment.
//   body is rich-text HTML (see richText.ts); comments predating rich text are
//   plain strings, which RichText.jsx still renders as plain text.
//   editedAt is when the author last edited it, or null if they never have.
//
// Posting is moderated server-side: a comment containing profanity is rejected
// outright (HTTP 422) and the Worker's plain-text reason is surfaced to the user.
// Editing runs the same gauntlet. A reply (parentId set) also notifies the parent
// comment's author and the lesson author — handled entirely server-side.
//
// A comment may also carry a 1–5 star `rating` for the lesson (see the MUI Rating
// in CommentsSection). The Worker stores one rating per user per lesson and, when
// a rating is included, returns the lesson's new average so the page can update
// its displayed stars. See postComment's return shape.
import { apiUrl, hasApi } from "./config.ts";

/** A comment on a lesson (see rowToComment in apps/api/src/routes/comments.js). */
export interface LessonComment {
  id: string;
  parentId: string | null;
  authorId: string | null;
  author: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
}

/** A lesson's star rating, across everyone who rated it. */
export interface RatingStats {
  /** Null when nobody has rated it. */
  average: number | null;
  count: number;
}

interface CommentsResponse {
  comments?: LessonComment[];
  comment?: LessonComment;
  rating?: RatingStats | null;
}

function endpoint(lessonId: string): string {
  return `${apiUrl()}/lessons/${encodeURIComponent(lessonId)}/comments`;
}

async function readError(res: Response): Promise<Error & { status: number }> {
  // The Worker returns a plain-text reason for 4xx/5xx; surface it directly.
  const detail = await res.text().catch(() => "");
  // Expose the status so callers can distinguish cases — notably the 422 the
  // Worker returns when a comment is blocked for profanity (see postComment).
  return Object.assign(new Error(detail || `Request failed (${res.status}).`), {
    status: res.status,
  });
}

// The Worker rejects a profanity-containing comment with this status (nothing is
// stored). The UI treats it as a moderation warning rather than an error.
export const COMMENT_BLOCKED_STATUS = 422;

// Mirrors the Worker's MAX_COMMENT_LENGTH so the editor can show a live counter and
// refuse to submit an over-long comment. Counted over the text the user wrote, not
// the markup around it — the Worker measures the same way, so the two agree.
export const COMMENT_MAX = 2000;

/**
 * List the comments on a lesson, oldest first. Public for a published lesson;
 * a private draft's comments need the caller to be signed in as its author, a
 * trusted collaborator, or a moderator — `accessToken` is sent along whenever
 * one is available so those cases keep working.
 * @param accessToken Supabase session JWT, if signed in.
 */
export async function fetchComments(
  lessonId: string,
  accessToken?: string,
): Promise<LessonComment[]> {
  if (!hasApi()) throw new Error("The lesson hub is not configured.");
  if (!lessonId) throw new Error("Missing lesson id.");

  let res;
  try {
    res = await fetch(endpoint(lessonId), {
      method: "GET",
      ...(accessToken
        ? { headers: { Authorization: `Bearer ${accessToken}` } }
        : {}),
    });
  } catch {
    throw new Error("Could not reach the lesson hub.");
  }
  if (!res.ok) throw await readError(res);

  const data: CommentsResponse = await res.json().catch(() => ({}));
  return Array.isArray(data.comments) ? data.comments : [];
}

/**
 * Post a comment on a published lesson. Requires a signed-in Supabase session:
 * the access token is sent as a Bearer credential and the Worker verifies it
 * (and derives the author) before inserting the row. The Worker also rejects the
 * comment if it contains profanity.
 *
 * An optional 1–5 star `rating` rates the lesson alongside the comment; the
 * Worker stores one rating per user (re-rating updates it) and returns the
 * lesson's new average when a rating is included.
 * @param body          The comment text.
 * @param accessToken   Supabase session JWT.
 * @param parentId      The comment being replied to; omit for a top-level comment.
 * @param rating        A 1–5 star rating for the lesson; omit to comment without rating.
 */
export async function postComment(
  lessonId: string,
  body: string,
  accessToken: string,
  parentId?: string | null,
  rating?: number | null,
): Promise<{ comment: Partial<LessonComment>; rating: RatingStats | null }> {
  if (!hasApi()) throw new Error("The lesson hub is not configured.");
  if (!lessonId) throw new Error("Missing lesson id.");
  if (!accessToken) throw new Error("Please sign in before commenting.");

  const text = (body || "").trim();
  if (!text) throw new Error("Write something before posting.");

  const payload: { body: string; parentId?: string; rating?: number } = {
    body: text,
  };
  if (parentId) payload.parentId = parentId;
  if (rating != null) payload.rating = rating;

  let res;
  try {
    res = await fetch(endpoint(lessonId), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Could not reach the lesson hub.");
  }
  if (!res.ok) throw await readError(res);

  const data: CommentsResponse = await res.json().catch(() => ({}));
  return { comment: data.comment || {}, rating: data.rating || null };
}

/**
 * Edit one of your own comments. The Worker decides ownership from the verified JWT
 * against the stored row — the browser can't claim authorship of someone else's
 * comment — and re-runs the same sanitizing, length and profanity checks as a fresh
 * post, so an edit can't launder past a rule the original had to satisfy. The
 * returned comment carries `editedAt`, which the thread shows as an "edited" marker.
 *
 * Moderators deliberately have no edit power: they can delete a comment, but not
 * rewrite one under its author's name.
 *
 * @param commentId   The comment to edit; must be yours.
 * @param body        The new body, as rich-text HTML.
 * @param accessToken Supabase session JWT.
 */
export async function updateComment(
  lessonId: string,
  commentId: string,
  body: string,
  accessToken: string,
): Promise<Partial<LessonComment>> {
  if (!hasApi()) throw new Error("The lesson hub is not configured.");
  if (!lessonId || !commentId) throw new Error("Missing comment id.");
  if (!accessToken) throw new Error("Please sign in before editing.");

  let res;
  try {
    res = await fetch(
      `${endpoint(lessonId)}/${encodeURIComponent(commentId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ body }),
      },
    );
  } catch {
    throw new Error("Could not reach the lesson hub.");
  }
  if (!res.ok) throw await readError(res);

  const data: CommentsResponse = await res.json().catch(() => ({}));
  return data.comment || {};
}

/**
 * Delete any comment as a moderator/admin. Privileged: the Worker verifies the
 * caller's role (re-derived from the database) before removing the row, and its
 * replies cascade with it. A plain author can't reach this — it's a moderation
 * action, distinct from the (not-yet-implemented) author self-delete.
 * @param accessToken  Supabase session JWT.
 */
export { deleteCommentAsMod as deleteComment } from "./moderation.ts";
