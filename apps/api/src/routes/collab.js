// Live-collaboration entry. We verify the Supabase JWT here (so only logged-in
// users reach the Durable Object and their identity is server-trusted), apply
// heavy connection rate limits, then forward to the CollabRoom DO for that
// session code. The realtime relay lives in src/collab-room.js.
//
// Two ways in. A browser opens a WebSocket (handleCollab). An AI assistant,
// joining through the MCP server, can't hold a socket between tool calls, so it
// takes part over plain HTTP instead (handleCollabAgent): the same room, the
// same admission by the host, the same roster entry, just asked for rather than
// pushed. See the agent section of collab-room.js.

import { verifySupabaseUser } from '../lib/supabase.js';
import { displayNameOf } from '../lib/auth.js';
import { rateLimitStore } from '../platform/index.js';

// The assistant label is arbitrary text from the connecting client (an MCP
// client's self-reported name — "Claude Desktop", "Cursor"), so it is bounded
// and stripped of anything that would let it impersonate the rest of the roster
// entry. Same reasoning as assistantNote in apps/mcp/src/git.js: a name nobody
// vetted must not crowd out the name that was verified.
const ASSISTANT_LABEL_MAX = 40;

export function clampLabel(raw) {
	const text = (raw || '')
		.replace(/[\p{C}\p{Zl}\p{Zp}]/gu, ' ') // control chars and line breaks
		.replace(/·/g, '-') // the separator itself, so a label can't fake a second one
		.replace(/\s+/g, ' ')
		.trim();
	if (!text) return '';
	return text.length <= ASSISTANT_LABEL_MAX ? text : `${text.slice(0, ASSISTANT_LABEL_MAX - 3).trimEnd()}...`;
}

const CODE_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The agent endpoints, parsed: /collab/<code>/agent[/update|/chat]. Null for
 * any other path, which is how the router tells these from the WebSocket path
 * /collab/<code>.
 * @returns {{ code: string, action: 'session' | 'update' | 'chat' } | null}
 */
export function parseAgentPath(pathname) {
	const m = /^\/collab\/([^/]+)\/agent(?:\/(update|chat))?\/?$/.exec(pathname);
	if (!m) return null;
	let code;
	try {
		code = decodeURIComponent(m[1]).trim();
	} catch {
		return null;
	}
	if (!CODE_RE.test(code)) return null;
	return { code, action: m[2] || 'session' };
}

// Connection rate limit (token bucket): at most 5 joins/min per user. Shared by
// a socket join and an agent join; both are a request to be let into a room.
// Returns a 429 Response when the user is over budget, else null.
async function takeJoinToken(kv, userId, cors) {
	const JOIN_LIMIT = 5;
	const JOIN_WINDOW = 60;
	const now = Math.floor(Date.now() / 1000);
	const rlKey = `collab-rl:${userId}`;
	const raw = await kv.get(rlKey);
	let entry = raw ? JSON.parse(raw) : { tokens: JOIN_LIMIT, last: now };
	entry.tokens = Math.min(JOIN_LIMIT, entry.tokens + ((now - entry.last) * JOIN_LIMIT) / JOIN_WINDOW);
	entry.last = now;
	if (entry.tokens < 1) {
		const retryAfter = Math.ceil((1 - entry.tokens) * (JOIN_WINDOW / JOIN_LIMIT));
		return new Response('Too many collaboration attempts. Please wait a moment.', {
			status: 429,
			headers: { ...cors, 'Retry-After': String(retryAfter) },
		});
	}
	entry.tokens -= 1;
	await kv.put(rlKey, JSON.stringify(entry), { expirationTtl: JOIN_WINDOW * 2 });
	return null;
}

// The identity headers the room trusts, from the verified user. Built fresh
// rather than copied from the client's request, so nothing a client sent under
// these names survives. `assistant` is the clamped label, or '' for a person.
function identityHeaders(user, assistant) {
	const name = displayNameOf(user) || (user.email ? user.email.split('@')[0] : '');
	const meta = user.user_metadata || {};
	const headers = new Headers();
	headers.set('X-Collab-Uid', encodeURIComponent(user.id));
	headers.set('X-Collab-Name', encodeURIComponent(assistant ? `${name} · ${assistant}` : name));
	if (assistant) headers.set('X-Collab-Bot', '1');
	headers.set('X-Collab-Email', encodeURIComponent(user.email || ''));
	headers.set('X-Collab-Avatar', encodeURIComponent(meta.avatar_url || meta.picture || ''));
	return headers;
}

/**
 * Live-collaboration WebSocket entry. A browser opens
 *   wss://<api>/collab/<code>?token=<jwt>[&create=1]
 * and we (1) verify the Supabase JWT here so only logged-in users ever reach the
 * Durable Object and their identity is server-trusted, (2) apply heavy connection
 * rate limits, then (3) forward the upgrade to the CollabRoom DO for that code,
 * passing the verified identity as headers. The realtime relay/admission logic
 * all lives in the DO (src/collab-room.js).
 */
export async function handleCollab(request, env, url, cors) {
	if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
		return new Response('Expected a WebSocket upgrade.', { status: 426, headers: cors });
	}
	if (!env.COLLAB_ROOM) {
		return new Response('Collaboration is not configured.', { status: 500, headers: cors });
	}

	const code = decodeURIComponent(url.pathname.slice('/collab/'.length)).trim();
	if (!CODE_RE.test(code)) {
		return new Response('Invalid session code.', { status: 400, headers: cors });
	}

	// Logged-in gate: a valid Supabase session is required. WebSockets can't set
	// an Authorization header from the browser, so the token rides in the query.
	const user = await verifySupabaseUser(env, url.searchParams.get('token') || '');
	if (!user) {
		return new Response('Sign in to collaborate.', { status: 401, headers: cors });
	}
	const create = url.searchParams.get('create') === '1';

	const kv = rateLimitStore(env);
	if (!kv) {
		return new Response('Server misconfiguration: no rate-limit store configured', { status: 500, headers: cors });
	}

	const limited = await takeJoinToken(kv, user.id, cors);
	if (limited) return limited;

	// Concurrent-room cap: a user may host at most 6 live sessions at once. The
	// counter is incremented here on create and decremented by the DO when the
	// host disconnects; the TTL lets a leaked count self-heal.
	if (create) {
		const roomsKey = `collab-rooms:${user.id}`;
		const rooms = parseInt((await kv.get(roomsKey)) || '0', 10) || 0;
		if (rooms >= 6) {
			return new Response('You already have the maximum number of active collaboration sessions.', {
				status: 429,
				headers: cors,
			});
		}
		await kv.put(roomsKey, String(rooms + 1), { expirationTtl: 7200 });
	}

	// An AI assistant joining on someone's behalf over a socket says so with
	// ?assistant=<client name>, and the room shows it as a participant of its
	// own rather than as a second cursor wearing the account holder's name.
	//
	// This is SELF-DECLARED and deliberately not a security control: the account
	// is authenticated, the label is not. A connection that lies about it can only
	// make itself look like an assistant, or decline to admit that it is one —
	// neither of which grants it anything. The room already gates what matters on
	// the host admitting a participant they can see. What this buys is that the
	// honest case, which is every case we ship, is legible: the host knows which
	// cursor is a person.
	const assistant = clampLabel(url.searchParams.get('assistant'));

	// Forward the upgrade to the room's Durable Object with the verified identity.
	// The badge is scrubbed first: identityHeaders sets it only for an assistant,
	// so a client-supplied one must not survive for a person.
	const headers = new Headers(request.headers);
	headers.delete('X-Collab-Bot');
	for (const [k, v] of identityHeaders(user, assistant)) headers.set(k, v);

	const stub = env.COLLAB_ROOM.get(env.COLLAB_ROOM.idFromName(code));
	return stub.fetch(new Request(url.toString(), { method: 'GET', headers }));
}

/**
 * An assistant taking part in a session over HTTP (see agentFetch in
 * collab-room.js for the endpoints). The token travels in the Authorization
 * header like every other API call; the join body may carry
 * `{ assistant: "<client name>" }`, the same self-declared label the socket
 * path takes as a query parameter. Every ask after the join carries the
 * participant token the join issued, as X-Collab-Agent, which passes through
 * to the room untouched.
 */
export async function handleCollabAgent(request, env, url, cors) {
	const route = parseAgentPath(url.pathname);
	if (!route) {
		return new Response('Invalid session code.', { status: 400, headers: cors });
	}
	if (!env.COLLAB_ROOM) {
		return new Response('Collaboration is not configured.', { status: 500, headers: cors });
	}

	const auth = request.headers.get('Authorization') || '';
	const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
	const user = await verifySupabaseUser(env, token);
	if (!user) {
		return new Response('Sign in to collaborate.', { status: 401, headers: cors });
	}

	const joining = route.action === 'session' && request.method === 'POST';
	let assistant = '';
	let body = request.body;
	if (joining) {
		const kv = rateLimitStore(env);
		if (!kv) {
			return new Response('Server misconfiguration: no rate-limit store configured', { status: 500, headers: cors });
		}
		const limited = await takeJoinToken(kv, user.id, cors);
		if (limited) return limited;
		// The join's body is only the label; the room reads identity from headers.
		const parsed = await request.json().catch(() => null);
		assistant = clampLabel(parsed?.assistant) || 'AI assistant';
		body = null;
	}

	// An agent is always an assistant, so it always wears the badge. A join
	// names its client; a later ask doesn't need to, the record already has it.
	const headers = identityHeaders(user, assistant || 'AI assistant');
	const agentToken = request.headers.get('X-Collab-Agent');
	if (agentToken) headers.set('X-Collab-Agent', agentToken);
	const contentType = request.headers.get('Content-Type');
	if (contentType && body) headers.set('Content-Type', contentType);

	const stub = env.COLLAB_ROOM.get(env.COLLAB_ROOM.idFromName(route.code));
	const res = await stub.fetch(new Request(url.toString(), { method: request.method, headers, body }));

	// Add the CORS headers the room doesn't know about; the body passes through.
	const out = new Headers(res.headers);
	for (const [k, v] of Object.entries(cors || {})) out.set(k, v);
	return new Response(res.body, { status: res.status, headers: out });
}
