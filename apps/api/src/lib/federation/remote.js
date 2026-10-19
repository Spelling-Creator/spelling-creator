// Reading a lesson that lives on another instance, so it can be forked here.
//
// The lesson is found the way the fediverse finds anything: its page URL is
// fetched as ActivityPub and comes back as the Article that instance serves
// for it (see article.js for ours). The Article carries two attachments that
// are this app's own: a link to the lesson's JSON document and one to its
// packed git history. Those are what a fork is made from, exactly as a fork
// from this hub is made from `GET /lessons/:id` and `GET /git/:id/pack`.
//
// Fedify does the fetching of the Article, which matters: its document loader
// refuses private network addresses, follows redirects with the same rule, and
// parses the JSON-LD. The two attachments are then required to be on the same
// origin as the Article, so the only host this server ever reaches on a
// visitor's say-so is one Fedify has already vetted.

import { validatePublicUrl } from '@fedify/fedify';
import { Article, Link } from '@fedify/vocab';

import { ID_RE } from './store.js';

// A lesson document arrives as JSON; an older one may carry base64 images
// inline, which is what makes the ceiling this generous.
const MAX_DOC_BYTES = 20 * 1024 * 1024;

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
 * Find the lesson behind a URL on another instance.
 *
 * @param {import('@fedify/fedify').Context<{ env: object }>} ctx
 * @param {URL} url  The lesson's page on the other instance, or its Article's id.
 * @returns {Promise<{ url: string, origin: string, title: string, author: string, sectionCount: number, createdAt: string | null, doc: object, packUrl: string }>}
 */
export async function lookupRemoteLesson(ctx, url) {
	let object;
	try {
		object = await ctx.lookupObject(url);
	} catch {
		object = null;
	}
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
	for await (const attachment of object.getAttachments()) {
		if (!(attachment instanceof Link) || attachment.href == null) continue;
		if (attachment.href.origin !== origin) continue;
		if (attachment.mediaType === 'application/json') docUrl = attachment.href;
		if (attachment.mediaType === 'application/x-git-packfile' && remotePackPath(attachment.href)) packUrl = attachment.href;
	}
	if (!docUrl) throw new RemoteLessonError('That lesson cannot be copied from here: its instance does not offer its document.', 502);

	let res;
	try {
		res = await fetch(docUrl, { headers: { Accept: 'application/json' }, redirect: 'error' });
	} catch {
		throw new RemoteLessonError('Could not reach the other instance.', 502);
	}
	if (!res.ok) throw new RemoteLessonError('The other instance would not give out the lesson.', 502);
	if (Number(res.headers.get('content-length') || 0) > MAX_DOC_BYTES) {
		throw new RemoteLessonError('That lesson is too large to copy.', 413);
	}
	const text = await res.text();
	if (text.length > MAX_DOC_BYTES) throw new RemoteLessonError('That lesson is too large to copy.', 413);
	let data;
	try {
		data = JSON.parse(text);
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

	return {
		url: (object.url instanceof URL ? object.url : object.id).href,
		origin,
		title: (lesson.title || doc.title || '').toString().trim() || 'Untitled Lesson',
		author: (lesson.author || '').toString().trim() || 'Anonymous',
		sectionCount: Number(lesson.sectionCount) || doc.sections.length,
		createdAt: typeof lesson.createdAt === 'string' ? lesson.createdAt : null,
		doc,
		packUrl: packUrl ? packUrl.href : null,
	};
}
