// ALTCHA: a proof-of-work check for the AI and image flow that needs no third
// party (https://altcha.org).
//
// This is the self-hostable alternative to Turnstile. The browser asks for a
// signed challenge (GET /altcha/challenge), spends a fraction of a second
// solving it, and sends the result with the AI request as its `token`; the
// server checks the signature and the solution here. There is no account to
// create and nothing leaves the instance. It is a speed bump rather than proof
// of a human: every request costs the sender some work, which is what makes
// scripting the AI endpoints expensive.
//
// The challenge is PBKDF2/SHA-256 through WebCrypto, so the same code runs on
// the Worker and on Node. Each solved challenge is accepted once: its nonce is
// recorded in the rate-limit store until the challenge would have expired.

import { createChallenge, randomInt, verifySolution } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/web/pbkdf2';

import { rateLimitStore } from '../platform/index.js';

// How long a challenge may wait between being fetched and being used. Long
// enough to cover someone who opens a dialog and reads it before clicking;
// short enough that a stockpile of solved challenges goes stale.
const CHALLENGE_LIFETIME_SECONDS = 10 * 60;

// The work each challenge asks for: PBKDF2 at this cost, repeated until the
// counter the server picked is found. These are the library's documented
// defaults. The widget splits the search across several workers, which brings
// it to about a second on a typical computer; on one thread it is a few.
const COST = 5_000;
const COUNTER_MIN = 5_000;
const COUNTER_MAX = 10_000;

const ALGORITHM = 'PBKDF2/SHA-256';

// Matches the wording Turnstile's expired-token case uses, so the dialogs read
// the same whichever check an instance runs.
const EXPIRED = 'Verification expired. Please re-verify and try again';

const encoder = new TextEncoder();

/** HMAC-SHA-256 of `message` under `key`, as lowercase hex. */
async function hmacHex(key, message) {
	const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
	return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The two secrets challenges are signed with, or null if there is nothing to
 * sign with.
 *
 * `ALTCHA_HMAC_KEY` when it is set. Otherwise both are derived from the
 * service-role key, which every instance with a hub already has and which never
 * leaves the server, so ALTCHA works with no extra setting. An HMAC of it
 * reveals nothing about it. The second secret signs the derived key, which lets
 * verification check a signature instead of repeating the work.
 */
async function secrets(env) {
	const master = env.ALTCHA_HMAC_KEY
		? env.ALTCHA_HMAC_KEY
		: env.SUPABASE_SERVICE_ROLE_KEY
			? await hmacHex(env.SUPABASE_SERVICE_ROLE_KEY, 'altcha-challenge-signing')
			: '';
	if (!master) return null;
	return {
		hmacSignatureSecret: master,
		hmacKeySignatureSecret: await hmacHex(master, 'altcha-derived-key-signing'),
	};
}

/** Whether this environment has something to sign challenges with. */
export function altchaConfigured(env) {
	return Boolean(env.ALTCHA_HMAC_KEY || env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * A new signed challenge, for the widget to solve.
 *
 * @param {object} env
 * @param {{ expiresAt?: Date, cost?: number, counter?: number }} [options]
 *   For tests: a time in the past, or a challenge cheap enough to solve
 *   instantly. The route always uses the defaults.
 * @returns {Promise<object | null>} Null when there is no key to sign with.
 */
export async function createAltchaChallenge(env, { expiresAt, cost = COST, counter } = {}) {
	const keys = await secrets(env);
	if (!keys) return null;
	return createChallenge({
		algorithm: ALGORITHM,
		cost,
		counter: counter ?? randomInt(COUNTER_MAX, COUNTER_MIN),
		deriveKey,
		expiresAt: expiresAt || new Date(Date.now() + CHALLENGE_LIFETIME_SECONDS * 1000),
		...keys,
	});
}

/** The `{ challenge, solution }` the widget sends, base64-encoded JSON. */
function decodePayload(token) {
	try {
		const payload = JSON.parse(atob(token));
		if (payload && typeof payload === 'object' && payload.challenge?.parameters && payload.solution) return payload;
	} catch {
		// Not base64, or not JSON: answered below as an invalid token.
	}
	return null;
}

/**
 * Verify a solved ALTCHA challenge. The same `{ ok, status, reason }` shape as
 * the Turnstile check, so the AI route can use either.
 *
 * @param {string} token The widget's payload.
 * @param {object} env
 */
export async function verifyAltcha(token, env) {
	const keys = await secrets(env);
	if (!keys) {
		return {
			ok: false,
			status: 500,
			reason: 'Server misconfiguration: set ALTCHA_HMAC_KEY or SUPABASE_SERVICE_ROLE_KEY',
		};
	}
	if (!token) return { ok: false, status: 403, reason: 'Missing verification' };

	const payload = decodePayload(token);
	if (!payload) return { ok: false, status: 403, reason: 'Verification failed' };

	let result;
	try {
		result = await verifySolution({ challenge: payload.challenge, solution: payload.solution, deriveKey, ...keys });
	} catch {
		// Thrown for parameters the library refuses, such as an unknown algorithm:
		// nothing a challenge from this server would contain.
		return { ok: false, status: 403, reason: 'Verification failed' };
	}
	if (result.expired) return { ok: false, status: 403, reason: EXPIRED };
	if (!result.verified) return { ok: false, status: 403, reason: 'Verification failed' };

	// Once only. Without a store there is no way to tell a replay from a first
	// use, so refuse rather than accept every replay; the AI route needs the
	// same store for its rate limiter and has already checked for it.
	//
	// A get then a put rather than an atomic insert, because the store has no
	// such operation. Two copies of one solution sent at the same moment can
	// both pass; anything later is refused, and every request still pays the
	// rate limiter.
	const store = rateLimitStore(env);
	if (!store) return { ok: false, status: 500, reason: 'Server misconfiguration: no rate-limit store configured' };
	const key = `altcha:${payload.challenge.parameters.nonce}`;
	if (await store.get(key)) return { ok: false, status: 403, reason: EXPIRED };
	const expiresAt = Number(payload.challenge.parameters.expiresAt) || 0;
	const ttl = Math.max(60, Math.ceil(expiresAt - Date.now() / 1000));
	await store.put(key, '1', { expirationTtl: ttl });

	return { ok: true };
}
