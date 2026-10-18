// Registers the <altcha-widget> custom element, styles and solver workers
// included.
//
// A module of its own so that src/lib/aiChallenge.jsx can load it with a
// dynamic import(), only on an instance whose AI check is ALTCHA, and so the
// server build can stub it out (SSR_UNREACHABLE in vite.config.js): the widget
// only ever runs in a browser, from inside an open dialog.

import "altcha";

export default function altchaLoaded() {
  return true;
}
