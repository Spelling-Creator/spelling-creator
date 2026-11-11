// Light and dark. The persisted choice is "light" | "dark" | "system"; what is
// actually applied is always "light" | "dark", with "system" tracking the OS
// through matchMedia. The value lands as data-theme="light"|"dark" on <html>,
// which every CSS variable block in styles/globals.css reads. A blocking
// inline script in root.tsx applies the stored or OS value before first paint
// so there is no flash of the wrong theme.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** The storage key; root.tsx's pre-paint script reads the same one. */
export const STORAGE_KEY = "spelling-creator:color-scheme";

export type Scheme = "light" | "dark" | "system";
export type Resolved = "light" | "dark";

interface ColorScheme {
  scheme: Scheme;
  resolved: Resolved;
  setScheme: (next: Scheme) => void;
}

const ColorSchemeContext = createContext<ColorScheme | null>(null);

function getSystemScheme(): Resolved {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function readStoredScheme(): Scheme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // localStorage unavailable (private browsing, etc.): fall back to system.
  }
  return "system";
}

// What the first render assumes, before the stored choice has been read. The
// server has neither localStorage nor matchMedia, so it can only ever render
// this, and a hydrating client has to render the same thing or React tears
// the tree down and renders it again. (The header's toggle shows a sun or a
// moon depending on `resolved`, so this is markup, not just a CSS variable.)
const INITIAL_SCHEME: Resolved = "light";

// useLayoutEffect warns when it is reached through the server renderer, where
// it can't run at all. There is nothing to adopt on the server, so fall back
// to useEffect there and keep the before-paint timing in the browser.
const useAdoptEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function ColorSchemeProvider({ children }: { children: ReactNode }) {
  // Deliberately not seeded from storage: see INITIAL_SCHEME. The real value
  // is adopted below, in a layout effect, so it lands after hydration but
  // before the browser paints: there is no flash of the wrong toggle icon,
  // and the page's actual colors were already set before paint by the inline
  // script regardless.
  const [scheme, setScheme] = useState<Scheme>("system");
  const [resolved, setResolved] = useState<Resolved>(INITIAL_SCHEME);

  useAdoptEffect(() => {
    setScheme(readStoredScheme());
  }, []);

  // Persisting belongs to the act of choosing, not to observing the state:
  // doing it in an effect would write the placeholder "system" over a stored
  // "dark" during the first render, before the value above has been adopted.
  const chooseScheme = useCallback((next: Scheme) => {
    setScheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore write failures; the choice just won't persist this session.
    }
  }, []);

  useEffect(() => {
    if (scheme !== "system") {
      setResolved(scheme);
      return;
    }

    setResolved(getSystemScheme());
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(getSystemScheme());
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [scheme]);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", resolved);
    // theme-color tints the browser and OS chrome around the page, and has
    // to match the header (--card) under it. The document's tags can only
    // choose by the OS preference, so once the app has resolved its own
    // theme, every tag takes that theme's value instead and a theme chosen
    // against the OS wins.
    const color = getComputedStyle(root).getPropertyValue("--card").trim();
    if (color) {
      for (const meta of document.querySelectorAll(
        'meta[name="theme-color"]',
      )) {
        meta.setAttribute("content", color);
      }
    }
  }, [resolved]);

  const value = useMemo<ColorScheme>(
    () => ({ scheme, resolved, setScheme: chooseScheme }),
    [scheme, resolved, chooseScheme],
  );

  return <ColorSchemeContext value={value}>{children}</ColorSchemeContext>;
}

export function useColorScheme(): ColorScheme {
  const ctx = useContext(ColorSchemeContext);
  if (!ctx) {
    throw new Error("useColorScheme must be used within ColorSchemeProvider");
  }
  return ctx;
}
