// The ALTCHA check, end to end: a challenge from this server, solved the way
// the widget solves it, accepted once and refused every way it should be.

import { solveChallenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/web/pbkdf2';
import { describe, expect, it } from 'vitest';

import { aiChallengeMode, verifyAiChallenge } from './aiChallenge.js';
import { altchaConfigured, createAltchaChallenge, verifyAltcha } from './altcha.js';

function kvStore() {
	const values = new Map();
	return {
		values,
		get: async (k) => values.get(k) ?? null,
		put: async (k, v, options) => void values.set(k, { v, options }),
		delete: async (k) => void values.delete(k),
	};
}

const envWith = (extra = {}) => ({
	SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
	PLATFORM: { rateLimit: kvStore() },
	...extra,
});

/** What the widget sends: its challenge and solution, as base64 JSON. */
const encode = (payload) => btoa(JSON.stringify(payload));

// The real challenge takes a few seconds to solve on one thread, which is
// right for the browser and slow for a test. Everything but the first test
// solves a cheap one: the checks are the same whatever the cost.
const CHEAP = { cost: 1, counter: 50 };

async function solved(env, options = CHEAP) {
	const challenge = await createAltchaChallenge(env, options);
	const solution = await solveChallenge({ challenge, deriveKey });
	return { challenge, solution, token: encode({ challenge, solution }) };
}

describe('verifyAltcha', () => {
	it('accepts a solved challenge once, and remembers it until it would expire', async () => {
		const env = envWith();
		// At the cost the route really asks for.
		const { challenge, token } = await solved(env, {});

		expect(await verifyAltcha(token, env)).toEqual({ ok: true });

		const stored = env.PLATFORM.rateLimit.values.get(`altcha:${challenge.parameters.nonce}`);
		expect(stored.options.expirationTtl).toBeGreaterThan(9 * 60);
		expect(stored.options.expirationTtl).toBeLessThanOrEqual(10 * 60);

		const again = await verifyAltcha(token, env);
		expect(again).toMatchObject({ ok: false, status: 403 });
		expect(again.reason).toContain('expired');
	});

	it('refuses a solution that was tampered with', async () => {
		// The derived key is the proof of work; the counter is only how it was
		// found. Half of the key is in the challenge, so changing the other half
		// is the forgery to refuse.
		const env = envWith();
		const { challenge, solution } = await solved(env);
		const flipped = solution.derivedKey.slice(0, -1) + (solution.derivedKey.endsWith('0') ? '1' : '0');
		const wrong = encode({ challenge, solution: { ...solution, derivedKey: flipped } });
		expect(await verifyAltcha(wrong, env)).toMatchObject({ ok: false, status: 403 });
	});

	it('refuses a challenge whose cost was lowered', async () => {
		// The signature covers every parameter, so nobody can ask for less work.
		const env = envWith();
		const { challenge, solution } = await solved(env);
		const cheaper = { ...challenge, parameters: { ...challenge.parameters, cost: 0 } };
		expect(await verifyAltcha(encode({ challenge: cheaper, solution }), env)).toMatchObject({ ok: false, status: 403 });
	});

	it('refuses a challenge it did not sign', async () => {
		const ours = envWith();
		const { token } = await solved(envWith({ ALTCHA_HMAC_KEY: 'someone-else' }));
		expect(await verifyAltcha(token, ours)).toMatchObject({ ok: false, status: 403, reason: 'Verification failed' });
	});

	it('refuses a challenge past its expiry', async () => {
		const env = envWith();
		const { token } = await solved(env, { ...CHEAP, expiresAt: new Date(Date.now() - 1000) });
		const result = await verifyAltcha(token, env);
		expect(result).toMatchObject({ ok: false, status: 403 });
		expect(result.reason).toContain('expired');
	});

	it('refuses tokens that are not payloads at all', async () => {
		const env = envWith();
		for (const token of ['', 'not base64!', btoa('not json'), encode({ challenge: {} })]) {
			expect(await verifyAltcha(token, env)).toMatchObject({ ok: false, status: 403 });
		}
	});

	it('is a configuration error, not a failed check, with no key to sign with', async () => {
		const env = { PLATFORM: { rateLimit: kvStore() } };
		expect(altchaConfigured(env)).toBe(false);
		expect(await createAltchaChallenge(env)).toBeNull();
		expect(await verifyAltcha('anything', env)).toMatchObject({ ok: false, status: 500 });
	});

	it('uses ALTCHA_HMAC_KEY in preference to the derived key', async () => {
		const env = envWith({ ALTCHA_HMAC_KEY: 'explicit' });
		const { token } = await solved(env);
		// Same explicit key, different service-role key: still ours.
		expect(await verifyAltcha(token, { ...env, SUPABASE_SERVICE_ROLE_KEY: 'rotated' })).toEqual({ ok: true });
	});
});

describe('aiChallengeMode', () => {
	it('reads the three modes, and anything else as turnstile', () => {
		expect(aiChallengeMode({})).toBe('turnstile');
		expect(aiChallengeMode({ AI_CHALLENGE: ' ALTCHA ' })).toBe('altcha');
		expect(aiChallengeMode({ AI_CHALLENGE: 'none' })).toBe('none');
		expect(aiChallengeMode({ AI_CHALLENGE: 'nope' })).toBe('turnstile');
	});
});

describe('verifyAiChallenge', () => {
	it('passes anything with none', async () => {
		expect(await verifyAiChallenge('', { AI_CHALLENGE: 'none' }, [], '')).toEqual({ ok: true });
	});

	it('checks ALTCHA with altcha', async () => {
		const env = envWith({ AI_CHALLENGE: 'altcha' });
		const { token } = await solved(env);
		expect(await verifyAiChallenge(token, env, [], '')).toEqual({ ok: true });
		expect(await verifyAiChallenge('', env, [], '')).toMatchObject({ ok: false, status: 403 });
	});

	it('checks Turnstile by default, which fails closed without its secret', async () => {
		expect(await verifyAiChallenge('token', {}, ['app.test'], '')).toMatchObject({ ok: false, status: 500 });
		expect(await verifyAiChallenge('token', { AI_CHALLENGE: 'typo' }, ['app.test'], '')).toMatchObject({
			ok: false,
			status: 500,
		});
	});
});
