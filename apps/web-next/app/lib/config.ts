// Where the app's configuration comes from.
//
// Core reads its settings through one seam, configureCore (packages/core/
// src/config.ts), and this is the only place in the app that touches
// import.meta.env. The build bakes the VITE_* values in; the host that serves
// the page can hand the browser a different set at request time, which wins
// (see lib/host.ts for the server's side of that).

import type { CoreConfig } from "@spelling-creator/core/config";

/** The build's configuration: the VITE_* values Vite substitutes in. */
export function buildTimeConfig(): CoreConfig {
  return {
    apiUrl: import.meta.env.VITE_API_URL,
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
    supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    turnstileSiteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
    aiChallenge: import.meta.env.VITE_AI_CHALLENGE,
    authMode: import.meta.env.VITE_AUTH_MODE,
    usernameDomain: import.meta.env.VITE_USERNAME_DOMAIN,
  };
}

declare global {
  interface Window {
    /**
     * The settings the host served this page with, written into the document
     * by the root route (see root.tsx) from what the host passed it. A Worker
     * or a self-hosted server sets these from its own environment, so one
     * build runs anywhere; the dev server has no host and writes nothing.
     */
    __CONFIG__?: Partial<CoreConfig>;
  }
}

/**
 * What the browser configures core with: the build's values, with whatever
 * the host wrote into the page over them. The same merge the server made
 * before it rendered (root.tsx), so the page hydrates against markup made
 * with the same settings. Read once, in entry.client.tsx, before anything
 * renders.
 */
export function browserConfig(): CoreConfig {
  return { ...buildTimeConfig(), ...(window.__CONFIG__ ?? {}) };
}
