import type { Config } from "@react-router/dev/config";

// The app renders on the server for every route: a public page comes back as
// real HTML with its data in it, and a page whose content is the visitor's
// own (the editor, the library) comes back as its shell and finishes in the
// browser, through a clientLoader and a HydrateFallback on that route. One
// renderer, and each route says which of the two it is.
//
// Nothing is prerendered at build time. Every page here is either fetched
// from the API at request time or personal, so there is no static page to
// write out; `prerender` is the place to list one if that changes.
//
// routeDiscovery is "initial" rather than the lazy default: the route table
// is short, so shipping the whole manifest with the document costs little,
// and it means the host never has to serve a /__manifest request. The Worker
// decides which paths this app answers (apps/api/src/routes/next.js), and one
// fewer path to route is one fewer thing to get wrong.
export default {
  ssr: true,
  routeDiscovery: { mode: "initial" },
} satisfies Config;
