// A connection rate limit, shared by every door into a live room: a socket or
// agent join to a collaboration session (routes/collab.js) and a host or board
// join to a letterboard session (routes/practice.js). Each is a request to be let
// into a room, and each is cheap to spam, so each takes a token from a bucket in
// the rate-limit store first. ALTCHA challenges (routes/altcha.js) use it too:
// just as cheap to ask for, and each one costs the server some work to make.
//
// Token bucket, keyed by whatever identifies the caller: a user id where there is
// a sign-in, the client IP where there isn't (boards join anonymously). The bucket
// refills continuously, so a burst at the limit is allowed and sustained traffic
// above it is not.

const DEFAULT_LIMIT = 5;
const DEFAULT_WINDOW_SECONDS = 60;

/**
 * Take one join token for `key`, or explain why not.
 *
 * @param {{ get(key: string): Promise<string|null>, put(key: string, value: string, opts?: object): Promise<void> }} kv
 *   The rate-limit store (see platform/index.js).
 * @param {string} key          The bucket, e.g. `collab-rl:<uid>` or `practice-rl:ip:<ip>`.
 * @param {object} opts
 * @param {string} opts.message The 429 body when the caller is over budget.
 * @param {object} [opts.cors]  CORS headers for the refusal.
 * @param {number} [opts.limit] Joins allowed per window (the bucket's capacity).
 * @param {number} [opts.windowSeconds] How long a full bucket takes to refill.
 * @returns {Promise<Response|null>} A 429 Response when over budget, else null.
 */
export async function takeJoinToken(
  kv,
  key,
  {
    message,
    cors,
    limit = DEFAULT_LIMIT,
    windowSeconds = DEFAULT_WINDOW_SECONDS,
  },
) {
  const now = Math.floor(Date.now() / 1000);
  const entry = readBucket(await kv.get(key)) || { tokens: limit, last: now };
  entry.tokens = Math.min(
    limit,
    entry.tokens + ((now - entry.last) * limit) / windowSeconds,
  );
  entry.last = now;
  if (entry.tokens < 1) {
    const retryAfter = Math.ceil((1 - entry.tokens) * (windowSeconds / limit));
    return new Response(message, {
      status: 429,
      headers: { ...(cors || {}), "Retry-After": String(retryAfter) },
    });
  }
  entry.tokens -= 1;
  await kv.put(key, JSON.stringify(entry), {
    expirationTtl: windowSeconds * 2,
  });
  return null;
}

// A stored bucket, or null for none. A row that isn't one (corrupt, or written
// by something else under the same key) counts as none and starts a fresh,
// full bucket: failing every join with a 500 until the row expired would be
// worse than briefly forgetting how many joins came before.
function readBucket(raw) {
  if (!raw) return null;
  let entry;
  try {
    entry = JSON.parse(raw);
  } catch {
    return null;
  }
  return entry && Number.isFinite(entry.tokens) && Number.isFinite(entry.last)
    ? entry
    : null;
}
