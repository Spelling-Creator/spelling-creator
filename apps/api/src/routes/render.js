// Crawler prerendering + the frontend fall-through.
//
// The Worker serves the React SPA (env.ASSETS). Search engines and social
// scrapers that don't run JavaScript would otherwise only see the empty
// index.html shell, so we detect them by User-Agent and instead return a fully
// rendered HTML snapshot produced by headless Chromium (@cloudflare/puppeteer).
//
// Most of that job now belongs to routes/ssr.js, which renders /hub, /hub/:id
// and /users/:id with React for every visitor. What's left here is the tail:
// "/" (whose content is auth-gated, so an anonymous render is only ever the
// marketing splash) and any future route SSR doesn't reach. The link-preview
// image used to be here too, as a screenshot; it is a drawn card now
// (routes/og.js), which needs no browser and so lives in the shared route table.

import puppeteer from '@cloudflare/puppeteer';
import { responseCache } from '../platform/index.js';
import { serverRender, shouldServerRender } from './ssr.js';
import { serveApp } from './spa.js';

// User-Agents of crawlers/scrapers worth prerendering for: search engines and
// the link-preview bots used by social/chat platforms.
const CRAWLER_UA =
	/googlebot|bingbot|slurp|duckduckbot|baiduspider|yandex|sogou|exabot|facebookexternalhit|facebot|twitterbot|linkedinbot|embedly|quora link preview|pinterest|slackbot|slack-imgproxy|vkshare|w3c_validator|whatsapp|telegrambot|discordbot|redditbot|applebot|petalbot|bytespider|ia_archiver|skypeuripreview|google-inspectiontool/i;

// Query flag the prerender browser appends when it loads the page, so the
// Worker serves the real SPA shell instead of recursively prerendering itself.
const PRERENDER_BYPASS = '__prerender';

function isCrawler(request) {
	const ua = request.headers.get('user-agent') || '';
	return CRAWLER_UA.test(ua);
}

// True for requests we should consider prerendering: a crawler GET for an HTML
// document (not a hashed asset like /assets/app.js or an image).
export function shouldPrerender(request, url) {
	if (request.method !== 'GET') return false;
	if (url.searchParams.has(PRERENDER_BYPASS)) return false;
	if (!isCrawler(request)) return false;
	// The /docs VitePress site is statically pre-rendered at build time, so its
	// HTML is already crawler-ready — no need to spin up a browser for it.
	if (url.pathname === '/docs' || url.pathname.startsWith('/docs/')) return false;
	const accept = request.headers.get('accept') || '';
	const isDoc = accept.includes('text/html') || !/\.[a-z0-9]+$/i.test(url.pathname);
	return isDoc;
}

// Render the page with headless Chromium and return its serialized HTML. Results
// are cached (keyed by path) so repeat crawler hits don't each spin up a browser.
async function prerender(request, env, ctx, url) {
	const cache = responseCache(env);
	// Cache under a synthetic key so a prerendered snapshot is never accidentally
	// served to a real user requesting the same path.
	const cacheKey = `${url.origin}${url.pathname}?${PRERENDER_BYPASS}=cache`;
	const hit = await cache.match(cacheKey);
	if (hit) return hit;

	// The browser loads this same Worker; the bypass flag stops it prerendering
	// itself, so it gets the static SPA shell + assets and renders the page.
	const target = new URL(url);
	target.searchParams.set(PRERENDER_BYPASS, '1');

	let browser;
	try {
		browser = await puppeteer.launch(env.BROWSER);
		const page = await browser.newPage();

		// Skip resources that don't affect the rendered markup we capture: images,
		// fonts, media, and the third-party widgets (Turnstile, Google Identity)
		// that only matter for live interaction. This keeps the render fast and
		// lets the page reach network-idle promptly.
		await page.setRequestInterception(true);
		page.on('request', (req) => {
			const type = req.resourceType();
			if (type === 'image' || type === 'media' || type === 'font') return req.abort();
			if (/challenges\.cloudflare\.com|accounts\.google\.com|fonts\.g(oogleapis|static)\.com/.test(req.url())) {
				return req.abort();
			}
			req.continue();
		});

		await page.goto(target.toString(), { waitUntil: 'networkidle0', timeout: 20000 });
		const html = await page.content();

		const response = new Response(html, {
			status: 200,
			headers: {
				'Content-Type': 'text/html; charset=utf-8',
				// Let the edge serve repeat crawler hits without re-rendering.
				'Cache-Control': 'public, max-age=3600',
				'X-Prerendered': '1',
			},
		});
		ctx.waitUntil(cache.put(cacheKey, response.clone()));
		return response;
	} catch (err) {
		// If rendering fails (timeout, quota, etc.) fall back to the SPA shell so
		// the crawler still receives valid HTML rather than an error.
		return env.ASSETS.fetch(request);
	} finally {
		if (browser) await browser.close();
	}
}

// Serve the frontend, in preference order:
//
//   1. Server-render it, for everyone, if it's one of the public read routes
//      (routes/ssr.js). Returns null if it isn't, or if anything went wrong.
//   2. Prerender it with headless Chromium, for crawlers only, on the routes
//      SSR doesn't cover — today that's "/" and nothing else, since the rest
//      are auth-gated pages no crawler has any business indexing.
//   3. Hand back the static asset, the SPA shell for a client-side route, or a
//      real 404 for a path that is neither (routes/spa.js).
export async function handleFrontend(request, env, ctx, url) {
	if (shouldServerRender(request, url)) {
		const rendered = await serverRender(request, env, ctx, url);
		if (rendered) return rendered;
	}
	if (env.BROWSER && shouldPrerender(request, url)) {
		return prerender(request, env, ctx, url);
	}
	return serveApp(request, env, url);
}
