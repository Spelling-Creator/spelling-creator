// A stand-in for Cloudflare Turnstile's browser script, served at
// /turnstile/v0/api.js. `pnpm dev:web:stub` loads it in place of Cloudflare's
// (see VITE_TURNSTILE_SCRIPT_URL in apps/web/.env.stub), so the AI dialogs and
// image search work with no Cloudflare account and no challenge to solve.
//
// It implements the part of `window.turnstile` the app uses (render, reset,
// remove, getResponse) and draws each widget as an <img>: "Verifying..." for a
// moment, then "Success!", the way the real widget looks when a visitor passes
// without having to click. The token it hands back means nothing; the stub's
// AI route doesn't check it (see ./ai.js).

const WIDTH = 300;
const HEIGHT = 65;

const THEMES = {
  light: {
    bg: "#fafafa",
    border: "#e0e0e0",
    text: "#232323",
    muted: "#6b6b6b",
  },
  dark: { bg: "#232323", border: "#3b3b3b", text: "#fafafa", muted: "#a5a5a5" },
};

function widgetSvg(state, theme) {
  const c = THEMES[theme];
  const icon =
    state === "success"
      ? `<circle cx="34" cy="32.5" r="13" fill="#16a34a"/><path d="M27.5 33l4.5 4.5 8.5-9" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<circle cx="34" cy="32.5" r="11" fill="none" stroke="${c.border}" stroke-width="3"/><path d="M34 21.5a11 11 0 0 1 11 11" fill="none" stroke="#16a34a" stroke-width="3" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 34 32.5" to="360 34 32.5" dur="0.8s" repeatCount="indefinite"/></path>`;
  const label = state === "success" ? "Success!" : "Verifying...";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"><rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="3" fill="${c.bg}" stroke="${c.border}"/>${icon}<text x="58" y="37.5" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="15" fill="${c.text}">${label}</text><text x="${WIDTH - 14}" y="53" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="9" fill="${c.muted}">Privacy · Terms</text></svg>`;
}

const dataUrl = (svg) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

// How long "Verifying..." shows before the widget passes.
const VERIFY_MS = 900;

/** The script, with the widget images inlined. */
export function turnstileScript() {
  const images = {};
  for (const theme of Object.keys(THEMES)) {
    for (const state of ["verifying", "success"]) {
      images[`${state}-${theme}`] = dataUrl(widgetSvg(state, theme));
    }
  }
  return `// Stand-in for Cloudflare Turnstile, from the stub API (apps/stub-api/src/turnstile.js).
(() => {
  const IMAGES = ${JSON.stringify(images)};
  const widgets = new Map();
  let count = 0;
  const themeOf = (opts) =>
    opts.theme === "dark" || (opts.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)
      ? "dark"
      : "light";
  // The app passes either the id render() returned or the container element.
  const find = (ref) => {
    if (widgets.has(ref)) return ref;
    for (const [id, w] of widgets) if (w.container === ref) return id;
    return null;
  };
  const start = (id) => {
    const w = widgets.get(id);
    clearTimeout(w.timer);
    w.token = "";
    w.img.src = IMAGES["verifying-" + themeOf(w.opts)];
    w.timer = setTimeout(() => {
      w.img.src = IMAGES["success-" + themeOf(w.opts)];
      w.token = "stub-turnstile-" + Math.random().toString(36).slice(2);
      if (typeof w.opts.callback === "function") w.opts.callback(w.token);
    }, ${VERIFY_MS});
  };
  window.turnstile = {
    render(el, opts = {}) {
      const container = typeof el === "string" ? document.querySelector(el) : el;
      const img = document.createElement("img");
      img.width = ${WIDTH};
      img.height = ${HEIGHT};
      img.alt = "Verification";
      img.style.display = "block";
      container.append(img);
      const id = "stub-widget-" + ++count;
      widgets.set(id, { container, img, opts });
      start(id);
      return id;
    },
    reset(ref) {
      const id = find(ref);
      if (id) start(id);
    },
    remove(ref) {
      const id = find(ref);
      if (!id) return;
      const w = widgets.get(id);
      clearTimeout(w.timer);
      w.img.remove();
      widgets.delete(id);
    },
    getResponse(ref) {
      const id = find(ref);
      return id ? widgets.get(id).token : undefined;
    },
    isExpired: () => false,
    ready: (fn) => fn(),
  };
})();
`;
}
