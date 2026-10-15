// The configuration the server hands `@spelling-creator/core` before calling
// its fetchers from a request handler.
//
// In the browser this comes from import.meta.env (see apps/web/src/main.jsx).
// Here it comes from the server's own bindings, so that core's fetches resolve
// and `hasSupabase()` agrees with what the client will compute. That agreement
// is what lets a server render hydrate cleanly: a page that renders signed-out
// chrome on the server and signed-out chrome on the client's first pass. The
// link-preview cards (routes/og.js) read lessons and profiles through the same
// fetchers, so they configure core the same way.

/**
 * @param {object} env The host's bindings or environment.
 * @param {URL} url The request URL; its origin is where core fetches from.
 */
export function coreConfig(env, url) {
	return {
		// This Worker *is* the API, so the origin serving the page is always the
		// right one to fetch from: no configuration, and it follows the request
		// into local dev and any preview deployment.
		apiUrl: url.origin,
		supabaseUrl: env.SUPABASE_URL,
		supabaseAnonKey: env.SUPABASE_ANON_KEY,
		googleClientId: '',
		turnstileSiteKey: '',
		// The two settings a self-hosted instance changes about sign-in. Nothing
		// rendered on the server reads them today (the login page is not one of
		// the public read routes, and a server render is always signed out), but
		// the SPA is configured with them and this is the same core module, so
		// leaving them out would mean the server quietly holding a different
		// configuration from the client it hydrates into. `configureCore` merges,
		// so an unset value here would also persist between requests. Both default
		// the same way core does when the host doesn't set them.
		authMode: env.AUTH_MODE || 'magic-link',
		usernameDomain: env.USERNAME_DOMAIN || '',
	};
}
