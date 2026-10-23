// Pull requests — talks to the same `apps/api` Worker as the rest of the hub
// (see lessons.ts / comments.ts). The browser never touches the database
// directly; it only calls these Worker endpoints.
//
// A pull request is how someone proposes changes to a lesson they don't own:
// they fork it, edit their fork, and open a request against the original. Its
// author — or one of the trusted collaborators they named — reviews it and
// merges it in. Nobody writes another person's lesson without that step.
//
// Worker endpoints this expects (see apps/api/src/routes/pulls.js):
//   GET  {API}/lessons/:id/pulls                 -> { pulls: PullRequest[] }   (public*)
//   POST {API}/lessons/:id/pulls                 -> { pull }                   (Bearer)
//   PUT  {API}/lessons/:id/pulls/:prId/pack      -> { pull }                   (Bearer; packfile body)
//   GET  {API}/lessons/:id/pulls/:prId/pack      -> the packfile               (public*)
//   POST {API}/lessons/:id/pulls/:prId/merge     -> { pull }                   (Bearer)
//   POST {API}/lessons/:id/pulls/:prId/close     -> { pull }                   (Bearer)
//
// *as public as the lesson itself: a proposal against a private draft is private.
//
// PullRequest: { id, lessonId, sourceLessonId, authorId, author, title, body,
//                head, base, ready, status, mergeCommit, resolvedBy, resolvedAt,
//                createdAt }
//   status  'open' | 'merged' | 'closed'
//   ready   whether its packfile has landed — an unready request has nothing to
//           review yet, and is only ever listed to the person who opened it.
//   head    the commit the stored pack points at (see git/remote.ts for how the
//           changes themselves travel).
import { apiUrl, hasApi } from "./config.ts";

// A title is a one-line summary and a body is a paragraph or two of explanation
// — this is a change request, not a document. Both are plain text: unlike a
// comment there is no rich-text editor behind them, so there is no markup to
// sanitize and nothing to render but text.
//
// Shared with the Worker (apps/api/src/routes/pulls.js imports these), so the
// form's character counter and the server's validation can't drift apart.
export const PULL_TITLE_MAX = 200;
export const PULL_BODY_MAX = 4000;

// How many times one proposal may be updated before it has to be closed and
// reopened. A proposal is a conversation about a specific change; past a couple
// of dozen rewrites it is a different change, and the thread attached to it has
// stopped being about what it now contains. It also bounds the one thing an
// update costs the hub — a full pack rewrite — for a caller who could otherwise
// repeat it indefinitely.
export const MAX_PULL_REVISIONS = 20;

/** A pull request (see rowToPull in apps/api/src/routes/pulls.js). */
export interface PullRequest {
  id: string;
  lessonId: string;
  sourceLessonId: string | null;
  authorId: string;
  author: string | null;
  title: string;
  body: string;
  head: string;
  base: string | null;
  /** Which branch of the fork this is, when it isn't the fork's own lesson. */
  headRef: string | null;
  /** How many times the proposer has uploaded. */
  revision: number;
  /** What the proposal pointed at before its latest upload. */
  previousHead: string | null;
  updatedAt: string | null;
  ready: boolean;
  status: "open" | "merged" | "closed";
  mergeCommit: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

interface PullsResponse {
  pulls?: PullRequest[];
  pull?: PullRequest;
  canReview?: unknown;
}

function endpoint(lessonId: string, path = ""): string {
  return `${apiUrl()}/lessons/${encodeURIComponent(lessonId)}/pulls${path}`;
}

async function readError(res: Response): Promise<Error> {
  // The Worker returns a plain-text reason for 4xx/5xx; surface it directly.
  const detail = await res.text().catch(() => "");
  return new Error(detail || `Request failed (${res.status}).`);
}

/**
 * List the proposals against a lesson, newest first.
 *
 * Public for a public lesson. Pass the caller's token when signed in: it's what
 * lets someone see their own not-yet-uploaded proposal (hidden from everyone
 * else), and what the Worker answers `canReview` from.
 *
 * `canReview` says whether the caller may merge or decline these — the server's
 * answer, because it depends on the lesson's trusted-collaborator list. Use it to
 * decide which buttons to draw; every action re-checks it regardless.
 *
 * @param accessToken Supabase session JWT, if signed in.
 */
export async function fetchPullRequests(
  lessonId: string,
  accessToken?: string,
): Promise<{ pulls: PullRequest[]; canReview: boolean }> {
  if (!hasApi() || !lessonId) return { pulls: [], canReview: false };

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

  const data: PullsResponse = await res.json().catch(() => ({}));
  return {
    pulls: Array.isArray(data.pulls) ? data.pulls : [],
    canReview: Boolean(data.canReview),
  };
}

/**
 * Open a proposal against a lesson.
 *
 * This creates the request but not its contents: the changes travel as a
 * packfile, uploaded next with uploadPullPack() against the id returned here.
 * Until that lands the request is `ready: false` and nobody but its author sees
 * it — so a failed upload leaves nothing for a reviewer to trip over.
 *
 * @param lessonId  The lesson being proposed to.
 * @param pull.title   One-line summary of what this changes.
 * @param pull.body    Longer explanation, plain text.
 * @param pull.head    The commit the pack will point at.
 * @param pull.base    The lesson's tip this was built on.
 * @param pull.sourceLessonId  The fork it came from, if it's saved.
 * @param accessToken  Supabase session JWT.
 * @returns The created pull request.
 */
export async function createPullRequest(
  lessonId: string,
  {
    title,
    body = "",
    head,
    headRef = null,
    base = null,
    sourceLessonId = null,
  }: {
    title: string;
    body?: string;
    head: string;
    headRef?: string | null;
    base?: string | null;
    sourceLessonId?: string | null;
  },
  accessToken: string,
): Promise<PullRequest> {
  if (!hasApi()) throw new Error("The lesson hub is not configured.");
  if (!lessonId) throw new Error("Missing lesson id.");
  if (!accessToken) throw new Error("Please sign in before proposing changes.");

  let res;
  try {
    res = await fetch(endpoint(lessonId), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        title,
        body,
        head,
        ...(headRef ? { headRef } : {}),
        ...(base ? { base } : {}),
        ...(sourceLessonId ? { sourceLessonId } : {}),
      }),
    });
  } catch {
    throw new Error("Could not reach the lesson hub.");
  }
  if (!res.ok) throw await readError(res);

  const data: PullsResponse = await res.json().catch(() => ({}));
  if (!data.pull) throw new Error("Could not open the proposal.");
  return data.pull;
}

/**
 * Upload a proposal's packfile — the changes themselves.
 *
 * `head` must be the commit the request was opened with; the Worker refuses
 * anything else, and refuses a second upload, so what a reviewer reads is what
 * they merge however long the proposer keeps working on their fork afterwards.
 * @returns The pull request, now ready.
 */
export async function uploadPullPack(
  lessonId: string,
  pullId: string,
  { packfile, head }: { packfile: BodyInit; head: string },
  accessToken: string,
): Promise<PullRequest | null> {
  if (!hasApi()) throw new Error("The lesson hub is not configured.");
  if (!lessonId || !pullId) throw new Error("Missing proposal id.");
  if (!accessToken) throw new Error("Please sign in before proposing changes.");

  let res;
  try {
    res = await fetch(
      endpoint(lessonId, `/${encodeURIComponent(pullId)}/pack`),
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/x-git-packfile",
          "X-Git-Head": head,
          Authorization: `Bearer ${accessToken}`,
        },
        body: packfile,
      },
    );
  } catch {
    throw new Error("Could not reach the lesson hub.");
  }
  if (!res.ok) throw await readError(res);

  const data: PullsResponse = await res.json().catch(() => ({}));
  return data.pull || null;
}

/**
 * Download a proposal's packfile, so it can be indexed into the lesson's own
 * repository and merged from there.
 *
 * As in git/remote.ts fetchPack, the tip comes back in the response's own
 * X-Git-Head header rather than from a separate call, so bytes and ref can never
 * be paired from two different moments.
 * @returns null when the proposal's changes are no longer stored (it was merged
 *          or closed).
 */
export async function fetchPullPack(
  lessonId: string,
  pullId: string,
  accessToken?: string,
): Promise<{ packfile: Uint8Array; head: string } | null> {
  if (!hasApi() || !lessonId || !pullId) return null;

  let res;
  try {
    res = await fetch(
      endpoint(lessonId, `/${encodeURIComponent(pullId)}/pack`),
      {
        method: "GET",
        ...(accessToken
          ? { headers: { Authorization: `Bearer ${accessToken}` } }
          : {}),
      },
    );
  } catch {
    throw new Error("Could not reach the proposed changes.");
  }
  if (res.status === 404) return null;
  if (!res.ok) throw await readError(res);

  const head = res.headers.get("X-Git-Head");
  if (!head) return null; // a pack with no tip is unusable

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0) return null;
  return { packfile: bytes, head };
}

/**
 * Record that a proposal has been merged. The lesson's author or a trusted
 * collaborator only.
 *
 * Call this *after* the merge has been pushed to the lesson's history and its
 * document saved: the Worker checks that `mergeCommit` is the commit the
 * lesson's stored history actually points at, and refuses otherwise, so a
 * proposal can't be marked merged while its changes are quietly dropped.
 * @returns The resolved pull request.
 */
export async function mergePullRequest(
  lessonId: string,
  pullId: string,
  mergeCommit: string,
  accessToken: string,
): Promise<PullRequest | null> {
  if (!hasApi()) throw new Error("The lesson hub is not configured.");
  if (!lessonId || !pullId) throw new Error("Missing proposal id.");
  if (!accessToken) throw new Error("Please sign in first.");

  let res;
  try {
    res = await fetch(
      endpoint(lessonId, `/${encodeURIComponent(pullId)}/merge`),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ mergeCommit }),
      },
    );
  } catch {
    throw new Error("Could not reach the lesson hub.");
  }
  if (!res.ok) throw await readError(res);

  const data: PullsResponse = await res.json().catch(() => ({}));
  return data.pull || null;
}

/**
 * Close a proposal without merging it — withdrawn by the person who opened it,
 * declined by the lesson's author or a trusted collaborator, or removed by a
 * moderator. The request stays visible; only its stored changes are dropped.
 * @returns The resolved pull request.
 */
export async function closePullRequest(
  lessonId: string,
  pullId: string,
  accessToken: string,
): Promise<PullRequest | null> {
  if (!hasApi()) throw new Error("The lesson hub is not configured.");
  if (!lessonId || !pullId) throw new Error("Missing proposal id.");
  if (!accessToken) throw new Error("Please sign in first.");

  let res;
  try {
    res = await fetch(
      endpoint(lessonId, `/${encodeURIComponent(pullId)}/close`),
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
  } catch {
    throw new Error("Could not reach the lesson hub.");
  }
  if (!res.ok) throw await readError(res);

  const data: PullsResponse = await res.json().catch(() => ({}));
  return data.pull || null;
}
