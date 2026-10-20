// Lessons on other instances, for forking them here.
//
//   GET /remote                            public -> { available }, whether this instance can
//   GET /remote/lesson?url=<lesson page>   Bearer -> { lesson }
//   GET /remote/pack?url=<pack url>        Bearer -> the packfile, as GET /git/:id/pack serves it
//
// The browser cannot read another instance itself: that instance's API only
// answers cross-origin reads from its own app, which is right. So this server
// reads on the visitor's behalf, which means it is fetching an address a
// visitor typed. lib/federation/remote.js is where that is made safe: private
// addresses refused (at connect time, on the Node host), redirects checked one
// by one, bodies read up to a cap, a deadline on every fetch, and the
// lesson's links held to the instance that serves it. This file only shapes
// the answers.
//
// The two fetching routes need a signed-in caller: a proxy anyone could point
// anywhere is a resource to abuse even with those limits.

import { bearerToken } from '../lib/auth.js';
import { federationEnabled, fetchRemoteHistory, fetchRemoteLesson } from '../lib/federation/index.js';
import { textResponse, jsonResponse } from '../lib/http.js';
import { verifySupabaseUser } from '../lib/supabase.js';

const NOT_FEDERATING = 'This instance does not federate, so it cannot copy lessons from others.';

/** The `url` query parameter as a URL, or null when it is missing or malformed. */
function urlParam(url) {
	const raw = (url.searchParams.get('url') || '').trim();
	if (!raw || raw.length > 2048) return null;
	try {
		return new URL(raw);
	} catch {
		return null;
	}
}

async function signedIn(request, env, cors) {
	const user = await verifySupabaseUser(env, bearerToken(request));
	return user ? null : textResponse('Please sign in to copy a lesson from another instance.', 401, cors);
}

/** A RemoteLessonError as the answer it names, anything else as a 502. */
function failure(error, cors, what) {
	if (error && error.name === 'RemoteLessonError') return textResponse(error.message, error.status, cors);
	console.error(`remote ${what}:`, error);
	return textResponse(`Could not read that ${what}.`, 502, cors);
}

/**
 * GET /remote: whether this instance can copy lessons from others, which is
 * whether it federates. The hub asks before offering the button, rather than
 * letting somebody paste an address and find out in the editor.
 */
export function handleRemoteInfo(env, cors) {
	return jsonResponse({ available: federationEnabled(env) }, 200, cors);
}

/** GET /remote/lesson?url= */
export async function handleRemoteLesson(request, env, url, cors) {
	if (request.method !== 'GET') return textResponse('Method not allowed.', 405, cors);
	if (!federationEnabled(env)) return textResponse(NOT_FEDERATING, 501, cors);
	const denied = await signedIn(request, env, cors);
	if (denied) return denied;

	const target = urlParam(url);
	if (!target) return textResponse('Paste the web address of a lesson on another instance.', 400, cors);
	try {
		return jsonResponse({ lesson: await fetchRemoteLesson(env, target) }, 200, cors);
	} catch (error) {
		return failure(error, cors, 'lesson');
	}
}

/** GET /remote/pack?url= */
export async function handleRemotePack(request, env, url, cors) {
	if (request.method !== 'GET') return textResponse('Method not allowed.', 405, cors);
	if (!federationEnabled(env)) return textResponse(NOT_FEDERATING, 501, cors);
	const denied = await signedIn(request, env, cors);
	if (denied) return denied;

	const target = urlParam(url);
	if (!target) return textResponse('That is not the address of a lesson history.', 400, cors);
	let pack;
	try {
		pack = await fetchRemoteHistory(env, target);
	} catch (error) {
		return failure(error, cors, 'history');
	}

	const headers = new Headers(cors);
	headers.set('Content-Type', 'application/x-git-packfile');
	headers.set('Cache-Control', 'no-store');
	// The tip and branch map ride on the same response as the bytes, as they do
	// from /git/:id/pack and for the same reason. Both were checked before they
	// got here: they come from somebody else's server.
	headers.set('X-Git-Head', pack.head);
	if (pack.refs) headers.set('X-Git-Refs', pack.refs);
	headers.set('Access-Control-Expose-Headers', 'X-Git-Head, X-Git-Refs');
	return new Response(pack.bytes, { status: 200, headers });
}
