// The seam between the app and whatever serves it.
//
// The server build (build/server/index.js) runs inside a host that is not
// this app: the Cloudflare Worker (apps/api/src/routes/next.js), or the
// self-hosted Node server. The host knows things the app cannot: where the
// API is (itself), the Supabase project, which sign-in modes to offer. It
// passes them in through React Router's request context, under this key, and
// the root route's middleware configures core from them before any loader
// runs (see root.tsx).
//
// React Router's own dev server is the one host that sets nothing. The root
// route then falls back to the build's own values (lib/config.ts), the way a
// plain Vite app would read them.
//
// The key is created here and re-exported from entry.server.tsx, so the host
// reaches it through the build (`build.entry.module.hostContext`) rather than
// importing this file: a context key is matched by identity, and the host
// bundles nothing of this app but the build.

import { createContext } from "react-router";
import type { CoreConfig } from "@spelling-creator/core/config";

export interface Host {
  /**
   * The settings the host knows, laid over the build's own (lib/config.ts)
   * on the server and then in the browser. Only the keys the host sets: a
   * key left out keeps the build's value, so a site key baked in at build
   * time survives a host that has no say about it.
   */
  config: Partial<CoreConfig>;
  /**
   * The public origin of the site ("https://spellingcreator.org"), for
   * canonical links and JSON-LD. Left out, the request's own origin is used.
   */
  origin?: string;
}

export const hostContext = createContext<Host | null>(null);
