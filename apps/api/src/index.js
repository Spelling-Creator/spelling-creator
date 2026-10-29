// The Cloudflare Worker entry point.
//
// The route table itself lives in src/app.js, shared with the Node entry
// (src/node/server.js). What is added here is everything only this host can
// serve: live collaboration and the remote MCP endpoint (Durable Objects), and
// crawler prerendering plus og-image screenshots (Browser Rendering).
//
// Those extras are registered before `registerFrontend`, because the frontend
// catch-all answers every unmatched GET and would otherwise swallow them.

import { createApp, cors, registerFrontend, req, urlOf } from "./app.js";

import { CollabRoom } from "./collab-room.js";
import { federationFor } from "./lib/federation/index.js";
import { installSelfFetch, servingSelf } from "./lib/selfFetch.js";
import { PracticeRoom } from "./practice-room.js";
import { ogImage, handleFrontend } from "./routes/render.js";
import { handleCollab, handleCollabAgent } from "./routes/collab.js";
import { handlePractice, handlePracticeInfo } from "./routes/practice.js";
import {
  HubMcp,
  registerOAuthConsentRoutes,
  buildOAuthProvider,
} from "./routes/mcp.js";

// Re-export the Durable Object classes so Wrangler can bind them (the
// migrations in wrangler.jsonc register COLLAB_ROOM -> CollabRoom,
// PRACTICE_ROOM -> PracticeRoom and MCP_OBJECT -> HubMcp). See routes/collab.js,
// routes/practice.js and routes/mcp.js.
export { CollabRoom, PracticeRoom, HubMcp };

const app = createApp();

// Open Graph preview image: a headless-Chromium screenshot of an in-site page.
app.get("/og-image", (c) => ogImage(req(c), c.env, c.executionCtx, urlOf(c)));

// An AI assistant taking part in a session over HTTP (the MCP server can't hold
// a socket between tool calls). Registered first: its GET would otherwise be
// taken for a WebSocket upgrade by the wildcard below.
app.all("/collab/:code/agent", (c) =>
  handleCollabAgent(req(c), c.env, urlOf(c), cors(c)),
);
app.all("/collab/:code/agent/*", (c) =>
  handleCollabAgent(req(c), c.env, urlOf(c), cors(c)),
);

// Live-collaboration WebSocket. A WS upgrade arrives as a GET, so this must be
// registered before the GET/HEAD frontend fall-through below would shadow it.
app.get("/collab", (c) => handleCollab(req(c), c.env, urlOf(c), cors(c)));
app.get("/collab/*", (c) => handleCollab(req(c), c.env, urlOf(c), cors(c)));

// Letterboard session WebSocket: a Practice page hosting, a letterboard tablet
// following. Same reasoning as /collab for registering it here, before the
// frontend fall-through. The bare path is the capability check the Practice
// page makes before offering its letterboard button, so it comes first.
app.get("/practice", (c) => handlePracticeInfo(c.env, cors(c)));
app.get("/practice/*", (c) => handlePractice(req(c), c.env, urlOf(c), cors(c)));

// Consent screen backing the remote MCP OAuth flow. `/authorize`, `/token`, and
// `/register` are also reserved paths (the OAuthProvider wrap below implements
// `/token` + `/register` itself) — see routes/mcp.js and routes/oauth.js.
registerOAuthConsentRoutes(app);

// Everything else that is a GET/HEAD is a request for the frontend: server-render
// it, hand a crawler a prerendered snapshot, or serve the static asset.
registerFrontend(app, handleFrontend);

// The OAuthProvider wraps the whole app: it serves the MCP OAuth authorization
// server itself (/token, /register, discovery metadata) and the /mcp Streamable
// HTTP endpoint, and passes every other request through to `app` unchanged —
// see routes/mcp.js. Built fresh per request so its token-refresh callback can
// close over this request's env bindings.
//
// Requests this Worker makes to its own origin — server rendering loading a
// page's data (routes/ssr.js), the MCP tool layer calling back into the API
// (SPELLING_CREATOR_API_URL, routes/mcp.js) — are answered in-process by the
// same wrapped handler. Cloudflare does not route a Worker's fetch to its own
// hostname back into the Worker; it sends it to the zone's origin server, and
// this site has none, so every such request used to die as a 522 (see
// lib/selfFetch.js). Wrapping the whole provider, not just `app`, keeps a
// self-request indistinguishable from an outside one.
export default {
  fetch(request, env, ctx) {
    installSelfFetch();
    const provider = buildOAuthProvider(app, env);
    const serve = servingSelf((request) => provider.fetch(request, env, ctx));
    return serve(request);
  },

  // Outgoing ActivityPub deliveries, when a FEDERATION_QUEUE binding exists (see
  // wrangler.jsonc). Cloudflare Queues hands batches here; each message is one
  // task Fedify enqueued and now runs. A failure retries that message alone,
  // with the queue's own backoff, rather than the whole batch.
  async queue(batch, env) {
    const federation = await federationFor(env);
    for (const message of batch.messages) {
      if (!federation) {
        message.ack();
        continue;
      }
      try {
        await federation.processQueuedTask({ env }, message.body);
        message.ack();
      } catch (error) {
        console.error("federation queue:", error);
        message.retry();
      }
    }
  },
};
