// Test-only Worker entry. The room tests drive the Durable Objects directly
// through their stubs, which requires the classes to be exported from a Worker
// entry that Miniflare can load. The real entry (src/index.js) drags in Puppeteer,
// Supabase and the whole route table. The rooms themselves need none of that,
// and all of it would have to be stubbed to load it here.
//
// Driving the DOs directly also deliberately bypasses the Worker's Supabase JWT
// gates (handleCollab, handlePractice): authentication is the Worker's job, not
// the room's, so these tests are about each room's own behavior (merging,
// relaying, admission, persistence).
export { CollabRoom } from "./collab-room.js";
export { PracticeRoom } from "./practice-room.js";

export default {
  fetch() {
    return new Response("collab-room test worker");
  },
};
