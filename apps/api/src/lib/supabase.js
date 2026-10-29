// Talking to Supabase: REST (PostgREST) + Auth (GoTrue) with the service-role
// key, which bypasses RLS and so lives only on the Worker, never in the browser.

/**
 * The Supabase project URL with any trailing slash trimmed — the base every REST
 * and Auth call is built on.
 */
export function supabaseBase(env) {
  return env.SUPABASE_URL.replace(/\/$/, "");
}

/** Whether the Supabase service-role credentials are configured. */
export function supabaseConfigured(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Headers for talking to Supabase's REST (PostgREST) and Auth APIs with the
 * service-role key. The service-role key bypasses RLS, so it lives only on the
 * Worker and is never shipped to the browser.
 */
export function supabaseHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  };
}

/**
 * Whether a failed PostgREST response is it not knowing `column`: a database
 * that hasn't had schema.sql's latest `alter`s applied yet. Reading a column
 * that doesn't exist is Postgres's 42703; writing one is PostgREST's PGRST204
 * ("Could not find the ... column ... in the schema cache"). Both name the
 * column in the message, which is how a different missing column is told apart.
 *
 * For the few places that write or read a column newer than the deploy that
 * uses it, so a Worker shipped before the migration degrades instead of
 * failing. Reads the body, so pass a response that is going to be discarded.
 *
 * @param {Response} res
 * @param {string} column
 */
export async function isMissingColumn(res, column) {
  if (res.ok || res.status !== 400) return false;
  const error = await res.json().catch(() => null);
  if (!error || (error.code !== "42703" && error.code !== "PGRST204"))
    return false;
  return String(error.message || "").includes(column);
}

/**
 * Verify a Supabase session JWT by asking Supabase Auth who it belongs to.
 *
 * We call GET /auth/v1/user with the client-supplied token rather than checking
 * an HS256 signature ourselves: it needs no JWT secret, and it keeps working if
 * the project switches to asymmetric (RS256/ES256) signing keys. Returns the
 * verified user object on success, or null if the token is missing/invalid.
 */
export async function verifySupabaseUser(env, token) {
  if (!token) return null;
  let res;
  try {
    res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (e) {
    return null;
  }
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return user && user.id ? user : null;
}

/**
 * Look up an auth user by email via the Supabase Admin API (service-role). GoTrue
 * offers no email filter, so page the admin user list and match. Bounded so a huge
 * user base can't spin forever. Returns the user object or null.
 */
export async function findAuthUserByEmail(env, email) {
  const target = (email || "").trim().toLowerCase();
  if (!target) return null;
  const baseUrl = supabaseBase(env);
  const perPage = 200;
  for (let page = 1; page <= 20; page++) {
    let res;
    try {
      res = await fetch(
        `${baseUrl}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
        { headers: supabaseHeaders(env) },
      );
    } catch (e) {
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const users = Array.isArray(data)
      ? data
      : data && Array.isArray(data.users)
        ? data.users
        : [];
    const match = users.find((u) => (u.email || "").toLowerCase() === target);
    if (match) return match;
    if (users.length < perPage) return null; // reached the last page
  }
  return null;
}

/**
 * Fetch a single auth user by id via the Admin API. Used to attach emails to the
 * moderator list. Returns the user object or null.
 */
export async function getAuthUserById(env, id) {
  const baseUrl = supabaseBase(env);
  let res;
  try {
    res = await fetch(
      `${baseUrl}/auth/v1/admin/users/${encodeURIComponent(id)}`,
      { headers: supabaseHeaders(env) },
    );
  } catch (e) {
    return null;
  }
  if (!res.ok) return null;
  return await res.json().catch(() => null);
}

/**
 * Look up a user's public profile fields by id via the Admin API (service-role).
 * Returns { id, displayName, bio } or null if there's no such user. We never
 * expose the email — only the chosen display name and bio.
 */
export async function fetchPublicUser(env, base, userId) {
  return (await lookupPublicUser(env, base, userId)).user;
}

// Supabase user ids are UUIDs. Anything else can't name a user, so it is
// answered as missing without asking GoTrue (which would reject it as a bad
// request, indistinguishable from a broken one).
const USER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * fetchPublicUser, telling apart the two ways of finding nobody: `missing` is
 * true when there is no such user, false when the lookup itself failed
 * (unreachable, 5xx, rate-limited, a bad service key). Callers whose answer is
 * a status code need the difference: a profile that doesn't exist is a 404,
 * while one that couldn't be looked up is an outage, and answering that with a
 * 404 tells crawlers real profiles are gone (the server render repeats an API
 * 404 as a real one; see routes/ssr.js).
 *
 * @returns {Promise<{user: {id: string, displayName: string, bio: string}|null, missing: boolean}>}
 */
export async function lookupPublicUser(env, base, userId) {
  if (!USER_ID_RE.test(userId || "")) return { user: null, missing: true };
  let res;
  try {
    res = await fetch(
      `${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
      {
        headers: supabaseHeaders(env),
      },
    );
  } catch (e) {
    return { user: null, missing: false };
  }
  if (res.status === 404) return { user: null, missing: true };
  if (!res.ok) return { user: null, missing: false };
  const user = await res.json().catch(() => null);
  if (!user || !user.id) return { user: null, missing: false };
  const meta = user.user_metadata || {};
  return {
    user: {
      id: user.id,
      displayName: (meta.display_name || "").toString().trim() || "Anonymous",
      bio: (meta.bio || "").toString().trim(),
    },
    missing: false,
  };
}
