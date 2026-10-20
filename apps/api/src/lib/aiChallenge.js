// Which check stands in front of the AI and image flow, chosen per instance.
//
//   AI_CHALLENGE=turnstile  Cloudflare Turnstile (the default, and what the
//                           hosted instance uses). Needs a widget of your own:
//                           TURNSTILE_SECRET_KEY here, the site key in the SPA.
//   AI_CHALLENGE=altcha     ALTCHA proof of work (lib/altcha.js). Self-contained:
//                           nothing to sign up for, nothing leaves the instance.
//   AI_CHALLENGE=none       No check at all. For an instance only trusted people
//                           can reach. The per-IP rate limiter still applies.
//
// The SPA reads the same setting (see core's aiChallenge()), so the browser
// shows the matching widget, or none.
//
// Anything else reads as turnstile, so a typo fails closed: the AI features
// refuse until the setting is fixed, rather than quietly running with no check.

import { verifyAltcha } from "./altcha.js";
import { verifyTurnstile } from "./turnstile.js";

export const AI_CHALLENGES = ["turnstile", "altcha", "none"];

/**
 * This instance's challenge.
 * @param {object} env
 * @returns {'turnstile' | 'altcha' | 'none'}
 */
export function aiChallengeMode(env) {
  const mode = String(env.AI_CHALLENGE || "")
    .trim()
    .toLowerCase();
  return AI_CHALLENGES.includes(mode) ? mode : "turnstile";
}

/**
 * Check a request's challenge token with whichever check this instance runs.
 * Resolves to `{ ok: true }` or `{ ok: false, status, reason }`.
 *
 * @param {string} token
 * @param {object} env
 * @param {string[]} allowedHostnames Turnstile compares its verified hostname with these.
 * @param {string} ip                 Passed to Turnstile as the solver's address.
 */
export async function verifyAiChallenge(token, env, allowedHostnames, ip) {
  switch (aiChallengeMode(env)) {
    case "none":
      return { ok: true };
    case "altcha":
      return verifyAltcha(token, env);
    default:
      return verifyTurnstile(
        token,
        env.TURNSTILE_SECRET_KEY,
        allowedHostnames,
        ip,
      );
  }
}
