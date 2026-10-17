// The letterboard session entry: wss://<hub>/practice/<code>.
//
// A Practice page (the host) opens the socket with `?create=1&token=<jwt>`, like
// a collaboration host; a letterboard (a board) opens it with nothing at all,
// since the board has no account. We decide the role here, verify the host's
// Supabase JWT, apply the join limits, and forward the upgrade to the
// PracticeRoom Durable Object for that code with the role in a header. The relay
// itself is src/practice-room.js; the contract both sides follow is
// docs/live-sync.md in the board's repository.
//
// Boards are anonymous, so their joins are limited by client IP where a
// collaboration join is limited by user. The code is the only secret, and the
// limit is what keeps guessing one from being cheap.

import { verifySupabaseUser } from '../lib/supabase.js';
import { clientIp } from '../lib/auth.js';
import { jsonResponse } from '../lib/http.js';
import { takeJoinToken } from '../lib/joinLimit.js';
import { rateLimitStore } from '../platform/index.js';
import { SESSION_CODE_RE } from './collab.js';

// A board is at the limit after this many joins in a minute from one address.
// Generous for a tablet that reconnects after a dropped connection, and a dead
// end for guessing: the shortest code the Practice page issues has about a
// billion possibilities.
const BOARD_JOIN_LIMIT = 10;

/**
 * The share code in a /practice/<code> path, or null when the path isn't one.
 *
 * Codes are matched without regard to case: the Practice page shows one in
 * capitals, and a partner typing it on a tablet shouldn't have to hold shift.
 * The room is addressed by the normalized form, so both spellings reach it.
 *
 * @param {string} pathname
 * @returns {string|null}
 */
export function parsePracticeCode(pathname) {
	const m = /^\/practice\/([^/]+)\/?$/.exec(pathname);
	if (!m) return null;
	let code;
	try {
		code = decodeURIComponent(m[1]).trim();
	} catch {
		return null;
	}
	if (!SESSION_CODE_RE.test(code)) return null;
	return code.toUpperCase();
}

/**
 * Whether this hub can host letterboard sessions: GET /practice.
 *
 *   -> 200 { available: true | false }
 *
 * The Practice page asks before offering its letterboard button. Only the Worker
 * registers this route, so a self-hosted Node instance answers 404 from the
 * frontend fall-through, which the page reads as "not available" just like
 * `available: false` (a Worker deployed without the PRACTICE_ROOM binding).
 */
export function handlePracticeInfo(env, cors) {
	return jsonResponse({ available: Boolean(env.PRACTICE_ROOM) }, 200, cors);
}

/**
 * Letterboard session WebSocket entry.
 *
 *   wss://<api>/practice/<code>?create=1&token=<jwt>   the Practice page (host)
 *   wss://<api>/practice/<code>                        a letterboard (board)
 *
 * The host's token rides in the query because a browser can't set an
 * Authorization header on a WebSocket. Nothing about the token or the query
 * reaches the room: the verified role goes over as X-Practice-Role instead.
 */
export async function handlePractice(request, env, url, cors) {
	if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
		return new Response('Expected a WebSocket upgrade.', { status: 426, headers: cors });
	}
	if (!env.PRACTICE_ROOM) {
		return new Response('Letterboard sync is not configured.', { status: 500, headers: cors });
	}

	const code = parsePracticeCode(url.pathname);
	if (!code) {
		return new Response('Invalid session code.', { status: 400, headers: cors });
	}

	const kv = rateLimitStore(env);
	if (!kv) {
		return new Response('Server misconfiguration: no rate-limit store configured', { status: 500, headers: cors });
	}

	const create = url.searchParams.get('create') === '1';
	if (create) {
		// The host runs the lesson and records the answers through the signed-in
		// responses endpoint, so it has to be signed in.
		const user = await verifySupabaseUser(env, url.searchParams.get('token') || '');
		if (!user) {
			return new Response('Sign in to run a lesson for a letterboard.', { status: 401, headers: cors });
		}
		const limited = await takeJoinToken(kv, `practice-rl:user:${user.id}`, {
			message: 'Too many letterboard sessions started. Please wait a moment.',
			cors,
		});
		if (limited) return limited;
	} else {
		const ip = clientIp(env, request) || 'unknown';
		const limited = await takeJoinToken(kv, `practice-rl:ip:${ip}`, {
			message: 'Too many attempts to join a letterboard session. Please wait a moment.',
			cors,
			limit: BOARD_JOIN_LIMIT,
		});
		if (limited) return limited;
	}

	// Forward the upgrade with the role we established. A client-supplied copy of
	// the header is dropped first, and the token never leaves this Worker.
	const headers = new Headers(request.headers);
	headers.delete('X-Practice-Role');
	headers.set('X-Practice-Role', create ? 'host' : 'board');
	const forward = new URL(url.toString());
	forward.pathname = `/practice/${code}`;
	forward.search = '';

	const stub = env.PRACTICE_ROOM.get(env.PRACTICE_ROOM.idFromName(code));
	return stub.fetch(new Request(forward.toString(), { method: 'GET', headers }));
}
