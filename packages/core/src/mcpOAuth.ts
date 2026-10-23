// Client for the MCP OAuth consent flow — backs OAuthAuthorizePage.jsx. Talks to
// the same Worker as the rest of the hub (see lessons.ts), which implements the
// two endpoints below (see routes/oauth.js in apps/api).
//
//   GET  {apiUrl()}/oauth/request?state=   -> { clientName, redirectUri, scope, clientState }  (public)
//   POST {apiUrl()}/oauth/approve          { state, refreshToken } -> { redirectTo }            (auth: Bearer)
import { apiUrl, hasApi } from "./config.ts";

/** What the consent screen shows about a pending authorization request. */
export interface OAuthRequest {
  /** The client's registered name, or its id when it has none. */
  clientName: string;
  redirectUri: string;
  scope: string[];
  /** The client's own `state`, handed back to it on a denial. */
  clientState: string;
}

function endpoint(path: string): string {
  return `${apiUrl()}/oauth${path}`;
}

async function readError(res: Response): Promise<Error> {
  const data: { error?: string } | null = await res.json().catch(() => null);
  return new Error(data?.error || `Request failed (${res.status}).`);
}

/** The pending authorization request a `state` token refers to. */
export async function fetchOAuthRequest(state: string): Promise<OAuthRequest> {
  if (!hasApi()) throw new Error("The lesson hub is not configured.");
  let res;
  try {
    res = await fetch(endpoint(`/request?state=${encodeURIComponent(state)}`));
  } catch {
    throw new Error("Could not reach the lesson hub.");
  }
  if (!res.ok) throw await readError(res);
  return res.json();
}

/** Approve the pending request, minting the MCP grant. Returns where to send the browser next. */
export async function approveOAuthRequest(
  state: string,
  accessToken: string,
  refreshToken: string,
): Promise<string> {
  if (!hasApi()) throw new Error("The lesson hub is not configured.");
  let res;
  try {
    res = await fetch(endpoint("/approve"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state, refreshToken }),
    });
  } catch {
    throw new Error("Could not reach the lesson hub.");
  }
  if (!res.ok) throw await readError(res);
  const data: { redirectTo: string } = await res.json();
  return data.redirectTo;
}
