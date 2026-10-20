// GET /altcha/challenge: a fresh signed challenge for the ALTCHA widget.
//
// Only answers on an instance whose AI check is ALTCHA (AI_CHALLENGE=altcha);
// anywhere else it is a 404, as if the route did not exist. See lib/altcha.js
// for the check itself.
//
// Rate-limited per address. Asking costs nothing and making one costs the
// server a key derivation, so without a limit anyone could make the server do
// that work in a loop without ever solving one. The limit matches the AI flow's
// own, one challenge for each AI request it allows, and has its own bucket so
// that fetching challenges never eats into the requests they are for.

import { aiChallengeMode } from "../lib/aiChallenge.js";
import { ALTCHA_NOT_CONFIGURED, createAltchaChallenge } from "../lib/altcha.js";
import { jsonResponse, textResponse } from "../lib/http.js";
import { takeJoinToken } from "../lib/joinLimit.js";
import { clientIp, rateLimitStore } from "../platform/index.js";

const LIMIT = 60;
const WINDOW_SECONDS = 60;

export async function handleAltchaChallenge(request, env, cors) {
  if (aiChallengeMode(env) !== "altcha")
    return textResponse("Not found.", 404, cors);

  // The same store the AI flow needs for its limiter and for remembering spent
  // challenges, so an instance without one can't use ALTCHA either way.
  const kv = rateLimitStore(env);
  if (!kv) return textResponse(ALTCHA_NOT_CONFIGURED, 500, cors);
  const ip = clientIp(env, request) || "unknown";
  const refused = await takeJoinToken(kv, `altcha-rl:${ip}`, {
    message: "Too Many Requests",
    cors,
    limit: LIMIT,
    windowSeconds: WINDOW_SECONDS,
  });
  if (refused) return refused;

  const challenge = await createAltchaChallenge(env);
  if (!challenge) return textResponse(ALTCHA_NOT_CONFIGURED, 500, cors);

  const res = jsonResponse(challenge, 200, cors);
  // Every challenge is single-use, so no cache anywhere may hand one out twice.
  res.headers.set("Cache-Control", "no-store");
  return res;
}
