// What federation remembers in Postgres, reached through PostgREST like every
// other table: each actor's signing keys, who follows them from other servers,
// and the published lessons their outbox lists. The protocol itself is in
// builder.js; this file knows the tables and nothing about ActivityPub.

import { supabaseHeaders } from "../supabase.js";

/** The shape of every id federation handles: a user's or a lesson's uuid. */
export const ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rows per page of a collection served to another server. */
export const PAGE = 50;

// The columns an Article is built from. Deliberately without `doc`, which can be
// megabytes of base64 on an older lesson; the one place a document is wanted
// (the object dispatcher, for an excerpt) asks for it by name.
const LESSON_COLUMNS =
  "id,author_id,author,title,section_count,published,shadowbanned,created_at";

async function rows(env, url, init) {
  let res;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...supabaseHeaders(env), ...(init?.headers || {}) },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return Array.isArray(data) ? data : null;
}

/**
 * How many rows a filter matches, without fetching them: PostgREST answers a
 * HEAD with `Prefer: count=exact` through the Content-Range header.
 */
async function count(env, url) {
  let res;
  try {
    res = await fetch(url, {
      method: "HEAD",
      headers: { ...supabaseHeaders(env), Prefer: "count=exact" },
    });
  } catch {
    return 0;
  }
  if (!res.ok) return 0;
  const range = res.headers.get("content-range") || "";
  const total = Number(range.split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

// ---- Keys -------------------------------------------------------------------

/** The stored key pairs of an actor, as `{ rsa, ed25519 }` of JWK pairs, or null. */
export async function loadKeys(env, base, userId) {
  const found = await rows(
    env,
    `${base}/rest/v1/federation_keys?user_id=eq.${encodeURIComponent(userId)}&select=rsa,ed25519&limit=1`,
  );
  const row = found?.[0];
  return row && row.rsa && row.ed25519
    ? { rsa: row.rsa, ed25519: row.ed25519 }
    : null;
}

/**
 * Store freshly generated keys for an actor, unless some other request got
 * there first, in which case theirs are returned: a key pair, once published
 * in an actor document, has to stay the key pair.
 */
export async function saveKeys(env, base, userId, keys) {
  let res;
  try {
    res = await fetch(`${base}/rest/v1/federation_keys?select=rsa,ed25519`, {
      method: "POST",
      headers: {
        ...supabaseHeaders(env),
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify({
        user_id: userId,
        rsa: keys.rsa,
        ed25519: keys.ed25519,
      }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const inserted = await res.json().catch(() => []);
  // An empty representation means the row already existed; read the winner.
  if (Array.isArray(inserted) && inserted.length > 0)
    return { rsa: inserted[0].rsa, ed25519: inserted[0].ed25519 };
  return loadKeys(env, base, userId);
}

// ---- Followers --------------------------------------------------------------

const followersUrl = (base, userId) =>
  `${base}/rest/v1/federation_followers?user_id=eq.${encodeURIComponent(userId)}`;

/**
 * The remote accounts following an author, oldest first. Without `limit`,
 * all of them, which is what a delivery wants.
 */
export async function listFollowers(
  env,
  base,
  userId,
  { offset = 0, limit } = {},
) {
  const page = limit ? `&offset=${offset}&limit=${limit}` : "";
  return (
    (await rows(
      env,
      `${followersUrl(base, userId)}&select=actor_id,inbox,shared_inbox&order=created_at.asc${page}`,
    )) || []
  );
}

export function countFollowers(env, base, userId) {
  return count(env, `${followersUrl(base, userId)}&select=actor_id`);
}

/** Record a follow. Re-following is a no-op rather than a duplicate. */
export async function addFollower(
  env,
  base,
  { userId, actorId, inbox, sharedInbox },
) {
  const res = await fetch(`${base}/rest/v1/federation_followers`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(env),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      user_id: userId,
      actor_id: actorId,
      inbox,
      shared_inbox: sharedInbox || null,
    }),
  });
  if (!res.ok)
    throw new Error(`Could not record the follower (${res.status}).`);
}

/** Forget one account's follow of one author. */
export async function removeFollower(env, base, userId, actorId) {
  const res = await fetch(
    `${followersUrl(base, userId)}&actor_id=eq.${encodeURIComponent(actorId)}`,
    {
      method: "DELETE",
      headers: supabaseHeaders(env),
    },
  );
  if (!res.ok)
    throw new Error(`Could not remove the follower (${res.status}).`);
}

/** Forget an account entirely: its server told us it is gone. */
export async function removeActorEverywhere(env, base, actorId) {
  const res = await fetch(
    `${base}/rest/v1/federation_followers?actor_id=eq.${encodeURIComponent(actorId)}`,
    {
      method: "DELETE",
      headers: supabaseHeaders(env),
    },
  );
  if (!res.ok) throw new Error(`Could not remove the account (${res.status}).`);
}

/**
 * Forget every follower delivered through an inbox that has permanently gone
 * (404 or 410 from the remote server), so nothing is sent there again.
 */
export async function removeFollowersByInbox(env, base, inbox) {
  const filter = `or=(inbox.eq.${encodeURIComponent(inbox)},shared_inbox.eq.${encodeURIComponent(inbox)})`;
  await fetch(`${base}/rest/v1/federation_followers?${filter}`, {
    method: "DELETE",
    headers: supabaseHeaders(env),
  }).catch(() => {});
}

// ---- Lessons ----------------------------------------------------------------

const visible = "published=eq.true&shadowbanned=eq.false";

/** One page of an author's public lessons, newest first, without their documents. */
export async function listPublishedLessons(
  env,
  base,
  userId,
  { offset = 0, limit = PAGE } = {},
) {
  const url = `${base}/rest/v1/lessons?author_id=eq.${encodeURIComponent(userId)}&${visible}&select=${LESSON_COLUMNS}&order=created_at.desc&offset=${offset}&limit=${limit}`;
  return (await rows(env, url)) || [];
}

export function countPublishedLessons(env, base, userId) {
  const by = userId ? `author_id=eq.${encodeURIComponent(userId)}&` : "";
  return count(env, `${base}/rest/v1/lessons?${by}${visible}&select=id`);
}

/** How many comments the hub holds, for NodeInfo, which requires the number. */
export function countComments(env, base) {
  return count(env, `${base}/rest/v1/comments?select=id`);
}

/**
 * A public lesson by id, with its document so the Article can carry an
 * excerpt, or null when there is no such lesson or it is not public. A draft
 * and a shadowbanned lesson are both "not there" to another server.
 */
export async function fetchPublishedLesson(env, base, lessonId) {
  const url = `${base}/rest/v1/lessons?id=eq.${encodeURIComponent(lessonId)}&${visible}&select=${LESSON_COLUMNS},doc&limit=1`;
  const found = await rows(env, url);
  return found?.[0] || null;
}
