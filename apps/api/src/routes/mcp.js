// Remote MCP endpoint — mounts the Spelling Creator MCP tools (from
// @spelling-creator/mcp) as a Streamable HTTP server, gated by a real OAuth 2.1
// flow instead of a pasted token. See routes/oauth.js for the consent screen
// that grants access, and buildOAuthProvider (called from index.js) for how the
// two are wired together.
//
// Supabase is the upstream identity: each grant's `props` carries a Supabase
// session captured at consent time (see routes/oauth.js), which `tokenExchangeCallback`
// below rotates in step with the MCP client's own OAuth token refresh. That
// callback is the only thing that ever spends the session's refresh token.
// Supabase refresh tokens are single-use, and one spent anywhere else leaves the
// grant holding a used token; Supabase sees it come back on the next refresh,
// treats it as stolen and revokes the whole session. So each MCP access token
// carries only the Supabase access token, and `HubMcp` reads it from whichever
// MCP token the current request arrived with.

import { OAuthProvider, OAuthError, GrantType } from '@cloudflare/workers-oauth-provider';
import { McpAgent } from 'agents/mcp';
import { buildMcpServer, durableSessionStore, grantAuth } from '@spelling-creator/mcp/worker';
import { refreshSupabaseSession, sessionHasEnded } from '@spelling-creator/mcp/auth';
import { handleAuthorize, handleOAuthRequest, handleOAuthApprove } from './oauth.js';

// Our own MCP access tokens live noticeably shorter than a Supabase JWT's ~1h
// lifetime, so a client that respects `expires_in` refreshes — and so rotates
// the upstream Supabase session, below — before that JWT would go stale.
const MCP_ACCESS_TOKEN_TTL = 45 * 60;

export function mcpConfig(env) {
	return {
		apiUrl: env.SPELLING_CREATOR_API_URL || 'https://spellingcreator.org',
		supabaseUrl: env.SUPABASE_URL,
		supabaseAnonKey: env.SUPABASE_ANON_KEY,
	};
}

// What an MCP access token carries: the grant's props minus the Supabase
// refresh token, which stays in the grant for `tokenExchangeCallback` alone.
function sessionEnded() {
	return new OAuthError('invalid_grant', {
		description: 'The Spelling Creator sign-in behind this connection has ended. Reconnect to sign in again.',
	});
}

function accessTokenPropsOf(props) {
	const { supabaseRefreshToken: _kept, ...carried } = props;
	return carried;
}

export class HubMcp extends McpAgent {
	// McpAgent only reads props when this object starts, but one connection
	// outlives many MCP access tokens, so a long-lived object would keep using
	// the first one's Supabase token after it expired. Every request reaches the
	// object through `setName` (McpAgent.serve looks it up by name), passing that
	// request's props, so this is where the current ones are picked up.
	async setName(name, props) {
		if (props && props.supabaseAccessToken !== this.props?.supabaseAccessToken) {
			await this.updateProps(props);
		}
		return super.setName(name, props);
	}

	async init() {
		const config = mcpConfig(this.env);
		// This object hibernates between tool calls and `init` runs again on the
		// way back, so anything the tools must remember across calls lives in its
		// storage rather than in the server they build. Today that is one thing:
		// which live collaboration session the connection is taking part in.
		this.server = buildMcpServer(
			config,
			grantAuth(() => this.props),
			{ sessionStore: durableSessionStore(this.ctx.storage) },
		);
	}
}

// Register the consent-flow endpoints on the app that serves everything else —
// they're ordinary routes, just ones that happen to call the env.OAUTH_PROVIDER
// helpers the library injects (see routes/oauth.js). Called once at module init
// since the routes themselves are static; only the OAuthProvider wrapping the
// whole app is built per request (below), so its callbacks can close over env.
export function registerOAuthConsentRoutes(app) {
	app.get('/authorize', (c) => handleAuthorize(c.req.raw, c.env));
	app.get('/oauth/request', (c) => handleOAuthRequest(c.req.raw, c.env, new URL(c.req.url), c.get('cors')));
	app.post('/oauth/approve', (c) => handleOAuthApprove(c.req.raw, c.env, new URL(c.req.url), c.get('cors')));
}

/**
 * Wraps the existing Hono `app` (unchanged for every other route) with the
 * OAuth authorization server + the `/mcp` Streamable HTTP endpoint. Built fresh
 * per request — cheap (just wiring config/closures, no I/O) — so
 * `tokenExchangeCallback` can close over this request's real `env` bindings
 * instead of hardcoding the Supabase project.
 * @param {import('hono').Hono} app
 * @param {*} env
 */
export function buildOAuthProvider(app, env) {
	const config = mcpConfig(env);
	return new OAuthProvider({
		apiRoute: '/mcp',
		apiHandler: HubMcp.serve('/mcp'),
		defaultHandler: app,
		authorizeEndpoint: '/authorize',
		tokenEndpoint: '/token',
		clientRegistrationEndpoint: '/register',
		scopesSupported: ['lessons'],
		accessTokenTTL: MCP_ACCESS_TOKEN_TTL,
		async tokenExchangeCallback(options) {
			if (options.grantType !== GrantType.REFRESH_TOKEN) {
				return {
					accessTokenProps: accessTokenPropsOf(options.props),
					accessTokenTTL: MCP_ACCESS_TOKEN_TTL,
				};
			}
			// Rides along with the MCP client's own refresh cadence: mint a fresh
			// Supabase session now, so tool calls over the next ~45 minutes' worth
			// of connections don't each need their own refresh round trip.
			//
			// A grant whose Supabase session can never refresh again (none stored,
			// or Supabase says it has ended) is answered with `invalid_grant`, which
			// makes the client ask the user to reconnect. A 500 would look like a
			// blip worth retrying and leave the connector "connected" while every
			// tool call fails. Anything else is rethrown, since it may well pass.
			if (!options.props.supabaseRefreshToken) throw sessionEnded();
			let session;
			try {
				session = await refreshSupabaseSession(config, options.props.supabaseRefreshToken);
			} catch (error) {
				if (sessionHasEnded(error)) throw sessionEnded();
				throw error;
			}
			const newProps = {
				...options.props,
				supabaseAccessToken: session.accessToken,
				supabaseRefreshToken: session.refreshToken,
			};
			return {
				newProps,
				accessTokenProps: accessTokenPropsOf(newProps),
				accessTokenTTL: MCP_ACCESS_TOKEN_TTL,
			};
		},
	});
}
