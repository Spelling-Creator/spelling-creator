// Lessons on other instances, for forking them here.
//
//   GET /remote/lesson?url=<lesson page>   Bearer -> { lesson }
//   GET /remote/pack?url=<pack url>        Bearer -> the packfile, as GET /git/:id/pack serves it
//
// The browser cannot read another instance itself: that instance's API only
// answers cross-origin reads from its own app, which is right. So this server
// reads on the visitor's behalf, which means it is fetching an address a
// visitor typed, and both routes are shaped around that. The first finds the
// lesson through ActivityPub, where Fedify's loader refuses private addresses
// and the lesson's links have to be on the origin it found (lib/federation/
// remote.js). The second only ever fetches one shape of URL, a lesson's packed
// history, on a public address, and passes the bytes through unchanged once
// they have been checked to be a packfile.
//
// Both need a signed-in caller: a proxy anyone could point anywhere is a
// resource to abuse even with those limits.

import { bearerToken } from '../lib/auth.js';
import { assertRemoteFetchable, federationEnabled, fetchRemoteLesson, remotePackLessonId } from '../lib/federation/index.js';
import { textResponse, jsonResponse } from '../lib/http.js';
import { MAX_PACK_BYTES, isPackfile } from '../lib/lessonGit.js';
import { verifySupabaseUser } from '../lib/supabase.js';

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

/** GET /remote/lesson?url= */
export async function handleRemoteLesson(request, env, url, cors) {
	if (request.method !== 'GET') return textResponse('Method not allowed.', 405, cors);
	if (!federationEnabled(env)) return textResponse('This instance does not federate, so it cannot copy lessons from others.', 501, cors);
	const denied = await signedIn(request, env, cors);
	if (denied) return denied;

	const target = urlParam(url);
	if (!target) return textResponse('Paste the web address of a lesson on another instance.', 400, cors);

	try {
		await assertRemoteFetchable(env, target);
		const lesson = await fetchRemoteLesson(env, target);
		return jsonResponse({ lesson }, 200, cors);
	} catch (error) {
		if (error && error.name === 'RemoteLessonError') return textResponse(error.message, error.status, cors);
		console.error('remote lesson:', error);
		return textResponse('Could not read that lesson.', 502, cors);
	}
}

/** GET /remote/pack?url= */
export async function handleRemotePack(request, env, url, cors) {
	if (request.method !== 'GET') return textResponse('Method not allowed.', 405, cors);
	if (!federationEnabled(env)) return textResponse('This instance does not federate, so it cannot copy lessons from others.', 501, cors);
	const denied = await signedIn(request, env, cors);
	if (denied) return denied;

	const target = urlParam(url);
	if (!target || !(await remotePackLessonId(target))) return textResponse('That is not the address of a lesson history.', 400, cors);
	try {
		await assertRemoteFetchable(env, target);
	} catch (error) {
		return textResponse(error.message || 'That address is not reachable from here.', 400, cors);
	}

	let res;
	try {
		// No redirects: a redirect is a new address, and that one was never checked.
		res = await fetch(target, { headers: { Accept: 'application/x-git-packfile' }, redirect: 'error' });
	} catch {
		return textResponse('Could not reach the other instance.', 502, cors);
	}
	if (res.status === 404) return textResponse('That lesson has no history to copy.', 404, cors);
	if (!res.ok) return textResponse('The other instance would not give out the history.', 502, cors);
	if (Number(res.headers.get('content-length') || 0) > MAX_PACK_BYTES) {
		return textResponse('That lesson has too much history to copy.', 413, cors);
	}
	const bytes = new Uint8Array(await res.arrayBuffer());
	if (bytes.byteLength > MAX_PACK_BYTES) return textResponse('That lesson has too much history to copy.', 413, cors);
	if (bytes.byteLength === 0 || !isPackfile(bytes))
		return textResponse('The other instance answered with something that is not a history.', 502, cors);

	const headers = new Headers(cors);
	headers.set('Content-Type', 'application/x-git-packfile');
	headers.set('Cache-Control', 'no-store');
	// The tip and branch map ride on the same response as the bytes, as they do
	// from /git/:id/pack and for the same reason.
	const head = (res.headers.get('X-Git-Head') || '').trim();
	if (!head) return textResponse('The other instance did not say which version its history points at.', 502, cors);
	headers.set('X-Git-Head', head);
	const refs = res.headers.get('X-Git-Refs') || '';
	if (refs) headers.set('X-Git-Refs', refs);
	headers.set('Access-Control-Expose-Headers', 'X-Git-Head, X-Git-Refs');
	return new Response(bytes, { status: 200, headers });
}
