// Reading a lesson that lives on another instance, so it can be forked here.
//
// The lesson is found the way the fediverse finds anything: its page URL is
// fetched as ActivityPub and comes back as the Article that instance serves
// for it (see article.js for ours). The Article carries two attachments that
// are this app's own: a link to the lesson's JSON document and one to its
// packed git history. Those are what a fork is made from, exactly as a fork
// from this hub is made from `GET /lessons/:id` and `GET /git/:id/pack`.
//
// Every one of these fetches goes to an address a visitor chose, so every one
// goes through the same guards:
//
//   - the address has to be http(s), and not a private address written as one
//     (assertFetchable);
//   - the connection itself is made by the host's `remoteFetch`, which on the
//     Node host refuses a name that resolves to a private address when the
//     socket opens, so DNS rebinding between the check and the fetch gains
//     nothing (node/remoteFetch.js);
//   - redirects are followed by hand, each new address checked the same way;
//   - bodies are read up to a cap, never buffered whole (readCapped), and the
//     whole fetch has a deadline.
//
// The Article is parsed by Fedify, but fetched here, through a document loader
// built from those pieces rather than Fedify's own, which checks an address
// and then fetches it separately (see loadRemoteObject). The two attachments,
// and the address the fork is credited to, all have to be on the Article's own
// origin.

import { preloadedContexts, validatePublicUrl } from '@fedify/fedify';
import { Article, Link, Object as ActivityPubObject } from '@fedify/vocab';

import { remoteFetch } from '../../platform/index.js';
import { readCapped } from '../http.js';
import { MAX_PACK_BYTES, OID_RE, isPackfile, parseRefMap, serializeRefMap } from '../lessonGit.js';
import { ID_RE } from './store.js';

// A lesson document arrives as JSON; an older one may carry base64 images
// inline, which is what makes the ceiling this generous.
export const MAX_DOC_BYTES = 20 * 1024 * 1024;

// Long enough for a slow server on the far side of the world; short enough
// that a server that drips its answer cannot hold the request open.
export const REMOTE_TIMEOUT_MS = 15_000;

const MAX_REDIRECTS = 3;

const ACTIVITYPUB_ACCEPT = 'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"';

/** What went wrong, with the status the route should answer with. */
export class RemoteLessonError extends Error {
	constructor(message, status = 400) {
		super(message);
		this.name = 'RemoteLessonError';
		this.status = status;
	}
}

/**
 * The URL of a lesson's packed history on its own instance, which is what a
 * fork clones. Only this shape is ever proxied (see routes/remote.js): a
 * visitor can point the proxy at a lesson's history and at nothing else.
 */
export function remotePackPath(url) {
	const m = /^\/git\/([^/]+)\/pack$/.exec(url.pathname);
	return m && ID_RE.test(m[1]) ? m[1] : null;
}

/**
 * Refuse a URL this server must not fetch on a visitor's behalf: anything but
 * http(s), and, unless the instance is set up for two servers on one machine,
 * anything that resolves to a private address.
 */
export async function assertFetchable(env, url) {
	if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new RemoteLessonError('That is not a web address.');
	if (String(env.FEDERATION_ALLOW_PRIVATE_ADDRESSES || '').toLowerCase() === 'true') return;
	try {
		await validatePublicUrl(url.href);
	} catch {
		throw new RemoteLessonError('That address is not reachable from here.');
	}
}

/**
 * GET an address a visitor chose, following up to `redirects` redirects by
 * hand so that every address on the way is checked, and read its body up to
 * `maxBytes`. A response that is not OK comes back with no bytes.
 *
 * @returns {Promise<{ response: Response, url: URL, bytes: Uint8Array }>}
 */
export async function fetchRemote(env, url, { accept, maxBytes, redirects = MAX_REDIRECTS }) {
	let target = url;
	for (let hop = 0; hop <= redirects; hop++) {
		await assertFetchable(env, target);
		let response;
		try {
			response = await remoteFetch(env)(target.href, {
				headers: { Accept: accept },
				redirect: 'manual',
				signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
			});
		} catch {
			throw new RemoteLessonError('Could not reach the other instance.', 502);
		}
		const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
		if (location) {
			await response.body?.cancel().catch(() => {});
			try {
				target = new URL(location, target);
			} catch {
				throw new RemoteLessonError('The other instance sent a broken redirect.', 502);
			}
			continue;
		}
		if (!response.ok) {
			await response.body?.cancel().catch(() => {});
			return { response, url: target, bytes: new Uint8Array(0) };
		}
		let bytes;
		try {
			bytes = await readCapped(response, maxBytes);
		} catch {
			throw new RemoteLessonError('Could not reach the other instance.', 502);
		}
		if (bytes === null) throw new RemoteLessonError('That is too large to copy.', 413);
		return { response, url: target, bytes };
	}
	throw new RemoteLessonError('The other instance redirected too many times.', 502);
}

/**
 * The packed history at a lesson's history address on another instance, with
 * the tip and branch map that travel in its headers, both checked: they go on
 * to the browser, and a tip that is not a commit id would have it clone a
 * history pointing at nothing.
 *
 * @returns {Promise<{ bytes: Uint8Array, head: string, refs: string | null }>}
 */
export async function fetchRemotePack(env, url) {
	if (!remotePackPath(url)) throw new RemoteLessonError('That is not the address of a lesson history.');
	// No redirects: a history lives at one address, and the proxy only ever
	// fetches that shape of address.
	const { response, bytes } = await fetchRemote(env, url, { accept: 'application/x-git-packfile', maxBytes: MAX_PACK_BYTES, redirects: 0 });
	if (response.status === 404) throw new RemoteLessonError('That lesson has no history to copy.', 404);
	if (!response.ok) throw new RemoteLessonError('The other instance would not give out the history.', 502);
	if (bytes.byteLength === 0 || !isPackfile(bytes)) {
		throw new RemoteLessonError('The other instance answered with something that is not a history.', 502);
	}
	const head = (response.headers.get('X-Git-Head') || '').trim();
	if (!OID_RE.test(head)) throw new RemoteLessonError('The other instance did not say which version its history points at.', 502);
	// A branch map that cannot be read, or that disagrees with the tip, is left
	// out rather than refused: the tip alone is enough to clone the lesson.
	const map = parseRefMap(response.headers.get('X-Git-Refs'));
	const refs = map && map.main === head ? serializeRefMap(map) : null;
	return { bytes, head, refs };
}

/** A JSON-LD document loader for Fedify built on fetchRemote. */
function remoteDocumentLoader(env) {
	return async (url) => {
		const { response, url: final, bytes } = await fetchRemote(env, new URL(url), { accept: ACTIVITYPUB_ACCEPT, maxBytes: MAX_DOC_BYTES });
		if (!response.ok) throw new RemoteLessonError(`The other instance answered ${response.status}.`, response.status === 404 ? 404 : 502);
		return { contextUrl: null, document: JSON.parse(new TextDecoder().decode(bytes)), documentUrl: final.href };
	};
}

/**
 * A JSON-LD context loader: the contexts Fedify ships with (ActivityStreams,
 * the security vocabularies and the rest an Article uses), and anything else
 * through the same guarded loader as the document itself.
 */
function remoteContextLoader(documentLoader) {
	return (url) =>
		Object.hasOwn(preloadedContexts, url) ? { contextUrl: null, document: preloadedContexts[url], documentUrl: url } : documentLoader(url);
}

/**
 * The ActivityPub object at an address, or null when there is none.
 *
 * Fedify's `lookupObject` would do this, but it falls back to a WebFinger
 * request with its own fetch when the document cannot be loaded, which is an
 * address chosen here fetched outside these guards. So the document is loaded
 * here and handed to Fedify only to parse, with the check `lookupObject`
 * makes kept: an object whose id is on another origin than the address that
 * served it is not that origin's to speak for.
 */
async function loadRemoteObject(env, url) {
	const documentLoader = remoteDocumentLoader(env);
	const contextLoader = remoteContextLoader(documentLoader);
	let loaded;
	try {
		loaded = await documentLoader(url.href);
	} catch {
		return null;
	}
	let object;
	try {
		object = await ActivityPubObject.fromJsonLd(loaded.document, { documentLoader, contextLoader, baseUrl: new URL(loaded.documentUrl) });
	} catch {
		return null;
	}
	if (object?.id == null || object.id.origin !== new URL(loaded.documentUrl).origin) return null;
	return { object, documentLoader, contextLoader };
}

/**
 * Find the lesson behind a URL on another instance.
 *
 * @param {import('@fedify/fedify').Context<{ env: object }>} ctx
 * @param {URL} url  The lesson's page on the other instance, or its Article's id.
 * @returns {Promise<{ url: string, origin: string, title: string, author: string, sectionCount: number, createdAt: string | null, doc: object, packUrl: string }>}
 */
export async function lookupRemoteLesson(ctx, url) {
	const { env } = ctx.data;
	const found = await loadRemoteObject(env, url);
	const object = found?.object;
	if (!(object instanceof Article) || object.id == null) {
		throw new RemoteLessonError(
			'No lesson was found at that address. It has to be a lesson page on a Spelling Creator instance that federates.',
			404,
		);
	}
	const origin = object.id.origin;
	if (origin === ctx.canonicalOrigin) {
		throw new RemoteLessonError('That lesson is on this hub. Open it and choose Fork.');
	}

	// The two links another instance of this app put there for exactly this.
	let docUrl = null;
	let packUrl = null;
	// An attachment given as a bare URL would be dereferenced; through the
	// same guarded loaders, so it is no way around them.
	for await (const attachment of object.getAttachments({ documentLoader: found.documentLoader, contextLoader: found.contextLoader })) {
		if (!(attachment instanceof Link) || attachment.href == null) continue;
		if (attachment.href.origin !== origin) continue;
		if (attachment.mediaType === 'application/json') docUrl = attachment.href;
		if (attachment.mediaType === 'application/x-git-packfile' && remotePackPath(attachment.href)) packUrl = attachment.href;
	}
	if (!docUrl) throw new RemoteLessonError('That lesson cannot be copied from here: its instance does not offer its document.', 502);

	const { response, bytes } = await fetchRemote(env, docUrl, { accept: 'application/json', maxBytes: MAX_DOC_BYTES });
	if (!response.ok) throw new RemoteLessonError('The other instance would not give out the lesson.', 502);
	let data;
	try {
		data = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		throw new RemoteLessonError('The other instance answered with something that is not a lesson.', 502);
	}
	const lesson = data?.lesson;
	const doc = lesson?.doc;
	if (!doc || typeof doc !== 'object' || !Array.isArray(doc.sections) || doc.sections.length === 0) {
		throw new RemoteLessonError('The other instance answered with something that is not a lesson.', 502);
	}
	// The other instance strips these before answering; this is for one that
	// does not. The list is other people's email addresses either way.
	delete doc.trustedCollaborators;

	// Where the fork will say it came from, so it has to be the Article's own
	// instance: an Article on one server claiming a page on another would have
	// the fork credit, and send its readers to, a lesson it is not.
	const page = object.url instanceof URL && object.url.origin === origin ? object.url : object.id;

	return {
		url: page.href,
		origin,
		title: (lesson.title || doc.title || '').toString().trim() || 'Untitled Lesson',
		author: (lesson.author || '').toString().trim() || 'Anonymous',
		sectionCount: Number(lesson.sectionCount) || doc.sections.length,
		createdAt: typeof lesson.createdAt === 'string' ? lesson.createdAt : null,
		doc,
		packUrl: packUrl ? packUrl.href : null,
	};
}
