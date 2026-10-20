// The federation, driven as another server would drive it: ActivityPub
// requests against a Federation built from the real builder, over an
// in-memory key-value store and a fake of the slice of PostgREST and GoTrue
// the dispatchers read. What the tests pin down is the contract a remote
// server sees: which addresses resolve, what an actor and an Article carry,
// what a draft looks like from outside (nothing), and that a delivery to a
// follower is a signed request to the inbox the follower advertised.

import { MemoryKvStore } from '@fedify/fedify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp, registerFrontend, wantsActivityPub } from '../../app.js';
import { lessonContentHtml, lessonExcerpt } from './article.js';
import { builder } from './builder.js';
import { announceLesson, federationEnabled, federationFor, federationOrigin } from './index.js';

const ORIGIN = 'https://hub.test';
const API_KEY = 'service-role-key';
const ALICE = '11111111-1111-4111-8111-111111111111';
const LESSON = '22222222-2222-4222-8222-222222222222';
const DRAFT = '33333333-3333-4333-8333-333333333333';
const HIDDEN = '44444444-4444-4444-8444-444444444444';

const AP = 'application/activity+json';

const doc = {
	title: 'Domestic Cats',
	sections: [
		{
			id: 's1',
			name: 'Section 1',
			blocks: [
				{
					id: 'b1',
					type: 'text',
					text: 'Cats were first kept by farmers in the Near East, who valued them for keeping mice out of the grain.',
				},
			],
		},
	],
};

/** The rows the fake database starts with. */
function seed() {
	return {
		users: new Map([[ALICE, { id: ALICE, user_metadata: { display_name: 'Alice', bio: '<p>Teaches spelling.</p>' } }]]),
		lessons: [
			{
				id: LESSON,
				author_id: ALICE,
				author: 'Alice',
				title: 'Domestic Cats',
				section_count: 1,
				published: true,
				shadowbanned: false,
				created_at: '2026-08-01T10:00:00.000Z',
				doc,
			},
			{
				id: DRAFT,
				author_id: ALICE,
				author: 'Alice',
				title: 'Unfinished',
				section_count: 1,
				published: false,
				shadowbanned: false,
				created_at: '2026-08-02T10:00:00.000Z',
				doc,
			},
			{
				id: HIDDEN,
				author_id: ALICE,
				author: 'Alice',
				title: 'Hidden',
				section_count: 1,
				published: true,
				shadowbanned: true,
				created_at: '2026-08-03T10:00:00.000Z',
				doc,
			},
		],
		keys: new Map(),
		followers: [],
	};
}

/** `column=eq.value` filters of a PostgREST query, decoded. */
function filtersOf(url) {
	const out = {};
	for (const [k, v] of url.searchParams) if (v.startsWith('eq.')) out[k] = v.slice(3);
	return out;
}

/**
 * The slice of Supabase the federation reads: GoTrue's admin user lookup, and
 * PostgREST over the lessons, keys and followers tables. Anything else is a
 * remote server, recorded in `remote` and answered 202 so a delivery succeeds.
 */
function fakeSupabase(db) {
	const remote = [];
	async function handle(input, init = {}) {
		const request = input instanceof Request ? input : new Request(input, init);
		const url = new URL(request.url);
		if (url.origin !== 'https://db.test') {
			remote.push(request);
			return new Response(null, { status: 202 });
		}
		if (request.headers.get('apikey') !== API_KEY) return new Response('{}', { status: 401 });

		const m = url.pathname.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/);
		if (m) {
			const user = db.users.get(m[1]);
			return user ? Response.json(user) : new Response('{}', { status: 404 });
		}

		const table = url.pathname.replace('/rest/v1/', '');
		const f = filtersOf(url);
		const json = (rows) => {
			const headers = { 'content-type': 'application/json', 'content-range': `0-${rows.length}/${rows.length}` };
			return request.method === 'HEAD' ? new Response(null, { status: 200, headers }) : Response.json(rows, { headers });
		};

		if (table === 'lessons') {
			let rows = db.lessons.filter((row) => Object.entries(f).every(([k, v]) => String(row[k]) === v));
			const offset = Number(url.searchParams.get('offset') || 0);
			const limit = Number(url.searchParams.get('limit') || rows.length);
			rows = rows.slice(offset, offset + limit);
			return json(rows);
		}
		if (table === 'federation_keys') {
			if (request.method === 'POST') {
				const body = await request.json();
				if (db.keys.has(body.user_id)) return Response.json([], { status: 201 });
				db.keys.set(body.user_id, body);
				return Response.json([body], { status: 201 });
			}
			const row = db.keys.get(f.user_id);
			return json(row ? [row] : []);
		}
		if (table === 'comments') return json([{ id: 'c1' }, { id: 'c2' }]);
		if (table === 'federation_followers') {
			if (request.method === 'POST') {
				const body = await request.json();
				db.followers = db.followers.filter((r) => !(r.user_id === body.user_id && r.actor_id === body.actor_id));
				db.followers.push(body);
				return new Response(null, { status: 201 });
			}
			if (request.method === 'DELETE') {
				db.followers = db.followers.filter((r) => !Object.entries(f).every(([k, v]) => String(r[k]) === v));
				return new Response(null, { status: 204 });
			}
			return json(db.followers.filter((r) => Object.entries(f).every(([k, v]) => String(r[k]) === v)));
		}
		return new Response('{}', { status: 404 });
	}
	return { fetch: handle, remote };
}

function env(platform) {
	return {
		SUPABASE_URL: 'https://db.test',
		SUPABASE_SERVICE_ROLE_KEY: API_KEY,
		FEDERATION_ORIGIN: ORIGIN,
		// The fake servers here have no DNS entries.
		FEDERATION_ALLOW_PRIVATE_ADDRESSES: 'true',
		PLATFORM: { federationKv: new MemoryKvStore(), federationQueue: null, ...platform },
	};
}

let db;
let server;
let federation;
let notFound;

const get = (path, accept = AP) =>
	federation.fetch(new Request(`${ORIGIN}${path}`, { headers: { Accept: accept } }), {
		contextData: { env: env() },
		onNotFound: () => {
			notFound += 1;
			return new Response('next', { status: 404 });
		},
		onNotAcceptable: () => new Response('next', { status: 406 }),
	});

beforeEach(async () => {
	db = seed();
	server = fakeSupabase(db);
	vi.stubGlobal('fetch', server.fetch);
	notFound = 0;
	federation = await builder.build({ kv: new MemoryKvStore(), origin: ORIGIN });
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('inside the app', () => {
	// The whole route table, with a frontend that answers every page path the way
	// the real one does: its shell, and a 200.
	const appFetch = (path, accept) => {
		const app = createApp();
		registerFrontend(app, () => new Response('<html>shell</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
		const executionCtx = { waitUntil() {}, passThroughOnException() {} };
		return app.fetch(new Request(`${ORIGIN}${path}`, { headers: { Accept: accept } }), env(), executionCtx);
	};

	it('serves the Article to ActivityPub and the page to a browser at one address', async () => {
		const article = await appFetch(`/hub/${LESSON}`, AP);
		expect(article.status).toBe(200);
		expect((await article.json()).type).toBe('Article');
		const page = await appFetch(`/hub/${LESSON}`, 'text/html');
		expect(await page.text()).toBe('<html>shell</html>');
	});

	it('answers 404, not the page shell, when ActivityPub asks for something that is not there', async () => {
		for (const path of [
			`/hub/${DRAFT}`,
			`/hub/${HIDDEN}`,
			'/hub/99999999-9999-4999-8999-999999999999',
			'/users/99999999-9999-4999-8999-999999999999',
		]) {
			const res = await appFetch(path, AP);
			expect(res.status, path).toBe(404);
			expect(res.headers.get('content-type'), path).not.toContain('text/html');
		}
		// A browser asking for the same draft still gets the app, which decides.
		expect((await appFetch(`/hub/${DRAFT}`, 'text/html')).status).toBe(200);
	});

	it('tells an ActivityPub request from a page or an API call', () => {
		const ask = (accept) => wantsActivityPub(new Request(ORIGIN, { headers: accept ? { Accept: accept } : {} }));
		expect(ask(AP)).toBe(true);
		expect(ask('application/ld+json; profile="https://www.w3.org/ns/activitystreams"')).toBe(true);
		expect(ask('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')).toBe(false);
		expect(ask('application/json')).toBe(false);
		expect(ask('*/*')).toBe(false);
		expect(ask('')).toBe(false);
	});
});

describe('nodeinfo', () => {
	it('says what software this is and how many lessons it holds', async () => {
		const res = await get('/nodeinfo/2.1', 'application/json');
		expect(res.status).toBe(200);
		const info = await res.json();
		expect(info.software.name).toBe('spelling-creator');
		expect(info.protocols).toEqual(['activitypub']);
		expect(info.usage.localPosts).toBe(1);
		expect(info.usage.localComments).toBe(2);
	});
});

describe('configuration', () => {
	it('is off without an origin, and off for an origin that is not one', () => {
		expect(federationOrigin({})).toBe('');
		expect(federationOrigin({ FEDERATION_ORIGIN: 'spellingcreator.org' })).toBe('');
		expect(federationOrigin({ FEDERATION_ORIGIN: ' https://spellingcreator.org/ ' })).toBe('https://spellingcreator.org');
		expect(federationEnabled(env())).toBe(true);
		expect(federationEnabled({ ...env(), FEDERATION_ORIGIN: '' })).toBe(false);
		expect(federationEnabled(env({ federationKv: null }))).toBe(false);
	});

	it('federates over https only, except as a test pair on a private network', () => {
		// The ids carry the origin and other servers keep them for good.
		expect(federationOrigin({ FEDERATION_ORIGIN: 'http://spellingcreator.org' })).toBe('');
		expect(federationOrigin({ FEDERATION_ORIGIN: 'http://192.168.5.129:8080', FEDERATION_ALLOW_PRIVATE_ADDRESSES: 'true' })).toBe(
			'http://192.168.5.129:8080',
		);
		expect(federationOrigin({ FEDERATION_ORIGIN: 'ftp://spellingcreator.org', FEDERATION_ALLOW_PRIVATE_ADDRESSES: 'true' })).toBe('');
	});

	it('tries again after a failed start rather than failing every later request', async () => {
		const spy = vi.spyOn(builder, 'build').mockRejectedValueOnce(new Error('kv down'));
		try {
			const shared = env();
			await expect(federationFor(shared)).rejects.toThrow('kv down');
			await expect(federationFor(shared)).resolves.toBeTruthy();
			expect(spy).toHaveBeenCalledTimes(2);
		} finally {
			spy.mockRestore();
		}
	});
});

describe('actors', () => {
	it('answers WebFinger for an account id and points at the actor', async () => {
		const res = await get(`/.well-known/webfinger?resource=acct:${ALICE}@hub.test`, 'application/jrd+json');
		expect(res.status).toBe(200);
		const jrd = await res.json();
		expect(jrd.links.find((l) => l.rel === 'self').href).toBe(`${ORIGIN}/users/${ALICE}`);
	});

	it('serves an actor document with the display name, bio, inboxes and a key', async () => {
		const res = await get(`/users/${ALICE}`);
		expect(res.status).toBe(200);
		const actor = await res.json();
		expect(actor.type).toBe('Person');
		expect(actor.preferredUsername).toBe(ALICE);
		expect(actor.name).toBe('Alice');
		expect(actor.summary).toBe('<p>Teaches spelling.</p>');
		expect(actor.inbox).toBe(`${ORIGIN}/users/${ALICE}/inbox`);
		expect(actor.endpoints.sharedInbox).toBe(`${ORIGIN}/inbox`);
		expect(actor.url).toBe(`${ORIGIN}/users/${ALICE}`);
		expect(actor.publicKey.publicKeyPem).toContain('BEGIN PUBLIC KEY');
		// The keys were made on first sight and kept.
		expect(db.keys.has(ALICE)).toBe(true);
	});

	it('keeps the same key once it has been given out', async () => {
		const first = (await (await get(`/users/${ALICE}`)).json()).publicKey.publicKeyPem;
		const second = (await (await get(`/users/${ALICE}`)).json()).publicKey.publicKeyPem;
		expect(second).toBe(first);
	});

	it('hands anyone who is not an account on to the next handler, and never makes keys for them', async () => {
		const ghost = '99999999-9999-4999-8999-999999999999';
		expect((await get(`/users/${ghost}`)).status).toBe(404);
		expect((await get('/users/not-even-an-id')).status).toBe(404);
		expect(notFound).toBe(2);
		expect(db.keys.size).toBe(0);
	});

	it('leaves a browser request for the same address to the web app', async () => {
		const res = await get(`/users/${ALICE}`, 'text/html');
		expect(res.status).toBe(406);
	});
});

describe('lessons', () => {
	it('serves a published lesson as an Article with the links a fork needs', async () => {
		const res = await get(`/hub/${LESSON}`);
		expect(res.status).toBe(200);
		const article = await res.json();
		expect(article.type).toBe('Article');
		expect(article.name).toBe('Domestic Cats');
		expect(article.attributedTo).toBe(`${ORIGIN}/users/${ALICE}`);
		expect(article.url).toBe(`${ORIGIN}/hub/${LESSON}`);
		expect(article.content).toContain('Cats were first kept by farmers');
		// The public collection, in whichever spelling the JSON-LD context gives it.
		expect(['as:Public', 'https://www.w3.org/ns/activitystreams#Public']).toContain(article.to);
		const hrefs = article.attachment.map((a) => a.href);
		expect(hrefs).toEqual([`${ORIGIN}/lessons/${LESSON}`, `${ORIGIN}/git/${LESSON}/pack`]);
	});

	it('does not exist to another server while it is a draft or hidden', async () => {
		expect((await get(`/hub/${DRAFT}`)).status).toBe(404);
		expect((await get(`/hub/${HIDDEN}`)).status).toBe(404);
		expect(notFound).toBe(2);
	});

	it('lists only the public lessons in the outbox', async () => {
		const collection = await (await get(`/users/${ALICE}/outbox`)).json();
		expect(collection.totalItems).toBe(1);
		const page = await (await get(`/users/${ALICE}/outbox?cursor=0`)).json();
		expect(page.orderedItems).toHaveLength(1);
		expect(page.orderedItems[0].type).toBe('Create');
		expect(page.orderedItems[0].object.id).toBe(`${ORIGIN}/hub/${LESSON}`);
	});
});

describe('followers', () => {
	it('lists the remote accounts following an author', async () => {
		db.followers.push({
			user_id: ALICE,
			actor_id: 'https://remote.test/users/bob',
			inbox: 'https://remote.test/users/bob/inbox',
			shared_inbox: 'https://remote.test/inbox',
		});
		const collection = await (await get(`/users/${ALICE}/followers`)).json();
		expect(collection.totalItems).toBe(1);
		const page = await (await get(`/users/${ALICE}/followers?cursor=0`)).json();
		expect(page.orderedItems).toEqual(['https://remote.test/users/bob']);
	});

	it("delivers a signed Create to the follower's shared inbox when a lesson is published", async () => {
		db.followers.push({
			user_id: ALICE,
			actor_id: 'https://remote.test/users/bob',
			inbox: 'https://remote.test/users/bob/inbox',
			shared_inbox: 'https://remote.test/inbox',
		});
		const waited = [];
		const ctx = { waitUntil: (p) => waited.push(p) };
		announceLesson(env(), ctx, db.lessons[0], 'create');
		expect(waited).toHaveLength(1);
		await waited[0];

		const delivery = server.remote.find((r) => r.method === 'POST');
		expect(delivery).toBeDefined();
		expect(delivery.url).toBe('https://remote.test/inbox');
		expect(delivery.headers.get('signature') || delivery.headers.get('signature-input')).toBeTruthy();
		const body = await delivery.json();
		expect(body.type).toBe('Create');
		expect(body.actor).toBe(`${ORIGIN}/users/${ALICE}`);
		expect(body.object.type).toBe('Article');
		expect(body.object.id).toBe(`${ORIGIN}/hub/${LESSON}`);
	});

	it('sends nothing when federation is off, and nothing for a lesson with no author', async () => {
		const waited = [];
		announceLesson({ ...env(), FEDERATION_ORIGIN: '' }, { waitUntil: (p) => waited.push(p) }, db.lessons[0], 'create');
		announceLesson(env(), { waitUntil: (p) => waited.push(p) }, { id: LESSON }, 'create');
		expect(waited).toHaveLength(0);
	});
});

describe('the post body', () => {
	it('excerpts the first text block and cuts at a word', () => {
		expect(lessonExcerpt(doc)).toBe('Cats were first kept by farmers in the Near East, who valued them for keeping mice out of the grain.');
		const long = { sections: [{ blocks: [{ type: 'text', text: `${'word '.repeat(100)}end` }] }] };
		const excerpt = lessonExcerpt(long);
		expect(excerpt.length).toBeLessThanOrEqual(284);
		expect(excerpt.endsWith('...')).toBe(true);
		expect(lessonExcerpt(null)).toBe('');
		expect(lessonExcerpt({ sections: [{ blocks: [{ type: 'image' }] }] })).toBe('');
	});

	it('escapes what it quotes', () => {
		const html = lessonContentHtml({
			title: 'A <b>bold</b> title',
			author: 'Tom & Jerry',
			sectionCount: 1,
			url: 'https://hub.test/hub/x?a=1&b=2',
			excerpt: '"Quoted"',
		});
		expect(html).toContain('A &lt;b&gt;bold&lt;/b&gt; title');
		expect(html).toContain('Tom &amp; Jerry');
		expect(html).toContain('href="https://hub.test/hub/x?a=1&amp;b=2"');
		expect(html).toContain('(1 section)');
	});
});
