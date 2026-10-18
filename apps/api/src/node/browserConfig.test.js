// The runtime browser configuration: what goes into the shell, what stays out
// of it, and that the service worker's copy of the shell follows it.

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { assetServer } from './assets.js';
import { browserConfig, configScript, reviseShell, withBrowserConfig } from './browserConfig.js';
import { createHandler } from './server.js';

const SHELL = '<!doctype html><html><head><title>shell</title></head><body><div id="root"></div></body></html>';
// The shape Workbox's generateSW writes, minified as the build leaves it.
const SW = 'e.precacheAndRoute([{url:"index.html",revision:"d138ab65"},{url:"icons/icon.svg",revision:"aa11"}],{})';

async function buildFixture() {
	const root = await mkdtemp(join(tmpdir(), 'spelling-config-'));
	await writeFile(join(root, 'index.html'), SHELL);
	await writeFile(join(root, 'sw.js'), SW);
	await writeFile(join(root, 'about.html'), '<html><head></head><body>about</body></html>');
	return root;
}

/** The object a served shell assigns to window.__CONFIG__. */
function configIn(html) {
	const match = html.match(/<script>window\.__CONFIG__=(.*?)<\/script>/);
	return match ? JSON.parse(match[1]) : null;
}

describe('browserConfig', () => {
	it('maps the environment onto the names main.jsx passes to core', () => {
		expect(
			browserConfig({
				PUBLIC_SUPABASE_URL: 'https://auth.example.org',
				SUPABASE_ANON_KEY: 'anon',
				GOOGLE_CLIENT_ID: 'google',
				TURNSTILE_SITE_KEY: 'turnstile',
				AI_CHALLENGE: 'altcha',
				AUTH_MODE: 'password',
				USERNAME_DOMAIN: 'users.example.org',
			}),
		).toEqual({
			supabaseUrl: 'https://auth.example.org',
			supabaseAnonKey: 'anon',
			googleClientId: 'google',
			turnstileSiteKey: 'turnstile',
			aiChallenge: 'altcha',
			authMode: 'password',
			usernameDomain: 'users.example.org',
		});
	});

	it('never includes anything outside the allowlist', () => {
		// The same environment holds the key that bypasses row-level security.
		const config = browserConfig({
			SUPABASE_SERVICE_ROLE_KEY: 'secret',
			SUPABASE_URL: 'http://gateway',
			TURNSTILE_SECRET_KEY: 'secret',
			ALTCHA_HMAC_KEY: 'secret',
			S3_SECRET_ACCESS_KEY: 'secret',
		});
		expect(config).toEqual({});
	});

	it('leaves out empty values so a baked-in one survives', () => {
		// Compose passes `${USERNAME_DOMAIN:-}` through as an empty string.
		expect(browserConfig({ USERNAME_DOMAIN: '', AUTH_MODE: '  ' })).toEqual({});
	});
});

describe('configScript', () => {
	it('cannot be closed early by a value', () => {
		const script = configScript({ authMode: '</script><script>alert(1)</script>' });
		expect(script.match(/<\/script>/g)).toHaveLength(1);
	});
});

describe('reviseShell', () => {
	it('suffixes the shell revision and nothing else', () => {
		expect(reviseShell(SW, 'abc')).toBe(
			'e.precacheAndRoute([{url:"index.html",revision:"d138ab65-abc"},{url:"icons/icon.svg",revision:"aa11"}],{})',
		);
	});

	it('finds the entry with its keys the other way round, or quoted', () => {
		expect(reviseShell('[{"revision":"r1","url":"index.html"}]', 'x')).toBe('[{"revision":"r1-x","url":"index.html"}]');
	});

	it('returns null when there is no shell entry', () => {
		expect(reviseShell('precacheAndRoute([])', 'x')).toBeNull();
	});
});

describe('withBrowserConfig', () => {
	let root;
	beforeAll(async () => {
		root = await buildFixture();
	});

	const serve = (env) => withBrowserConfig(assetServer(root), env);
	const get = (assets, path, init) => assets.fetch(new Request(`https://host.test${path}`, init));

	it('writes the configuration into the shell, at / and at /index.html', async () => {
		const assets = serve({ AUTH_MODE: 'password' });
		for (const path of ['/', '/index.html']) {
			const res = await get(assets, path);
			const html = await res.text();
			expect(configIn(html)).toEqual({ authMode: 'password' });
			expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength(html)));
			expect(res.headers.get('content-type')).toContain('text/html');
		}
	});

	it('still writes an empty configuration, which tells the page it came from the API', async () => {
		expect(configIn(await (await get(serve({}), '/')).text())).toEqual({});
	});

	it('leaves every other page alone', async () => {
		// The docs site is HTML too, and is not the app.
		expect(await (await get(serve({ AUTH_MODE: 'password' }), '/about.html')).text()).not.toContain('__CONFIG__');
	});

	it('answers HEAD with the rewritten length and no body', async () => {
		const assets = serve({ AUTH_MODE: 'password' });
		const full = await (await get(assets, '/')).text();
		const head = await get(assets, '/', { method: 'HEAD' });
		expect(head.status).toBe(200);
		expect(head.headers.get('content-length')).toBe(String(Buffer.byteLength(full)));
		expect(await head.text()).toBe('');
	});

	it('changes the shell revision when, and only when, the configuration does', async () => {
		const revision = async (env) => (await (await get(serve(env), '/sw.js')).text()).match(/url:"index\.html",revision:"([^"]*)"/)[1];

		const a = await revision({ AUTH_MODE: 'password' });
		expect(a).toMatch(/^d138ab65-[0-9a-f]{12}$/);
		expect(await revision({ AUTH_MODE: 'password' })).toBe(a);
		expect(await revision({ AUTH_MODE: 'both' })).not.toBe(a);
	});

	it('passes a missing shell through as the 404 it is', async () => {
		const empty = await mkdtemp(join(tmpdir(), 'spelling-config-empty-'));
		const res = await get(withBrowserConfig(assetServer(empty), {}), '/index.html');
		expect(res.status).toBe(404);
	});

	it('never answers with headers that describe the file rather than the page', async () => {
		// An asset server that validates and compresses, as a future one might:
		// it answers a conditional request with an empty 304, and labels its bytes.
		const seen = [];
		const assets = {
			async fetch(request) {
				seen.push(request);
				if (request.headers.get('if-none-match') === '"disk"') return new Response(null, { status: 304 });
				return new Response(SHELL, {
					headers: {
						'Content-Type': 'text/html',
						'Cache-Control': 'no-cache',
						ETag: '"disk"',
						'Last-Modified': 'Sat, 17 Oct 2026 00:00:00 GMT',
						'Content-Encoding': 'identity',
					},
				});
			},
		};
		const res = await get(withBrowserConfig(assets, { AUTH_MODE: 'password' }), '/', {
			headers: { 'If-None-Match': '"disk"', 'Accept-Encoding': 'br' },
		});

		// The page, not a 304: the rewrite is the response.
		expect(res.status).toBe(200);
		expect(configIn(await res.text())).toEqual({ authMode: 'password' });
		expect(seen[0].headers.get('if-none-match')).toBeNull();
		expect(seen[0].headers.get('accept-encoding')).toBe('identity');

		for (const name of ['etag', 'last-modified', 'content-encoding']) expect(res.headers.get(name)).toBeNull();
		expect(res.headers.get('cache-control')).toBe('no-cache');
	});
});

describe('createHandler', () => {
	it('serves the shell for an app route with the configuration in it', async () => {
		// Through routes/spa.js's fall-through, which fetches /index.html from
		// env.ASSETS: the path every client-side route takes.
		const handler = createHandler({
			WEB_DIST: await buildFixture(),
			AUTH_MODE: 'password',
			SUPABASE_ANON_KEY: 'anon',
		});
		const res = await handler(new Request('https://host.test/editor', { headers: { accept: 'text/html' } }));
		expect(res.status).toBe(200);
		expect(configIn(await res.text())).toEqual({ authMode: 'password', supabaseAnonKey: 'anon' });
	});
});
