// GET /og-image?path=/hub/:id — the picture a link preview shows.
//
// The per-page <meta property="og:image"> the app writes (apps/web/src/lib/
// seo.jsx) points here, and index.html's site-wide default points at
// `path=/`. This used to be a headless-Chromium screenshot of the page, which
// only the Cloudflare host could take. It is now a designed card (src/og/),
// laid out by Satori and drawn by a rasterizer of our own, both plain
// JavaScript that runs anywhere, so both hosts serve it from the shared route
// table.
//
// The data comes through the same @spelling-creator/core fetchers the browser
// and the server render use, as one subrequest back into this same origin, so
// the card and the page cannot disagree about what a lesson is called. A
// lesson or profile that cannot be fetched (deleted, private, the API down)
// gets the site's own card rather than an error: a scraper that receives a 500
// shows no image at all, and shows it for as long as it caches the miss.
//
// Results are cached by path, like the screenshots were. Rendering is
// milliseconds rather than a browser launch, so the cache is now about not
// repeating a lesson fetch for every scraper that follows the same link.

import { configureCore } from '@spelling-creator/core/config';
import { fetchLesson } from '@spelling-creator/core/lessons';
import { fetchUserProfile } from '@spelling-creator/core/users';

import { logoPng } from '#og-runtime';

import { coreConfig } from '../lib/coreConfig.js';
import { textResponse } from '../lib/http.js';
import { richTextToPlain } from '../lib/richtext.js';
import { homeCard, hubCard, lessonCard, profileCard } from '../og/card.js';
import { firstPictureHash, loadPicture } from '../og/picture.js';
import { renderCard } from '../og/render.js';
import { responseCache } from '../platform/index.js';
import { HUB_PATH, LESSON_PATH, PROFILE_PATH } from './spa.js';

/**
 * The in-site path a preview was asked for, made safe: same-site only, and
 * without a query or hash, so the cache key (and the card) is stable per page.
 * @param {URL} url
 */
export function previewPath(url) {
	let path = url.searchParams.get('path') || '/';
	if (!path.startsWith('/') || path.startsWith('//')) path = '/';
	return path.split(/[?#]/)[0];
}

/**
 * The card for a path. Never throws: a page whose data cannot be read gets the
 * site card.
 * @param {string} path
 * @param {object} env
 * @param {URL} url
 */
export async function cardForPath(path, env, url) {
	const host = url.host;
	const logo = await logoPng();
	const lesson = path.match(LESSON_PATH);
	const profile = path.match(PROFILE_PATH);
	if (!lesson && !profile) return HUB_PATH.test(path) ? hubCard({ host, logo }) : homeCard({ host, logo });

	configureCore(coreConfig(env, url));
	try {
		if (lesson) {
			const data = await fetchLesson(decodeURIComponent(lesson[1]));
			const hash = firstPictureHash(data.doc);
			const picture = hash ? await loadPicture(url.origin, hash) : null;
			return lessonCard({
				title: data.title,
				author: data.author,
				sectionCount: typeof data.sectionCount === 'number' ? data.sectionCount : data.doc?.sections?.length,
				createdAt: data.createdAt,
				picture,
				host,
				logo,
			});
		}
		const { user, lessons } = await fetchUserProfile(decodeURIComponent(profile[1]));
		return profileCard({
			displayName: user.displayName,
			bio: richTextToPlain(user.bio || ''),
			lessonCount: Array.isArray(lessons) ? lessons.length : undefined,
			followerCount: user.followerCount,
			host,
			logo,
		});
	} catch (err) {
		console.warn('No data for a preview card; using the site card instead:', path, err?.message || err);
		return homeCard({ host, logo });
	}
}

/**
 * GET /og-image?path=... — a 1200x630 PNG for the given in-site path.
 */
export async function handleOgImage(request, env, ctx, url) {
	const path = previewPath(url);

	const cache = responseCache(env);
	const cacheKey = `${url.origin}/og-image?path=${encodeURIComponent(path)}`;
	const hit = await cache.match(cacheKey);
	if (hit) return hit;

	const card = await cardForPath(path, env, url);
	let png;
	try {
		png = await renderCard(card);
	} catch (err) {
		console.error('Preview card render failed', path, err);
		return textResponse('Failed to render preview image.', 500);
	}

	const response = new Response(png, {
		status: 200,
		headers: {
			'Content-Type': 'image/png',
			// Let the edge serve repeat scraper hits without re-rendering.
			'Cache-Control': 'public, max-age=3600',
			'X-Og-Image': '1',
		},
	});
	ctx.waitUntil(cache.put(cacheKey, response.clone()));
	return response;
}
