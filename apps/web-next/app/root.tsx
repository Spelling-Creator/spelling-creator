// The root route: the document, the providers every page needs, and the
// configuration seam.
//
// Every request passes through here first. The middleware configures core
// from what the host passed in (lib/host.ts), or from the build's own values
// when there is no host (the dev server), before any loader runs. The loader
// hands the same values to the browser, through the inline script in the
// Layout, so the client configures core identically before it hydrates
// (entry.client.tsx). That is what keeps a server-rendered page and the
// client that hydrates it in agreement about what is configured.

import type { ReactNode } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";
import { configureCore, type CoreConfig } from "@spelling-creator/core/config";
import type { Route } from "./+types/root";
import { buildTimeConfig } from "@/lib/config";
import { hostContext } from "@/lib/host";
import { pageMeta } from "@/lib/seo";
import { AuthProvider } from "@/lib/auth";
import { ColorSchemeProvider, STORAGE_KEY } from "@/lib/colorScheme";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import DisplayNameGate from "@/components/DisplayNameGate";
import ErrorPage from "@/components/ErrorPage";
import favicon from "./favicon.svg";

// Tailwind and the shadcn/ui tokens, then the fonts. Self-hosted through
// Fontsource: Fraunces 600 is headings only; Public Sans 400/500/600 is UI
// and body text (see globals.css for where each is applied). React Router
// turns these imports into <link> tags in the document.
import "./styles/globals.css";
import "@fontsource/fraunces/600.css";
import "@fontsource/public-sans/400.css";
import "@fontsource/public-sans/500.css";
import "@fontsource/public-sans/600.css";
// The font files themselves, so they can be preloaded: fetched in parallel
// with the scripts and ready before first paint, which avoids the flash of
// fallback text. Vite fingerprints the URLs, so they come through imports
// rather than being written out.
import fraunces600 from "@fontsource/fraunces/files/fraunces-latin-600-normal.woff2?url";
import publicSans400 from "@fontsource/public-sans/files/public-sans-latin-400-normal.woff2?url";
import publicSans500 from "@fontsource/public-sans/files/public-sans-latin-500-normal.woff2?url";
import publicSans600 from "@fontsource/public-sans/files/public-sans-latin-600-normal.woff2?url";

// The settings this request's host laid over the build's, if any (none on
// the dev server). The server configures core with the build's values under
// them; the browser does the same with what the loader hands it, so the two
// agree key for key.
export const middleware: Route.MiddlewareFunction[] = [
  async ({ context }, next) => {
    const host = context.get(hostContext);
    configureCore({ ...buildTimeConfig(), ...host?.config });
    return next();
  },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const host = context.get(hostContext);
  return {
    origin: host?.origin ?? new URL(request.url).origin,
    config: host?.config ?? {},
  };
}

export const links: Route.LinksFunction = () => [
  ...[fraunces600, publicSans400, publicSans500, publicSans600].map((href) => ({
    rel: "preload",
    as: "font",
    type: "font/woff2",
    href,
    crossOrigin: "anonymous" as const,
  })),
  { rel: "icon", href: favicon, type: "image/svg+xml" },
  // iOS ignores the manifest's icons and uses apple-touch-icon.
  { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
  // Autodiscovery for the hub's "latest lessons" Atom feed, served
  // same-origin by the Worker at /feed.xml (surfaced as "RSS" in the UI).
  {
    rel: "alternate",
    type: "application/atom+xml",
    title: "Spelling Creator: latest lessons",
    href: "/feed.xml",
  },
];

// The site-wide defaults, for a page that sets none of its own. A route's
// meta replaces this set entirely, so every page carries exactly one title.
export const meta: Route.MetaFunction = ({ loaderData, location }) =>
  pageMeta({ origin: loaderData?.origin ?? "", pathname: location.pathname });

// Apply the stored or OS color scheme before first paint so there's no flash
// of the wrong theme. Mirrors lib/colorScheme.tsx, which takes over once
// React mounts and reads the same storage key.
const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});var r=s==="light"||s==="dark"?s:window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.setAttribute("data-theme",r)}catch(e){}})();`;

// The settings the host served this page with, for entry.client.tsx to read
// before anything renders. The escape matters in an inline script: a
// "</script>" inside any value would otherwise end the block early.
function configScript(config: Partial<CoreConfig>): string {
  return `window.__CONFIG__=${JSON.stringify(config).replace(/</g, "\\u003c")}`;
}

export function Layout({ children }: { children: ReactNode }) {
  const root = useRouteLoaderData<typeof loader>("root");
  return (
    // suppressHydrationWarning: the pre-paint script sets data-theme on this
    // element before React hydrates, and the server rendered it without one.
    // ColorSchemeProvider adopts the real value right after hydration.
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        {/* viewport-fit=cover lets the page reach under the status bar,
            notch and home indicator, which is what makes the
            env(safe-area-inset-*) values non-zero. Everything pinned to a
            screen edge steps back by them through the --safe-* tokens and
            *-safe utilities in styles/globals.css. */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, viewport-fit=cover"
        />
        {/* theme-color tints the OS and browser chrome around an installed
            window, so it has to match whatever is at the top of the screen,
            which is the header on --card. These pick by the OS preference;
            ColorSchemeProvider rewrites them to the theme the app resolves.
            Safari picks the first matching tag, so the dark one comes first.
            iOS ignores `display: standalone` unless mobile-web-app-capable
            is present. */}
        <meta
          name="theme-color"
          media="(prefers-color-scheme: dark)"
          content="#1b1b1b"
        />
        <meta name="theme-color" content="#ffffff" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Spelling" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <Meta />
        <Links />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {root && (
          <script
            dangerouslySetInnerHTML={{ __html: configScript(root.config) }}
          />
        )}
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

// ColorSchemeProvider is outermost (and adopts a value already applied
// before paint by the inline script) so light and dark are available
// everywhere. AuthProvider exposes the Supabase session to every page; the
// gate makes a new account pick a display name before it posts anything.
// Sonner's Toaster is outside the router's outlet because it isn't tied to
// any one page.
export default function App() {
  return (
    <ColorSchemeProvider>
      <TooltipProvider>
        <AuthProvider>
          <DisplayNameGate>
            <Outlet />
          </DisplayNameGate>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </ColorSchemeProvider>
  );
}

// For an error above the shell: the root loader or middleware failing. Pages
// inside the shell have boundaries of their own (RouteErrorBoundary) that
// keep the chrome; here there is none to keep.
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return (
    <ColorSchemeProvider>
      <TooltipProvider>
        <main className="min-h-svh bg-background">
          <ErrorPage error={error} />
        </main>
      </TooltipProvider>
    </ColorSchemeProvider>
  );
}
