// GET /altcha/challenge: a fresh signed challenge for the ALTCHA widget.
//
// Only answers on an instance whose AI check is ALTCHA (AI_CHALLENGE=altcha);
// anywhere else it is a 404, as if the route did not exist. See lib/altcha.js
// for the check itself.

import { aiChallengeMode } from '../lib/aiChallenge.js';
import { createAltchaChallenge } from '../lib/altcha.js';
import { jsonResponse, textResponse } from '../lib/http.js';

export async function handleAltchaChallenge(env, cors) {
	if (aiChallengeMode(env) !== 'altcha') return textResponse('Not found.', 404, cors);

	const challenge = await createAltchaChallenge(env);
	if (!challenge) {
		return textResponse('Server misconfiguration: set ALTCHA_HMAC_KEY or SUPABASE_SERVICE_ROLE_KEY', 500, cors);
	}

	const res = jsonResponse(challenge, 200, cors);
	// Every challenge is single-use, so no cache anywhere may hand one out twice.
	res.headers.set('Cache-Control', 'no-store');
	return res;
}
