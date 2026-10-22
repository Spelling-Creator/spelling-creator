// The seam between the host app's configuration and this package.
//
// Core modules must not read `import.meta.env` — that is bundler-specific, it is
// substituted at build time, and it does not exist in Node, in the Worker, or in
// another bundler's build. A module that reads it at import time can only ever be
// used by the web app, which is what previously pinned the whole image/export
// tier inside apps/web.
//
// So the host tells core what it needs to know, once, before anything uses it:
//
//   // apps/web/src/main.jsx
//   configureCore({ apiUrl: import.meta.env.VITE_API_URL });
//
// A SvelteKit app would pass `PUBLIC_API_URL` here instead, and the Worker or a
// test can pass whatever it likes. A self-hosted Node server writes its own
// values into the page as `window.__CONFIG__`, which main.jsx merges over the
// build's before calling this (see apps/api/src/node/browserConfig.js). The reader functions resolve lazily, so import
// order doesn't matter — only that configureCore runs before the first *call*.

import { DEFAULT_USERNAME_DOMAIN } from "./username.ts";

/**
 * What the host tells core. Every key is optional, and one left unset (or set
 * to an env var that turned out undefined) reads as its default.
 */
export interface CoreConfig {
  /** Base URL of the Worker API, trailing slash optional. */
  apiUrl?: string;
  /** Supabase project URL (browser auth only). */
  supabaseUrl?: string;
  /** Supabase anon key. */
  supabaseAnonKey?: string;
  /** OAuth 2.0 Web client id, for "save to Google Docs". */
  googleClientId?: string;
  /** Public Cloudflare Turnstile site key. */
  turnstileSiteKey?: string;
  /**
   * 'turnstile' (default), 'altcha', or 'none'. Read loosely (see aiChallenge),
   * since it usually comes straight from an env var.
   */
  aiChallenge?: string;
  /** 'magic-link' (default), 'password', or 'both'. Read loosely, like aiChallenge. */
  authMode?: string;
  /** The domain usernames become addresses under (see usernameDomain). */
  usernameDomain?: string;
}

/** The check in front of the AI and image-search features. */
export type AiChallenge = "turnstile" | "altcha" | "none";

/** How people sign in to an instance. */
export type AuthMode = "magic-link" | "password" | "both";

const config: CoreConfig = {
  apiUrl: "",
  supabaseUrl: "",
  supabaseAnonKey: "",
  googleClientId: "",
  turnstileSiteKey: "",
  aiChallenge: "turnstile",
  authMode: "magic-link",
  usernameDomain: "",
};

/**
 * Set the host's configuration. Call once, as early as possible. Merges, so a
 * later call can add a key without clearing the others.
 */
export function configureCore(next: CoreConfig): void {
  Object.assign(config, next);
}

/**
 * Base URL of the Worker API, with any trailing slash removed so callers can
 * append `/images/…` without doubling it.
 *
 * Returns "" when unconfigured rather than throwing: the app is expected to run
 * against no backend at all (the homepage's word animation and the offline
 * editor both degrade gracefully), and that was the behaviour when each module
 * read a possibly-undefined env var itself.
 */
export function apiUrl(): string {
  return (config.apiUrl || "").replace(/\/$/, "");
}

/**
 * The same base as `apiUrl`, for opening a WebSocket: an `https` API gets the
 * secure `wss` scheme, and only a plain `http` API gets plain `ws`. One place
 * for the mapping, so live collaboration and letterboard sessions always reach
 * the same host.
 *
 * Returns "" when no API is configured, like `apiUrl`.
 */
export function apiWsUrl(): string {
  const base = apiUrl();
  if (base.startsWith("https://")) return `wss://${base.slice(8)}`;
  // The socket keeps the API's own scheme. A plain http API is a local one in
  // practice (the stub or `wrangler dev` run with PORTLESS=0), and every request
  // to it already carries the same session token in the clear, so upgrading
  // only the socket would protect nothing and break local development. Any
  // https API, the hosted hub included, is answered above.
  // nosemgrep: javascript.lang.security.detect-insecure-websocket
  if (base.startsWith("http://")) return `ws://${base.slice(7)}`;
  return base;
}

/**
 * Whether a backend is configured at all. Callers that cannot degrade use this
 * to fail early with a clear message instead of fetching from "/…".
 */
export function hasApi(): boolean {
  return apiUrl() !== "";
}

/**
 * Supabase's browser credentials, or null when auth isn't configured. Returned
 * together because neither half is usable alone.
 */
export function supabaseConfig(): { url: string; anonKey: string } | null {
  const { supabaseUrl, supabaseAnonKey } = config;
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return { url: supabaseUrl, anonKey: supabaseAnonKey };
}

/**
 * Whether sign-in is available. When false the login page and "Publish to hub"
 * explain that accounts are unavailable, but browsing the hub still works.
 */
export function hasSupabase(): boolean {
  return supabaseConfig() !== null;
}

/**
 * OAuth 2.0 Web client id for the Google Docs export. "" when unconfigured.
 */
export function googleClientId(): string {
  return config.googleClientId || "";
}

/** Whether "save to Google Docs" is available. */
export function hasGoogleDrive(): boolean {
  return googleClientId() !== "";
}

/**
 * Public Turnstile site key for rendering the widget. "" when unconfigured, in
 * which case the AI and image-search dialogs explain they're unavailable.
 */
export function turnstileSiteKey(): string {
  return config.turnstileSiteKey || "";
}

/** Whether a Turnstile site key is configured. */
export function hasTurnstile(): boolean {
  return turnstileSiteKey() !== "";
}

/**
 * Which check this instance puts in front of the AI and image-search features.
 * It has to match the server's AI_CHALLENGE, which is why a self-hosted server
 * hands the SPA the same value at runtime.
 *
 *   'turnstile'  Cloudflare Turnstile. Needs a site key (the hosted instance).
 *   'altcha'     ALTCHA proof of work, served by the instance's own API.
 *   'none'       No check; the server lets every request through to its rate
 *                limiter.
 *
 * Anything unrecognized reads as 'turnstile', the same way the server reads it.
 */
export function aiChallenge(): AiChallenge {
  const mode = (config.aiChallenge || "").trim().toLowerCase();
  return mode === "altcha" || mode === "none" ? mode : "turnstile";
}

/**
 * Whether the challenge-gated features (the AI dialogs, AI fixes, fact checks
 * and Pixabay search) can work here: there is an API to send them to, and the
 * instance's check is one the browser can pass.
 */
export function hasAiChallenge(): boolean {
  if (!hasApi()) return false;
  return aiChallenge() === "turnstile" ? hasTurnstile() : true;
}

/**
 * How people sign in to this instance.
 *
 * The hosted instance is magic-link only, which is the nicer experience and the
 * default. It is also the one that cannot work without a mail server — and a
 * self-hosted instance frequently has no SMTP at all, which would otherwise
 * leave it with no way for anyone to sign in. So the mode is per-instance:
 *
 *   'magic-link'  email a one-time link. Needs SMTP.
 *   'password'    email and password. Needs no mail at all.
 *   'both'        offer either, the visitor chooses.
 *
 * Anything unrecognized reads as 'magic-link', so a typo degrades to the
 * default rather than to an instance nobody can get into.
 */
export function authMode(): AuthMode {
  const mode = (config.authMode || "").trim();
  return mode === "password" || mode === "both" ? mode : "magic-link";
}

/** Whether this instance offers email + password sign-in. */
export function hasPasswordAuth(): boolean {
  return authMode() !== "magic-link";
}

/** Whether this instance offers magic-link sign-in. */
export function hasMagicLinkAuth(): boolean {
  return authMode() !== "password";
}

/**
 * The shortest password this instance accepts.
 *
 * Matched to GOTRUE_PASSWORD_MIN_LENGTH on the server: the check here exists so
 * somebody is told before they submit, not instead of the server's.
 */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * The domain usernames are turned into addresses under.
 *
 * See @spelling-creator/core/username for why there is one at all. An instance
 * only needs to set this if the default collides with something it actually
 * sends mail to, which — the default being a reserved `.invalid` domain — it
 * cannot.
 */
export function usernameDomain(): string {
  return (config.usernameDomain || "").trim() || DEFAULT_USERNAME_DOMAIN;
}
