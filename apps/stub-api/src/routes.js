// The HTTP side: the Worker API routes the hub, profiles, notifications and
// editor use, plus the handful of Supabase Auth endpoints sign-in needs. Shapes
// follow the real API (see the mappers in apps/api/src and the contracts in
// apps/docs/docs/developers/web-app/hub-and-accounts.md).

import crypto from "node:crypto";
import { PEOPLE, byId, personFromEmail, personFromToken } from "./people.js";
import { sessionFor } from "./sessions.js";
import {
  summary,
  fullLesson,
  ratingOf,
  commentJson,
  followerCount,
  followingCount,
  published,
} from "./seed.js";
import { loadImage } from "./snapshot.js";
import { splitPage } from "./split.js";
import { turnstileScript } from "./turnstile.js";

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const stripTags = (html) => html.replace(/<[^>]+>/g, "").trim();

/**
 * @param {object} state  From seed(), with `packs` and `pullPacks` from buildGit().
 * @param {{ appOrigin: string, dataDir: string, hubUrl: string, ai: object, log: Function }} opts
 *   `ai` is createAi() from ./ai.js.
 * @returns {(req, res) => Promise<void>}
 */
export function createHandler(state, { appOrigin, dataDir, hubUrl, ai, log }) {
  const routes = [];
  const on = (method, pattern, fn) =>
    routes.push({ method, re: new RegExp(`^${pattern}$`), fn });

  // ---------------------------------------------------------------- feeds
  // Atom, like the real /feed.xml. Links point at the app's origin, which is
  // what lets the home page turn them into in-app links.
  const atom = (title, entries) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom"><title>${esc(title)}</title><id>urn:stub:${esc(title)}</id><updated>${new Date().toISOString()}</updated>${entries
      .map(
        (e) =>
          `<entry><id>${esc(e.id)}</id><title>${esc(e.title)}</title><link rel="alternate" type="text/html" href="${esc(appOrigin + e.link)}"/><updated>${e.updated}</updated><author><name>${esc(e.author)}</name></author><summary>${esc(e.summary)}</summary></entry>`,
      )
      .join("")}</feed>`;
  const lessonEntry = (l) => ({
    id: `urn:s2c:lesson:${l.id}`,
    kind: "lesson",
    title: l.title,
    link: `/hub/${l.id}`,
    updated: l.createdAt,
    author: byId[l.authorId].displayName,
    summary: `${byId[l.authorId].displayName} published the lesson "${l.title}".`,
  });
  const activityOf = (userId) => {
    const lessons = published(state)
      .filter((l) => l.authorId === userId)
      .map(lessonEntry);
    const comments = state.comments
      .filter((c) => c.authorId === userId)
      .map((c) => {
        const l = state.lessons.get(c.lessonId);
        return {
          id: `urn:s2c:comment:${c.id}`,
          kind: "comment",
          title: `Comment on ${l.title}`,
          link: `/hub/${l.id}/discussion`,
          updated: c.createdAt,
          author: byId[userId].displayName,
          summary: stripTags(c.body),
        };
      });
    return [...lessons, ...comments].sort((a, b) =>
      b.updated.localeCompare(a.updated),
    );
  };

  // ---------------------------------------------------------------- auth (Supabase)
  // Sign in as anyone in people.js, with any password: "maya", "maya@example.com"
  // and a username's synthetic address all work.
  on("POST", "/auth/v1/token", async (ctx) => {
    const body = JSON.parse((await ctx.body()).toString() || "{}");
    const grant = ctx.url.searchParams.get("grant_type");
    const person =
      grant === "refresh_token"
        ? PEOPLE[String(body.refresh_token || "").replace("stub-refresh-", "")]
        : personFromEmail(body.email);
    if (!person) {
      return ctx.json(400, {
        error: "invalid_grant",
        error_description: `No such person. Sign in as one of: ${Object.keys(PEOPLE).join(", ")}.`,
      });
    }
    log(`${person.displayName} signed in`);
    ctx.json(200, sessionFor(person.key));
  });
  on("GET", "/auth/v1/user", (ctx) =>
    ctx.user
      ? ctx.json(200, sessionFor(byId[ctx.user].key).user)
      : ctx.json(401, { error: "not signed in" }),
  );
  on("POST", "/auth/v1/logout", (ctx) => ctx.send(204, ""));

  // ---------------------------------------------------------------- misc
  on("GET", "/split", (ctx) =>
    ctx.send(200, splitPage(ctx.url, appOrigin), "text/html; charset=utf-8"),
  );
  on("GET", "/mod/whoami", (ctx) => ctx.json(200, { role: null }));
  on("GET", "/spelling-words.json", (ctx) =>
    ctx.json(200, {
      words: [
        "communicate",
        "curious",
        "volcano",
        "penguin",
        "chocolate",
        "invention",
        "history",
      ],
    }),
  );
  on("GET", "/images/([0-9a-f]{64})", async (ctx, [hash]) => {
    const img = await loadImage({ dataDir, hubUrl, hash });
    if (!img) return ctx.send(404, "Not found");
    ctx.send(200, img.bytes, img.type, {
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  });
  // Uploads are accepted and forgotten: the editor keeps its own copy.
  on("PUT", "/images/([0-9a-f]{64})", (ctx) => ctx.json(200, { ok: true }));
  on("GET", "/feed.xml", (ctx) =>
    ctx.send(
      200,
      atom("Lesson hub", published(state).slice(0, 20).map(lessonEntry)),
      "application/atom+xml",
    ),
  );

  // ---------------------------------------------------------------- lessons
  on("GET", "/lessons", (ctx) =>
    ctx.json(200, { lessons: published(state).map(summary) }),
  );
  on("GET", "/lessons/mine", (ctx) =>
    ctx.json(200, {
      lessons: [...state.lessons.values()]
        .filter((l) => l.authorId === ctx.user)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(summary),
    }),
  );
  on("POST", "/lessons", async (ctx) => {
    const b = JSON.parse(await ctx.body());
    const l = {
      id: crypto.randomUUID(),
      authorId: ctx.user,
      title: b.title,
      doc: b.doc,
      published: Boolean(b.published),
      forkedFrom: b.forkedFrom ?? null,
      createdAt: new Date().toISOString(),
      ratings: new Map(),
    };
    state.lessons.set(l.id, l);
    log(
      `${byId[ctx.user].displayName} created "${l.title}" (${l.published ? "published" : "draft"})`,
    );
    ctx.json(201, { lesson: summary(l) });
  });
  on("GET", "/lessons/([^/]+)/comments", (ctx, [id]) =>
    ctx.json(200, {
      comments: state.comments
        .filter((c) => c.lessonId === id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(commentJson),
    }),
  );
  on("POST", "/lessons/([^/]+)/comments", async (ctx, [id]) => {
    const b = JSON.parse(await ctx.body());
    const l = state.lessons.get(id);
    if (!l) return ctx.send(404, "Lesson not found");
    const c = {
      id: crypto.randomUUID(),
      lessonId: id,
      parentId: b.parentId ?? null,
      authorId: ctx.user,
      body: b.body,
      createdAt: new Date().toISOString(),
      editedAt: null,
    };
    state.comments.push(c);
    if (b.rating) l.ratings.set(ctx.user, b.rating);
    log(
      `${byId[ctx.user].displayName} commented on "${l.title}"${b.rating ? ` (${b.rating} stars)` : ""}`,
    );
    ctx.json(201, {
      comment: commentJson(c),
      rating: b.rating ? ratingOf(l) : null,
    });
  });
  on("PATCH", "/lessons/([^/]+)/comments/([^/]+)", async (ctx, [, cid]) => {
    const b = JSON.parse(await ctx.body());
    const c = state.comments.find((x) => x.id === cid);
    if (!c) return ctx.send(404, "Comment not found");
    c.body = b.body;
    c.editedAt = new Date().toISOString();
    ctx.json(200, { comment: commentJson(c) });
  });
  // Interactive mode's saved answers: accepted, never kept.
  on("GET", "/lessons/([^/]+)/responses", (ctx) =>
    ctx.json(200, { responses: [] }),
  );
  on("POST", "/lessons/([^/]+)/responses", async (ctx, [id]) => {
    const b = JSON.parse(await ctx.body());
    ctx.json(201, {
      response: {
        id: crypto.randomUUID(),
        lessonId: id,
        answers: b.answers,
        completedAt: new Date().toISOString(),
      },
    });
  });
  const pullJson = (p) => ({ ...p, author: byId[p.authorId].displayName });
  on("GET", "/lessons/([^/]+)/pulls", (ctx, [id]) =>
    ctx.json(200, {
      canReview: state.lessons.get(id)?.authorId === ctx.user,
      pulls: state.pulls.filter((p) => p.lessonId === id).map(pullJson),
    }),
  );
  on("GET", "/lessons/([^/]+)/pulls/([^/]+)/pack", (ctx, [, pid]) => {
    const p = state.pullPacks.get(pid);
    if (!p) return ctx.send(404, "That proposal's changes are gone");
    ctx.send(200, p.packfile, "application/x-git-packfile", {
      "X-Git-Head": p.head,
    });
  });
  on(
    "POST",
    "/lessons/([^/]+)/pulls/([^/]+)/(close|merge)",
    (ctx, [, pid, action]) => {
      const p = state.pulls.find((x) => x.id === pid);
      if (!p) return ctx.send(404, "Proposal not found");
      p.status = action === "close" ? "closed" : "merged";
      p.resolvedBy = ctx.user;
      p.resolvedAt = new Date().toISOString();
      ctx.json(200, { pull: pullJson(p) });
    },
  );
  on("GET", "/lessons/([^/]+)", (ctx, [id]) => {
    const l = state.lessons.get(id);
    if (!l) return ctx.send(404, "Lesson not found");
    ctx.json(200, { lesson: fullLesson(l) });
  });
  on("PUT", "/lessons/([^/]+)", async (ctx, [id]) => {
    const b = JSON.parse(await ctx.body());
    const l = state.lessons.get(id);
    if (!l) return ctx.send(404, "Lesson not found");
    if (b.title) l.title = b.title;
    if (b.doc) l.doc = b.doc;
    if (typeof b.published === "boolean") {
      // Publishing a draft puts it at the top of the hub, as it would be.
      if (b.published && !l.published) l.createdAt = new Date().toISOString();
      l.published = b.published;
    }
    log(
      `${byId[ctx.user].displayName} saved "${l.title}" (${l.published ? "published" : "draft"})`,
    );
    ctx.json(200, { lesson: summary(l) });
  });
  on("DELETE", "/lessons/([^/]+)", (ctx, [id]) => {
    state.lessons.delete(id);
    ctx.json(200, { ok: true });
  });

  // ---------------------------------------------------------------- git
  on("GET", "/git/([^/]+)/refs", (ctx, [id]) => {
    const p = state.packs.get(id);
    if (!p) return ctx.send(404, "No history");
    ctx.json(200, { head: p.head, refs: p.refs });
  });
  on("GET", "/git/([^/]+)/pack", (ctx, [id]) => {
    const p = state.packs.get(id);
    if (!p) return ctx.send(404, "No history");
    ctx.send(200, p.packfile, "application/x-git-packfile", {
      "X-Git-Head": p.head,
      "X-Git-Refs": JSON.stringify(p.refs),
    });
  });
  // Pushes always land: there is only ever one stub user editing a lesson's
  // history at a time, so the compare-and-swap the real API does isn't needed.
  on("PUT", "/git/([^/]+)/pack", async (ctx, [id]) => {
    const packfile = await ctx.body();
    const head = ctx.req.headers["x-git-head"];
    const refs = ctx.req.headers["x-git-refs"]
      ? JSON.parse(ctx.req.headers["x-git-refs"])
      : { main: head };
    state.packs.set(id, { packfile, head, refs });
    ctx.json(200, { ok: true, head });
  });

  // ---------------------------------------------------------------- notifications
  const mine = (ctx) =>
    state.notifications.filter((n) => n.userId === ctx.user);
  // Who it's for stays on the server, as in the real API.
  const notificationJson = ({ userId: _userId, ...n }) => n;
  on("GET", "/notifications", (ctx) =>
    ctx.json(200, {
      notifications: mine(ctx)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(notificationJson),
    }),
  );
  on("POST", "/notifications/read", async (ctx) => {
    const b = JSON.parse((await ctx.body()).toString() || "{}");
    for (const n of mine(ctx)) if (!b.id || n.id === b.id) n.read = true;
    ctx.json(200, { ok: true });
  });
  on("POST", "/notifications/send-link", async (ctx) => {
    const b = JSON.parse(await ctx.body());
    const to = personFromEmail(b.email);
    if (!to) return ctx.send(400, "Enter a valid email address.");
    // The real API stores the absolute URL, and the bell opens absolute links in
    // a new tab. A link into this app is kept as a path instead, so following it
    // stays in the same tab (and on the recipient's own origin in /split).
    const url = new URL(b.link);
    const n = {
      id: crypto.randomUUID(),
      userId: to.id,
      type: "link",
      title: `${byId[ctx.user].displayName} sent you a link`,
      body: b.message || null,
      link:
        url.port === new URL(appOrigin).port
          ? url.pathname + url.search
          : url.toString(),
      read: false,
      createdAt: new Date().toISOString(),
    };
    state.notifications.push(n);
    log(`${byId[ctx.user].displayName} sent ${to.displayName} a link`);
    ctx.json(201, { notification: notificationJson(n) });
  });

  // ---------------------------------------------------------------- people
  on("GET", "/following/activity", (ctx) => {
    const followed = Object.values(PEOPLE).filter((p) =>
      state.follows.has(`${ctx.user}>${p.id}`),
    );
    const activity = followed
      .flatMap((p) => activityOf(p.id))
      .sort((a, b) => b.updated.localeCompare(a.updated))
      .slice(0, 12)
      .map((e) => ({
        id: e.id.replace("urn:s2c:", ""),
        title: e.kind === "lesson" ? e.title : `${e.author} commented`,
        summary:
          e.kind === "lesson" ? `${e.author} published a lesson.` : e.summary,
        link: e.link,
        updated: e.updated,
      }));
    ctx.json(200, { activity });
  });
  on("GET", "/profiles/([^/]+)/feed.xml", (ctx, [id]) =>
    ctx.send(
      200,
      atom(byId[id]?.displayName ?? "Profile", activityOf(id).slice(0, 20)),
      "application/atom+xml",
    ),
  );
  on("GET", "/profiles/([^/]+)/(followers|following)", (ctx, [id, which]) => {
    const ids = [...state.follows]
      .map((f) => f.split(">"))
      .filter(([a, b]) => (which === "followers" ? b === id : a === id))
      .map(([a, b]) => (which === "followers" ? a : b));
    ctx.json(200, {
      users: ids.map((u) => ({
        id: u,
        displayName: byId[u].displayName,
        bio: byId[u].bio,
      })),
    });
  });
  on("POST", "/profiles/([^/]+)/follow", (ctx, [id]) => {
    state.follows.add(`${ctx.user}>${id}`);
    ctx.json(200, { following: true, followerCount: followerCount(state, id) });
  });
  on("DELETE", "/profiles/([^/]+)/follow", (ctx, [id]) => {
    state.follows.delete(`${ctx.user}>${id}`);
    ctx.json(200, {
      following: false,
      followerCount: followerCount(state, id),
    });
  });
  on("GET", "/profiles/([^/]+)", (ctx, [id]) => {
    const p = byId[id];
    if (!p) return ctx.send(404, "No such user");
    ctx.json(200, {
      user: {
        id: p.id,
        displayName: p.displayName,
        bio: p.bio,
        followerCount: followerCount(state, p.id),
        followingCount: followingCount(state, p.id),
        isFollowing: ctx.user
          ? state.follows.has(`${ctx.user}>${p.id}`)
          : false,
      },
      lessons: published(state)
        .filter((l) => l.authorId === id)
        .map(summary),
    });
  });
  on("POST", "/profile/bio", async (ctx) => {
    const b = JSON.parse(await ctx.body());
    byId[ctx.user].bio = b.bio;
    ctx.json(200, { bio: b.bio });
  });

  // ---------------------------------------------------------------- AI and Turnstile
  // The stand-in widget script, the Worker's own AI handler, and the model
  // endpoint that handler is pointed at (see ./ai.js and ./turnstile.js).
  on("GET", "/turnstile/v0/api.js", (ctx) =>
    ctx.send(200, turnstileScript(), "text/javascript; charset=utf-8"),
  );
  on("POST", "/", async (ctx) => ai.handle(ctx, await ctx.body()));
  on("POST", "/ai-text/dislike", async (ctx) =>
    ai.dislike(ctx, await ctx.body()),
  );
  on("POST", "/stub-model/v1/chat/completions", async (ctx) =>
    ai.model(ctx, await ctx.body()),
  );

  // ---------------------------------------------------------------- dispatch
  return async function handle(req, res) {
    cors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    const url = new URL(req.url, "http://stub");
    const auth = req.headers.authorization || "";
    const ctx = {
      req,
      url,
      // Whoever the session token names. Supabase calls send the anon key here,
      // which names nobody.
      user: auth.startsWith("Bearer ")
        ? (personFromToken(auth.slice(7))?.id ?? null)
        : null,
      body: () => readBody(req),
      send(status, body, type = "text/plain; charset=utf-8", headers = {}) {
        res.writeHead(status, { "Content-Type": type, ...headers });
        res.end(body);
      },
      json(status, body) {
        this.send(status, JSON.stringify(body), "application/json");
      },
    };
    // Reading the hub is public; writing, and anything that is yours, needs a
    // session, as on the real API.
    // The AI routes are open to anyone, as on the real API, where Turnstile
    // rather than a session is the gate.
    const isPublic =
      url.pathname.startsWith("/auth/") ||
      (req.method === "POST" &&
        (url.pathname === "/" || url.pathname.startsWith("/stub-model/"))) ||
      (req.method === "GET" &&
        !/^(lessons\/mine|notifications|following\/)/.test(
          url.pathname.slice(1),
        ));
    if (!isPublic && !ctx.user) return ctx.send(401, "Sign in first.");
    // The AI routes can run `claude -p` on the developer's own account, so only
    // this machine may call them, however the stub is reached.
    if (
      req.method === "POST" &&
      (url.pathname === "/" || url.pathname.startsWith("/stub-model/")) &&
      !LOOPBACK.has(req.socket.remoteAddress)
    ) {
      return ctx.send(
        403,
        "The AI routes only answer requests from this machine.",
      );
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      try {
        return await r.fn(ctx, m.slice(1));
      } catch (err) {
        log(`error in ${req.method} ${url.pathname}: ${err.stack || err}`);
        return ctx.send(500, String(err));
      }
    }
    if (url.pathname !== "/favicon.ico")
      log(`not stubbed: ${req.method} ${url.pathname}`);
    ctx.send(404, "Not stubbed");
  };
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// The app runs on another origin (Vite's port), so every response carries CORS
// headers, including PATCH (comment edits) and the git headers the history
// client reads.
function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, apikey, X-Client-Info, X-Supabase-Api-Version, X-Git-Head, X-Git-Parent, X-Git-Refs, X-Git-Expected, X-Git-Deletes",
  );
  res.setHeader("Access-Control-Expose-Headers", "X-Git-Head, X-Git-Refs");
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}
