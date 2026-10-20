// Federation, switched on by FEDERATION_ORIGIN.
//
// Set it to the origin other servers reach this instance at
// (`https://spellingcreator.org`) and every author becomes an ActivityPub actor
// and every published lesson an Article; leave it unset and none of this runs:
// no actor documents, no WebFinger, no deliveries, nothing written to the
// federation tables. The origin is explicit rather than read off the request
// because it goes into every actor and object id, and an id built from a
// Host header a client chose is an id another server will store.
//
// The Federation is built once per `env` from the builder in builder.js, with
// the stores the platform seam provides for this host. It is reached two ways:
// as a Hono middleware (app.js), which answers the ActivityPub requests, and
// through `announceLesson` below, which the lesson routes call when a lesson
// becomes public, changes, or stops being public.
//
// Fedify itself is loaded on first use rather than imported here. This module
// is imported by the lesson routes and their helpers, and Fedify brings a
// large dependency tree with it (JSON-LD, OpenTelemetry) that an instance with
// federation off never needs, and that the test runner for the Workers
// project cannot load at all. Everything that needs it goes through `fedify()`.

import { federationKvStore, federationQueue } from '../../platform/index.js';
import { supabaseBase, supabaseConfigured } from '../supabase.js';
import { removeFollowersByInbox } from './store.js';

/**
 * Whether this instance is a test one that may talk to private addresses, and
 * so may also run on plain http (see federationOrigin). Never on the internet.
 */
export function federationTestMode(env) {
	return String(env?.FEDERATION_ALLOW_PRIVATE_ADDRESSES || '').toLowerCase() === 'true';
}

/**
 * The configured origin, normalized, or '' when federation is off.
 *
 * https only. The origin is written into every actor and object id, and other
 * servers keep those ids for good, so an instance that federated over plain
 * http would have its followers pinned to an address anyone on the path can
 * read and rewrite. The one exception is a test pair on a private network
 * (FEDERATION_ALLOW_PRIVATE_ADDRESSES), which has no certificates to use.
 */
export function federationOrigin(env) {
	const raw = (env?.FEDERATION_ORIGIN || '').toString().trim();
	if (!raw) return '';
	try {
		const url = new URL(raw);
		if (url.protocol === 'https:') return url.origin;
		return url.protocol === 'http:' && federationTestMode(env) ? url.origin : '';
	} catch {
		return '';
	}
}

/**
 * Whether this instance federates: an origin is set, there is a database to
 * keep keys and followers in, and this host has a store for Fedify's caches.
 */
export function federationEnabled(env) {
	return Boolean(federationOrigin(env)) && supabaseConfigured(env) && federationKvStore(env) !== null;
}

/** The federation modules, loaded once. */
let modules;
function fedify() {
	if (!modules) modules = Promise.all([import('./builder.js'), import('./article.js')]).then(([b, a]) => ({ ...b, ...a }));
	return modules;
}

// Memoised per `env`, like the platform services: the runtime hands the same
// `env` to every request, and building a Federation is not free.
const built = new WeakMap();

/**
 * The Federation for this environment, or null when federation is off.
 * @returns {Promise<import('@fedify/fedify').Federation<{ env: object }> | null>}
 */
export function federationFor(env) {
	if (!federationEnabled(env)) return Promise.resolve(null);
	let pending = built.get(env);
	if (!pending) {
		// A build that fails is forgotten rather than kept, so the next request
		// tries again instead of every request failing on the same rejection for
		// the life of the process.
		pending = build(env).catch((error) => {
			built.delete(env);
			throw error;
		});
		built.set(env, pending);
	}
	return pending;
}

async function build(env) {
	const { builder } = await fedify();
	const origin = federationOrigin(env);
	const queue = federationQueue(env);
	const federation = await builder.build({
		kv: federationKvStore(env),
		...(queue ? { queue } : {}),
		origin,
		userAgent: { software: 'SpellingCreator', url: origin },
		// Fedify refuses to fetch from or deliver to a private address, which is
		// what stops a remote actor document from pointing this server at its own
		// network. Two instances on one machine, in development, are exactly that
		// case, so it can be switched off there and nowhere else.
		allowPrivateAddress: federationTestMode(env),
	});
	// A remote inbox that is gone for good (its server answers 404 or 410) is
	// no longer anywhere to deliver to. Forgetting the followers behind it is
	// what stops every later lesson being retried against it.
	federation.setOutboxPermanentFailureHandler(async (ctx, { inbox }) => {
		await removeFollowersByInbox(ctx.data.env, supabaseBase(ctx.data.env), inbox.href);
	});
	return federation;
}

/**
 * A Fedify context for work that starts here rather than from a request a
 * remote server made: sending an activity. Built on the canonical origin, so
 * every id in it is the one the actor document advertises.
 */
export async function federationContext(env) {
	const federation = await federationFor(env);
	return federation ? federation.createContext(new URL(federationOrigin(env)), { env }) : null;
}

/**
 * Tell an author's followers that a lesson became public (`create`), changed
 * (`update`), or stopped being public (`delete`).
 *
 * Fire and forget, on purpose. The lesson is saved by the time this is called,
 * and a delivery that fails must not fail the save: with a queue it is retried
 * there, and without one it is tried once from this request. `executionCtx` is
 * the Worker's, whose `waitUntil` keeps the request alive for it; the Node
 * entry provides the same shape.
 *
 * @param {object} env
 * @param {{ waitUntil?: (p: Promise<unknown>) => void } | undefined} executionCtx
 * @param {object} row  The lesson's row: id and author_id at least; title,
 *   author, section_count, created_at and doc for a create or update.
 * @param {'create' | 'update' | 'delete'} kind
 */
export function announceLesson(env, executionCtx, row, kind) {
	if (!federationEnabled(env) || !row?.id || !row.author_id) return;
	const job = deliver(env, row, kind).catch((error) => {
		console.error(`federation: could not send ${kind} for lesson ${row.id}:`, error);
	});
	if (executionCtx && typeof executionCtx.waitUntil === 'function') executionCtx.waitUntil(job);
}

async function deliver(env, row, kind) {
	const ctx = await federationContext(env);
	if (!ctx) return;
	const { lessonActivity } = await fedify();
	await ctx.sendActivity({ identifier: row.author_id }, 'followers', lessonActivity(ctx, row, kind), {
		// One delivery per remote server rather than one per follower there.
		preferSharedInbox: true,
		// Followers on this very instance read the hub directly.
		excludeBaseUris: [ctx.getInboxUri()],
	});
}
