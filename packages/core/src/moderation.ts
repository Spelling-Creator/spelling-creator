// Moderation API — talks to the same `apps/api` Worker as the rest of
// the hub (see lessons.ts / comments.ts). Every endpoint here is privileged: the
// Worker re-derives the caller's role from the database on each request, so these
// functions just send the Supabase JWT as a Bearer credential and surface the
// Worker's plain-text reason on failure. The browser's view of "am I a mod/admin"
// (fetchMyRole) is only ever used to decide what UI to show — never to authorise.
//
// Worker endpoints (see handleModeration in apps/api/src/routes/moderation.js).
// Named "/mod", not "/moderation" — the SPA already owns the "/moderation"
// page route, and the Worker sees every request before its static assets do
// (run_worker_first), so an API route at the same path as a page would
// swallow that page's direct loads/reloads instead of ever serving it.
//   GET    /mod/whoami                         -> { role }            (any signed-in)
//   DELETE /mod/comments/:id                                          (mod+)
//   POST   /mod/lessons/:id/shadowban          { shadowbanned }       (mod+)
//   POST   /mod/lessons/:id/delete-request     { reason }             (mod+)
//   GET    /mod/lessons/shadowbanned           -> { lessons }         (mod+)
//   DELETE /mod/lessons/:id                                           (admin)
//   GET    /mod/delete-requests                -> { requests }        (admin)
//   POST   /mod/delete-requests/:id/approve|deny                      (admin)
//   GET    /mod/bans                           -> { names, ips }      (mod+ / admin)
//   POST   /mod/bans/name                      { name }               (mod+)
//   DELETE /mod/bans/name/:nameLower                                  (mod+)
//   POST   /mod/bans/ip                        { ip, reason? }        (admin)
//   DELETE /mod/bans/ip/:ip                                           (admin)
//   GET    /mod/moderators                     -> { moderators }      (admin)
//   POST   /mod/moderators                     { email }              (admin)
//   DELETE /mod/moderators/:userId                                    (admin)
import { apiUrl, hasApi } from "./config.ts";
import type { LessonSummary } from "./lessons.ts";

/** A moderation tier. Everyone else has none. */
export type ModRole = "admin" | "moderator";

/** A moderator's request that an admin delete a lesson. */
export interface DeleteRequest {
  id: string;
  lessonId: string;
  reason: string;
  status: "pending" | "approved" | "denied";
  createdAt: string;
  /** Null when the lesson is already gone. */
  lessonTitle: string | null;
  lessonAuthor: string | null;
}

/** A banned display name, as the Worker reads the row. */
export interface NameBan {
  name_lower: string;
  /** The name as it was written, for showing back. */
  display_name: string | null;
  created_at: string;
}

/** A banned IP address, as the Worker reads the row. */
export interface IpBan {
  ip: string;
  reason: string | null;
  created_at: string;
}

export interface Moderator {
  userId: string;
  /** Null when the account can no longer be found. */
  email: string | null;
  createdAt: string;
}

function endpoint(path = ""): string {
  return `${apiUrl()}/mod${path}`;
}

async function readError(res: Response): Promise<Error & { status: number }> {
  const detail = await res.text().catch(() => "");
  return Object.assign(new Error(detail || `Request failed (${res.status}).`), {
    status: res.status,
  });
}

interface RequestOptions {
  method?: string;
  accessToken: string;
  body?: object;
}

// Shared request helper: attaches the Bearer token, parses JSON, surfaces the
// Worker's plain-text reason on a non-2xx. `T` is the body the endpoint answers
// with; any of it may be missing, since a body that isn't JSON reads as {}.
async function request<T extends object = Record<string, unknown>>(
  path: string,
  { method = "GET", accessToken, body }: RequestOptions,
): Promise<Partial<T>> {
  if (!hasApi()) throw new Error("The lesson hub is not configured.");
  if (!accessToken) throw new Error("Please sign in.");
  let res;
  try {
    res = await fetch(endpoint(path), {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error("Could not reach the lesson hub.");
  }
  if (!res.ok) throw await readError(res);
  return res.json().catch(() => ({}));
}

/**
 * The signed-in user's moderation tier: "admin", "moderator", or null. Used only
 * to decide which controls to render — every action is independently authorised
 * server-side. Returns null (not an error) when sign-in isn't configured or the
 * lookup fails, so a hiccup never blocks an ordinary user.
 * @param accessToken Supabase session JWT.
 */
export async function fetchMyRole(
  accessToken: string | null | undefined,
): Promise<ModRole | null> {
  if (!hasApi() || !accessToken) return null;
  try {
    const data = await request<{ role: ModRole | null }>("/whoami", {
      accessToken,
    });
    return data.role || null;
  } catch {
    return null;
  }
}

// --- Comments -------------------------------------------------------------

export function deleteCommentAsMod(
  commentId: string,
  accessToken: string,
): Promise<unknown> {
  return request(`/comments/${encodeURIComponent(commentId)}`, {
    method: "DELETE",
    accessToken,
  });
}

// --- Lessons --------------------------------------------------------------

export async function setShadowban(
  lessonId: string,
  shadowbanned: boolean,
  accessToken: string,
): Promise<Partial<LessonSummary>> {
  const data = await request<{ lesson: LessonSummary }>(
    `/lessons/${encodeURIComponent(lessonId)}/shadowban`,
    {
      method: "POST",
      accessToken,
      body: { shadowbanned },
    },
  );
  return data.lesson || {};
}

export function requestLessonDeletion(
  lessonId: string,
  reason: string,
  accessToken: string,
): Promise<unknown> {
  return request(`/lessons/${encodeURIComponent(lessonId)}/delete-request`, {
    method: "POST",
    accessToken,
    body: { reason: reason || "" },
  });
}

export async function listShadowbannedLessons(
  accessToken: string,
): Promise<LessonSummary[]> {
  const data = await request<{ lessons: LessonSummary[] }>(
    "/lessons/shadowbanned",
    { accessToken },
  );
  return Array.isArray(data.lessons) ? data.lessons : [];
}

export function deleteLessonAsAdmin(
  lessonId: string,
  accessToken: string,
): Promise<unknown> {
  return request(`/lessons/${encodeURIComponent(lessonId)}`, {
    method: "DELETE",
    accessToken,
  });
}

// --- Lesson-deletion requests (admin) ------------------------------------

export async function listDeleteRequests(
  accessToken: string,
): Promise<DeleteRequest[]> {
  const data = await request<{ requests: DeleteRequest[] }>(
    "/delete-requests",
    { accessToken },
  );
  return Array.isArray(data.requests) ? data.requests : [];
}

export function resolveDeleteRequest(
  requestId: string,
  approve: boolean,
  accessToken: string,
): Promise<unknown> {
  return request(
    `/delete-requests/${encodeURIComponent(requestId)}/${approve ? "approve" : "deny"}`,
    {
      method: "POST",
      accessToken,
    },
  );
}

// --- Bans -----------------------------------------------------------------

export async function listBans(
  accessToken: string,
): Promise<{ names: NameBan[]; ips: IpBan[] }> {
  const data = await request<{ names: NameBan[]; ips: IpBan[] }>("/bans", {
    accessToken,
  });
  return {
    names: Array.isArray(data.names) ? data.names : [],
    ips: Array.isArray(data.ips) ? data.ips : [],
  };
}

export function banName(name: string, accessToken: string): Promise<unknown> {
  return request("/bans/name", { method: "POST", accessToken, body: { name } });
}

export function unbanName(
  nameLower: string,
  accessToken: string,
): Promise<unknown> {
  return request(`/bans/name/${encodeURIComponent(nameLower)}`, {
    method: "DELETE",
    accessToken,
  });
}

export function banIp(
  ip: string,
  reason: string,
  accessToken: string,
): Promise<unknown> {
  return request("/bans/ip", {
    method: "POST",
    accessToken,
    body: { ip, reason: reason || "" },
  });
}

export function unbanIp(ip: string, accessToken: string): Promise<unknown> {
  return request(`/bans/ip/${encodeURIComponent(ip)}`, {
    method: "DELETE",
    accessToken,
  });
}

// --- Moderators (admin) ---------------------------------------------------

export async function listModerators(
  accessToken: string,
): Promise<Moderator[]> {
  const data = await request<{ moderators: Moderator[] }>("/moderators", {
    accessToken,
  });
  return Array.isArray(data.moderators) ? data.moderators : [];
}

export function addModerator(
  email: string,
  accessToken: string,
): Promise<unknown> {
  return request("/moderators", {
    method: "POST",
    accessToken,
    body: { email },
  });
}

/**
 * Set another user's password, as an admin.
 *
 * The recovery path for an instance that signs people in with a username and has
 * no mail server to send a reset link through. `identifier` is a username or an
 * email — whichever the admin knows the person by.
 */
export function setUserPassword(
  identifier: string,
  password: string,
  accessToken: string,
): Promise<unknown> {
  return request("/password", {
    method: "POST",
    accessToken,
    body: { identifier, password },
  });
}

export function removeModerator(
  userId: string,
  accessToken: string,
): Promise<unknown> {
  return request(`/moderators/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    accessToken,
  });
}
