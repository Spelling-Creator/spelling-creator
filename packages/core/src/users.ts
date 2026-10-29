// User-profile API — talks to the same `apps/api` Worker as the rest
// of the hub. Profiles are keyed by the Supabase user id (the `authorId` already
// carried on every lesson/comment), so a link stays valid even when a display
// name changes. The data lives under /profiles (not /users) so it doesn't collide
// with the SPA's /users/:id page — mirroring how lesson data is at /lessons while
// its page is at /hub.
//
// Worker endpoints (see handleUsers / handleFollow / handleFollowingFeed in
// apps/api/src/index.js):
//   GET    {apiUrl()}/profiles/:id           -> { user: { id, displayName, bio, followerCount, followingCount, isFollowing }, lessons: LessonSummary[] }
//   GET    {apiUrl()}/profiles/:id/feed.xml  -> Atom feed (surfaced as "RSS" in the UI)
//   POST   {apiUrl()}/profiles/:id/follow      -> { following: true,  followerCount }   (Bearer)
//   DELETE {apiUrl()}/profiles/:id/follow      -> { following: false, followerCount }   (Bearer)
//   GET    {apiUrl()}/profiles/:id/followers   -> { users: PublicUser[] }
//   GET    {apiUrl()}/profiles/:id/following   -> { users: PublicUser[] }
//   GET    {apiUrl()}/following/activity       -> { activity: FeedItem[] }              (Bearer)
import { apiUrl, hasApi } from "./config.ts";
import { readError, type LessonSummary } from "./lessons.ts";

/** The public fields of a user (see fetchPublicUser in apps/api/src/lib/supabase.js). */
export interface PublicUser {
  id: string;
  displayName: string;
  bio: string;
}

/** A user's profile page, with their follow counts. */
export interface UserProfile extends PublicUser {
  followerCount: number;
  followingCount: number;
  /** Whether the caller follows them; false when not signed in. */
  isFollowing: boolean;
}

/** One entry of an activity feed, shaped like a parsed Atom entry. */
export interface FeedItem {
  id: string;
  title: string;
  summary: string;
  /** A path on this site, such as /hub/<lesson id>. */
  link: string;
  updated: string;
}

// Whether profiles can be fetched at all (needs a configured backend).

/**
 * Fetch a user's public profile: their chosen display name, bio, follower/
 * following counts, and the lessons they've published (newest first). Public — no
 * auth required. Passing the caller's session token additionally resolves
 * `user.isFollowing` (whether *you* follow this profile), so the page can show the
 * right Follow / Following state.
 * @param id            The user's Supabase id.
 * @param accessToken   Optional Supabase session JWT (for isFollowing).
 */
export async function fetchUserProfile(
  id: string,
  accessToken?: string,
): Promise<{ user: UserProfile; lessons: LessonSummary[] }> {
  if (!hasApi()) throw new Error("Profiles are not configured.");
  if (!id) throw new Error("Missing user id.");

  let res;
  try {
    res = await fetch(`${apiUrl()}/profiles/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
  } catch {
    throw new Error("Could not reach the server.");
  }
  // The error carries the status: the server render answers a missing
  // profile's URL with a real 404 (apps/api/src/routes/ssr.js).
  if (!res.ok) throw await readError(res);
  const data: { user?: UserProfile; lessons?: LessonSummary[] } = await res
    .json()
    .catch(() => ({}));
  const user: PublicUser | UserProfile = data.user || {
    id,
    displayName: "Anonymous",
    bio: "",
  };
  return {
    user: {
      followerCount: 0,
      followingCount: 0,
      isFollowing: false,
      ...user,
    },
    lessons: Array.isArray(data.lessons) ? data.lessons : [],
  };
}

/**
 * Follow (`follow: true`) or unfollow (`follow: false`) a user. Requires a signed-
 * in session. Following someone drops a notification into their bell. Resolves to
 * the server's `{ following, followerCount }` so the UI can update the button and
 * count without a refetch; throws an Error carrying the Worker's plain-text reason
 * on failure (e.g. trying to follow yourself).
 * @param id           The user to (un)follow.
 * @param follow       true to follow, false to unfollow.
 * @param accessToken  Supabase session JWT.
 */
export async function setFollowing(
  id: string,
  follow: boolean,
  accessToken: string,
): Promise<{ following: boolean; followerCount: number }> {
  if (!hasApi()) throw new Error("Profiles are not configured.");
  if (!id) throw new Error("Missing user id.");
  if (!accessToken) throw new Error("Please sign in to follow people.");

  let res;
  try {
    res = await fetch(`${apiUrl()}/profiles/${encodeURIComponent(id)}/follow`, {
      method: follow ? "POST" : "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new Error("Could not reach the server.");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Request failed (${res.status}).`);
  }
  const data: { following?: unknown; followerCount?: unknown } = await res
    .json()
    .catch(() => ({}));
  return {
    following: Boolean(data.following),
    followerCount:
      typeof data.followerCount === "number" ? data.followerCount : 0,
  };
}

/**
 * List a user's followers, or the users they follow. Public — no auth. Each entry
 * is a public profile shape ({ id, displayName, bio }), newest-follow first.
 * @param id         The user whose connections to list.
 * @param direction  Which list to fetch.
 */
export async function fetchFollowList(
  id: string,
  direction: "followers" | "following",
): Promise<PublicUser[]> {
  if (!hasApi()) throw new Error("Profiles are not configured.");
  if (!id) throw new Error("Missing user id.");
  const dir = direction === "followers" ? "followers" : "following";

  let res;
  try {
    res = await fetch(`${apiUrl()}/profiles/${encodeURIComponent(id)}/${dir}`, {
      method: "GET",
    });
  } catch {
    throw new Error("Could not reach the server.");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Request failed (${res.status}).`);
  }
  const data: { users?: PublicUser[] } = await res.json().catch(() => ({}));
  return Array.isArray(data.users) ? data.users : [];
}

/**
 * Fetch the signed-in user's "following" feed: recent lessons and comments from
 * everyone they follow, merged newest-first. Each item is { id, title, summary,
 * link, updated } — the same shape as {@link fetchUserActivity}, so it renders in
 * the dashboard's <FeedList> unchanged. Returns [] when the user follows no one.
 * @param accessToken  Supabase session JWT.
 */
export async function fetchFollowingActivity(
  accessToken: string | null | undefined,
): Promise<FeedItem[]> {
  if (!hasApi()) throw new Error("Profiles are not configured.");
  if (!accessToken) return [];

  let res;
  try {
    res = await fetch(`${apiUrl()}/following/activity`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new Error("Could not reach the server.");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Request failed (${res.status}).`);
  }
  const data: { activity?: FeedItem[] } = await res.json().catch(() => ({}));
  return Array.isArray(data.activity) ? data.activity : [];
}

/**
 * The absolute URL of a user's Atom activity feed, for the "RSS" subscribe link.
 * Returns "" when no backend is configured.
 * @param id  The user's Supabase id.
 */
export function userFeedUrl(id: string): string {
  if (!hasApi() || !id) return "";
  return `${apiUrl()}/profiles/${encodeURIComponent(id)}/feed.xml`;
}
