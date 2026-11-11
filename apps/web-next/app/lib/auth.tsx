// Auth context: wraps the Supabase session so any page can read the current
// user, send a magic-link sign-in email, or sign out. Lesson reads and writes
// do NOT happen here; this only owns the session and the access token that
// the Worker needs to authorize a publish.
//
// The server renders signed out: the session lives in localStorage behind
// PKCE and is invisible to a server, which is the whole reason only public
// reads are rendered there. The personalized chrome fills in after hydration.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  hasMagicLinkAuth,
  hasPasswordAuth,
  hasSupabase,
  usernameDomain,
} from "@spelling-creator/core/config";
import {
  identifierToEmail,
  usernameFromEmail,
  usernameToEmail,
} from "@spelling-creator/core/username";
import {
  getSupabase,
  readPersistedRefreshToken,
} from "@spelling-creator/core/browser/supabase";
import { fetchMyRole, type ModRole } from "@spelling-creator/core/moderation";

export interface Auth {
  /** Whether sign-in is configured at all. */
  enabled: boolean;
  /** True until it is known whether a session was restored from storage. */
  loading: boolean;
  session: Session | null;
  user: User | null;
  /** The JWT the Worker verifies before accepting a publish. */
  accessToken: string | null;
  /** The user's chosen display name, or null if they haven't set one yet. */
  displayName: string | null;
  /** True once it is known a signed-in user still needs to pick a name. */
  needsDisplayName: boolean;
  /** Moderation tier, from the Worker. Every privileged action is checked there too. */
  role: ModRole | null;
  roleLoading: boolean;
  isModerator: boolean;
  isAdmin: boolean;
  passwordAuth: boolean;
  magicLinkAuth: boolean;
  /** The username this account signs in with, or null for one made from a real address. */
  username: string | null;
  signInWithMagicLink(email: string, redirectTo?: string): Promise<void>;
  verifyEmailCode(email: string, code: string): Promise<void>;
  signInWithPassword(identifier: string, password: string): Promise<void>;
  signUpWithUsername(
    username: string,
    password: string,
  ): Promise<{ needsConfirmation: boolean }>;
  signOut(): Promise<void>;
  refreshSession(): Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);

function client() {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sign-in is not configured.");
  return supabase;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  // The signed-in user's moderation tier, looked up from the Worker. Used only
  // to decide which moderation controls to render.
  const [role, setRole] = useState<ModRole | null>(null);
  // True while the role for the current token is being fetched. Pages that
  // gate on the role (the moderation dashboard) wait for this so they don't
  // flash a "no access" state, or bounce the user, before the lookup resolves.
  const [roleLoading, setRoleLoading] = useState(false);
  // `loading` is true until it is known whether a session was restored from
  // storage (or parsed from a magic-link callback), so pages can avoid
  // flashing a signed-out state on first paint.
  const [loading, setLoading] = useState(hasSupabase());

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;

    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (data.session) {
        setSession(data.session);
        setLoading(false);
        return;
      }
      // No session in memory. Normally that just means signed out, but it is
      // also what a known SDK gap looks like: a valid session can be stuck
      // unloaded after a failed startup refresh (see readPersistedRefreshToken
      // for the full story). If a persisted refresh token is sitting in
      // storage, force one more real refresh attempt with it before
      // concluding the user is actually signed out.
      const refreshToken = readPersistedRefreshToken();
      if (!refreshToken) {
        setSession(null);
        setLoading(false);
        return;
      }
      const { data: refreshed } = await supabase.auth
        .refreshSession({ refresh_token: refreshToken })
        .catch(() => ({ data: null }));
      if (!active) return;
      setSession(refreshed?.session ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  // Look up the signed-in user's moderation role whenever the token changes
  // (sign-in, sign-out, refresh). Clears to null when signed out.
  const accessToken = session?.access_token ?? null;
  useEffect(() => {
    let active = true;
    if (!accessToken) {
      setRole(null);
      setRoleLoading(false);
      return;
    }
    setRoleLoading(true);
    fetchMyRole(accessToken).then((r) => {
      if (!active) return;
      setRole(r);
      setRoleLoading(false);
    });
    return () => {
      active = false;
    };
  }, [accessToken]);

  const user = session?.user ?? null;
  // The public name the user chose (set through the Worker's /profile endpoint
  // and stored in user_metadata). This, never the email, is what others see.
  const displayName =
    (String(user?.user_metadata?.display_name ?? "") || "").trim() || null;
  // The login identifier for a username account, read from metadata and
  // falling back to unpicking the synthetic address: accounts made before the
  // metadata was written still have the username sitting in their address.
  const username =
    String(user?.user_metadata?.username ?? "").trim() ||
    usernameFromEmail(user?.email, usernameDomain()) ||
    null;

  const value = useMemo<Auth>(
    () => ({
      enabled: hasSupabase(),
      loading,
      session,
      user,
      accessToken: session?.access_token ?? null,
      displayName,
      // Waits for `loading` so the prompt doesn't flash before the session is
      // restored.
      needsDisplayName: hasSupabase() && !loading && !!user && !displayName,
      role,
      roleLoading,
      isModerator: role === "moderator" || role === "admin",
      isAdmin: role === "admin",

      // Send a passwordless magic link. `redirectTo` brings the user back to
      // the given page (the app root by default), where the Supabase client
      // exchanges the `?code=` for a session. Callers that need the user back
      // on a specific page (the MCP OAuth consent screen, which carries its
      // own `?state=`) pass an explicit redirectTo.
      async signInWithMagicLink(email, redirectTo = window.location.origin) {
        const { error } = await client().auth.signInWithOtp({
          email,
          options: { emailRedirectTo: redirectTo },
        });
        if (error) throw new Error(error.message);
      },

      // Finish a magic-link sign-in by typing the code from the same email
      // instead of opening the link. The link only signs in the browser that
      // opens it, and on an installed app that is often the wrong one: iOS
      // opens every emailed link in Safari, whose storage is separate from
      // the Home Screen app's, so the app never sees the session. A code has
      // no redirect, so it signs in wherever it's typed. The thrown error
      // keeps GoTrue's `code` (e.g. "otp_expired") so the caller can say
      // something friendlier than the raw message.
      async verifyEmailCode(email, code) {
        const { error } = await client().auth.verifyOtp({
          email,
          token: code,
          type: "email",
        });
        if (error) {
          throw Object.assign(new Error(error.message), { code: error.code });
        }
      },

      // Whether this instance offers each way in. Read here rather than by
      // the login page so there is one answer to "how does one sign in".
      passwordAuth: hasPasswordAuth(),
      magicLinkAuth: hasMagicLinkAuth(),

      username,

      // Sign in with a password, by username or by email address. Which one
      // was typed is decided by the value rather than by a toggle: an input
      // containing `@` is an address, anything else is a username, and a
      // username is turned into the synthetic address it registered under.
      async signInWithPassword(identifier, password) {
        const resolved = identifierToEmail(identifier, usernameDomain());
        if (!resolved) throw new Error("Enter your username or email address.");
        const { error } = await client().auth.signInWithPassword({
          email: resolved.email,
          password,
        });
        if (error) throw new Error(error.message);
      },

      // Create an account from a username and a password, with no email
      // address involved at all. The username goes into user_metadata as well
      // as into the address, so it can be shown back to its owner. It does
      // NOT set a display name: those are checked for profanity and banned
      // names by the profile endpoint, and setting one here would route
      // around that. `needsConfirmation` reports whether the server wants the
      // address confirmed first (which a synthetic address never can be, so
      // an instance offering usernames is expected to auto-confirm).
      async signUpWithUsername(username_, password) {
        const { data, error } = await client().auth.signUp({
          email: usernameToEmail(username_, usernameDomain()),
          password,
          options: { data: { username: username_.trim().toLowerCase() } },
        });
        if (error) throw new Error(error.message);
        return { needsConfirmation: !data?.session };
      },

      async signOut() {
        const supabase = getSupabase();
        if (!supabase) return;
        await supabase.auth.signOut();
      },

      // Pull a fresh session from Supabase so newly saved user_metadata (a
      // display name the Worker just wrote through the Admin API) shows in
      // `user`. The Worker writes metadata out of band, so the cached session
      // has to be refreshed for the change to show up here.
      async refreshSession() {
        const supabase = getSupabase();
        if (!supabase) return;
        const { data } = await supabase.auth.refreshSession();
        setSession(data?.session ?? null);
      },
    }),
    [loading, session, user, displayName, username, role, roleLoading],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an <AuthProvider>.");
  }
  return ctx;
}
