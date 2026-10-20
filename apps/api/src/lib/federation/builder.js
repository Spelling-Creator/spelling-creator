// The ActivityPub side of the hub, as a Fedify federation.
//
// Every author is an actor at /users/<id> (the same address as their profile
// page; which one a request gets is decided by its Accept header), and every
// public lesson is an Article at /hub/<id>, likewise. The handle is the
// account id, `@<uuid>@<host>`: display names are neither unique nor fixed,
// and a handle has to be both.
//
// What this instance accepts from other servers is deliberately small: a
// Follow (answered with an Accept and remembered), its Undo, and a remote
// account's deletion. Nothing a remote user writes ever becomes content here;
// a comment or a proposal from another server would have to go through the
// same moderation as a local one, and that is a later piece of work. See
// /docs/developers/federation.
//
// This is a builder rather than a Federation because the stores it needs are
// per-host bindings that only exist once a request is in hand (see
// index.js, which builds it).

import {
  createFederationBuilder,
  exportJwk,
  generateCryptoKeyPair,
  importJwk,
} from "@fedify/fedify";
import {
  Accept,
  Article,
  Delete,
  Endpoints,
  Follow,
  Person,
  Undo,
} from "@fedify/vocab";

import { fetchPublicUser, supabaseBase } from "../supabase.js";
import { lessonActivity, lessonArticle } from "./article.js";
import {
  ID_RE,
  PAGE,
  addFollower,
  countComments,
  countFollowers,
  countPublishedLessons,
  fetchPublishedLesson,
  listFollowers,
  listPublishedLessons,
  loadKeys,
  removeActorEverywhere,
  removeFollower,
  saveKeys,
} from "./store.js";

/** The software name every instance reports; lowercase and hyphens, as NodeInfo asks. */
export const SOFTWARE_NAME = "spelling-creator";
export const SOFTWARE_REPOSITORY =
  "https://github.com/Spelling-Creator/spelling-creator";
// The app has no release numbers; what NodeInfo wants is a version, so it gets
// the one thing that is always true of this software.
export const SOFTWARE_VERSION = "0.0.0";

/** @type {import('@fedify/fedify').FederationBuilder<{ env: object }>} */
export const builder = createFederationBuilder();

const baseOf = (ctx) => supabaseBase(ctx.data.env);

// ---- Actors -----------------------------------------------------------------

builder
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    if (!ID_RE.test(identifier)) return null;
    const { env } = ctx.data;
    const user = await fetchPublicUser(env, baseOf(ctx), identifier);
    if (!user) return null;
    const keys = await ctx.getActorKeyPairs(identifier);
    return new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
      name: user.displayName,
      // The bio is stored already sanitized (see routes/profile.js), so it is
      // safe to hand on as HTML.
      summary: user.bio || undefined,
      url: new URL(
        `/users/${encodeURIComponent(identifier)}`,
        ctx.canonicalOrigin,
      ),
      inbox: ctx.getInboxUri(identifier),
      outbox: ctx.getOutboxUri(identifier),
      followers: ctx.getFollowersUri(identifier),
      endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
      manuallyApprovesFollowers: false,
      publicKey: keys[0]?.cryptographicKey,
      assertionMethods: keys.map((key) => key.multikey),
    });
  })
  .setKeyPairsDispatcher(async (ctx, identifier) => {
    if (!ID_RE.test(identifier)) return [];
    const { env } = ctx.data;
    const base = baseOf(ctx);
    let stored = await loadKeys(env, base, identifier);
    if (!stored) {
      // Keys are made the first time an actor is asked for, and only for an
      // account that exists: a request for a random uuid must not fill the
      // table with keys for nobody.
      if (!(await fetchPublicUser(env, base, identifier))) return [];
      const rsa = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
      const ed25519 = await generateCryptoKeyPair("Ed25519");
      stored = await saveKeys(env, base, identifier, {
        rsa: {
          privateKey: await exportJwk(rsa.privateKey),
          publicKey: await exportJwk(rsa.publicKey),
        },
        ed25519: {
          privateKey: await exportJwk(ed25519.privateKey),
          publicKey: await exportJwk(ed25519.publicKey),
        },
      });
      if (!stored) return [];
    }
    return [
      {
        privateKey: await importJwk(stored.rsa.privateKey, "private"),
        publicKey: await importJwk(stored.rsa.publicKey, "public"),
      },
      {
        privateKey: await importJwk(stored.ed25519.privateKey, "private"),
        publicKey: await importJwk(stored.ed25519.publicKey, "public"),
      },
    ];
  });

// ---- Collections ------------------------------------------------------------

const recipientOf = (row) => ({
  id: new URL(row.actor_id),
  inboxId: new URL(row.inbox),
  endpoints: row.shared_inbox
    ? { sharedInbox: new URL(row.shared_inbox) }
    : null,
});

builder
  .setFollowersDispatcher(
    "/users/{identifier}/followers",
    async (ctx, identifier, cursor) => {
      if (!ID_RE.test(identifier)) return null;
      const { env } = ctx.data;
      const base = baseOf(ctx);
      // No cursor is a delivery gathering its recipients (or a reader asking for
      // the whole collection): answer with everyone at once, since paging through
      // our own table to send one activity would be work for nothing.
      if (cursor == null)
        return {
          items: (await listFollowers(env, base, identifier)).map(recipientOf),
        };
      const offset = Math.max(0, Number.parseInt(cursor, 10) || 0);
      const rows = await listFollowers(env, base, identifier, {
        offset,
        limit: PAGE,
      });
      return {
        items: rows.map(recipientOf),
        nextCursor: rows.length === PAGE ? String(offset + PAGE) : null,
      };
    },
  )
  .setFirstCursor(() => "0")
  .setCounter((ctx, identifier) =>
    ID_RE.test(identifier)
      ? countFollowers(ctx.data.env, baseOf(ctx), identifier)
      : 0,
  );

builder
  .setOutboxDispatcher(
    "/users/{identifier}/outbox",
    async (ctx, identifier, cursor) => {
      if (!ID_RE.test(identifier)) return null;
      if (cursor == null) return null;
      const offset = Math.max(0, Number.parseInt(cursor, 10) || 0);
      const rows = await listPublishedLessons(
        ctx.data.env,
        baseOf(ctx),
        identifier,
        { offset, limit: PAGE },
      );
      return {
        items: rows.map((row) => lessonActivity(ctx, row, "create")),
        nextCursor: rows.length === PAGE ? String(offset + PAGE) : null,
      };
    },
  )
  .setFirstCursor(() => "0")
  .setCounter((ctx, identifier) =>
    ID_RE.test(identifier)
      ? countPublishedLessons(ctx.data.env, baseOf(ctx), identifier)
      : 0,
  );

// ---- Lessons ----------------------------------------------------------------

builder.setObjectDispatcher(Article, "/hub/{id}", async (ctx, { id }) => {
  if (!ID_RE.test(id)) return null;
  const row = await fetchPublishedLesson(ctx.data.env, baseOf(ctx), id);
  return row ? lessonArticle(ctx, row) : null;
});

// ---- Inbox ------------------------------------------------------------------

builder
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  .on(Follow, async (ctx, follow) => {
    if (follow.id == null || follow.objectId == null) return;
    const parsed = ctx.parseUri(follow.objectId);
    if (parsed?.type !== "actor" || !ID_RE.test(parsed.identifier)) return;
    const { env } = ctx.data;
    const base = baseOf(ctx);
    if (!(await fetchPublicUser(env, base, parsed.identifier))) return;
    // Fedify has verified the Follow was signed by its actor; this fetches
    // that actor's document, which is where its inbox is. Signed as the
    // followed author: a Follow that arrived at the shared inbox gets an
    // unsigned loader otherwise, and a server in authorized-fetch mode (secure
    // mode on Mastodon) refuses to hand its actor to an unsigned request.
    const documentLoader = await ctx.getDocumentLoader({
      identifier: parsed.identifier,
    });
    const follower = await follow.getActor({
      documentLoader,
      contextLoader: ctx.contextLoader,
    });
    if (follower?.id == null || follower.inboxId == null) return;
    // Recorded before the Accept is sent, and a failure here throws past it:
    // no record and no Accept is a state the follower's server retries out of,
    // where an Accept for a follow nobody kept would leave it thinking it
    // follows somebody who never hears from it.
    await addFollower(env, base, {
      userId: parsed.identifier,
      actorId: follower.id.href,
      inbox: follower.inboxId.href,
      sharedInbox: follower.endpoints?.sharedInbox?.href ?? null,
    });
    await ctx.sendActivity(
      { identifier: parsed.identifier },
      follower,
      new Accept({
        id: new URL(
          `#accept/${crypto.randomUUID()}`,
          ctx.getActorUri(parsed.identifier),
        ),
        actor: follow.objectId,
        object: follow.id,
      }),
    );
  })
  .on(Undo, async (ctx, undo) => {
    if (undo.actorId == null) return;
    const object = await undo.getObject(ctx);
    if (!(object instanceof Follow) || object.objectId == null) return;
    const parsed = ctx.parseUri(object.objectId);
    if (parsed?.type !== "actor" || !ID_RE.test(parsed.identifier)) return;
    // Only the follower's own signature got this far, so the actor on the Undo
    // is the one whose follow is removed, whatever the embedded Follow says.
    await removeFollower(
      ctx.data.env,
      baseOf(ctx),
      parsed.identifier,
      undo.actorId.href,
    );
  })
  .on(Delete, async (ctx, activity) => {
    // An account deleting itself: Delete whose object is its own actor. Any
    // other Delete (a remote post, say) is nothing we hold.
    if (activity.actorId == null || activity.objectId == null) return;
    if (activity.actorId.href !== activity.objectId.href) return;
    await removeActorEverywhere(
      ctx.data.env,
      baseOf(ctx),
      activity.actorId.href,
    );
  })
  .onError((ctx, error) => {
    console.error("federation inbox:", error);
  });

// ---- NodeInfo ---------------------------------------------------------------

builder.setNodeInfoDispatcher("/nodeinfo/2.1", async (ctx) => ({
  software: {
    name: SOFTWARE_NAME,
    version: SOFTWARE_VERSION,
    homepage: new URL(SOFTWARE_REPOSITORY),
    repository: new URL(SOFTWARE_REPOSITORY),
  },
  protocols: ["activitypub"],
  // Both counts are required by Fedify's NodeInfo validation, which answers 500
  // for a missing one rather than leaving the field out. User counts are not:
  // they are left out, since this API has no cheap way to count accounts.
  usage: {
    users: {},
    localPosts: await countPublishedLessons(ctx.data.env, baseOf(ctx), null),
    localComments: await countComments(ctx.data.env, baseOf(ctx)),
  },
}));
