---
title: Federation (ActivityPub)
---

# Federation (ActivityPub)

For what a person sees, read [Following from the fediverse](../guide/federation.md).

An instance of Spelling Creator can take part in the fediverse: every author is
an [ActivityPub](https://www.w3.org/TR/activitypub/) actor, every published
lesson is an Article, and somebody on Mastodon, or on another instance of this
app, can follow an author and see their lessons as they are published. The
protocol work is done by [Fedify](https://fedify.dev); this page is about how it
is wired in, what crosses the wire, and what deliberately does not.

Federation is **off until an instance opts in** by setting `FEDERATION_ORIGIN`
(see [Turning it on](#turning-it-on)). With it unset, nothing on this page runs
and nothing is written to the federation tables.

## What federates

| On this instance                                  | To the fediverse                                                |
| ------------------------------------------------- | --------------------------------------------------------------- |
| An author                                         | A `Person` actor at `/users/<id>`, handle `@<id>@<host>`        |
| A published lesson                                | An `Article` at `/hub/<id>`, by that actor, addressed to Public |
| Publishing a lesson                               | `Create(Article)` delivered to the author's followers           |
| Saving a published one                            | `Update(Article)`                                               |
| Deleting, unpublishing, or a moderator hiding one | `Delete`                                                        |
| A moderator showing it again                      | `Create(Article)` again                                         |

The actor's handle is the account id (`@6f1c2d3e-...@spellingcreator.org`)
rather than the display name, because a handle has to be unique and must never
change, and display names are neither: two people may both be "Miss Kelly", and
anyone can rename themselves. The display name is the actor's `name`, which is
what a fediverse client shows most prominently; the id only appears in the
small print. A chosen handle is a possible later addition and would need a new
uniqueness rule of its own.

An Article carries the title, a line saying who published it and how many
sections it has, the first few lines of the passage, and a link to the lesson
page. It does not carry the lesson: the lesson is read on its page, and copied
through two attachments another instance of this app understands, links to the
lesson's JSON document (`/lessons/<id>`) and its packed git history
(`/git/<id>/pack`). Those are the two things a fork needs, so an instance that
can read an Article can clone the lesson behind it with the full history a
local fork gets. See [Version history](./version-history.md).

A draft and a shadowbanned lesson do not exist to another server: the Article
dispatcher answers as if there were no such lesson, the outbox leaves them out,
and hiding a lesson sends a `Delete`. The rule is the same as
[`canReadLesson`](./web-app/hub-and-accounts.md) for the public, with no
exceptions for the author, since a remote server cannot be the author.

## What does not

This instance **accepts three things** from other servers: a `Follow` of one of
its actors (answered with an `Accept` and remembered), the `Undo` of that
follow, and a remote account's deletion (its follows are forgotten). Nothing a
remote user writes ever becomes content here. A reply from Mastodon to a lesson
is not a comment on it; a change offered from another instance is not a
proposal. Every piece of content on the hub goes through the same bans,
profanity check and moderation, and all of that is built on local accounts
(`auth.users`). Accepting remote content means giving remote users a place in
that model and giving moderators the tools to judge them, including blocking
whole servers, and for an audience of nonspeaking spellers and their families
that is not work to do by halves. It is the next step, not this one.

Likewise, nobody here follows anyone elsewhere, so there is no following
collection and no home timeline of remote posts; the following that exists is
the hub's own.

## How it is built

`apps/api/src/lib/federation/` holds all of it:

| File         | What it is                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `builder.js` | The Fedify `FederationBuilder`: actor, key and object dispatchers, the outbox and followers collections, the inbox listeners, NodeInfo. |
| `article.js` | A lesson row as an `Article`, and the `Create`, `Update` and `Delete` activities around it.                                             |
| `store.js`   | The PostgREST reads and writes: keys, followers, and the lesson queries the collections page through.                                   |
| `index.js`   | The switch (`FEDERATION_ORIGIN`), building the `Federation` once per `env`, and `announceLesson`, which the routes call.                |

It is a builder rather than a `Federation` because the stores Fedify needs are
the host's bindings, which only exist once a request is in hand. `federationFor(env)`
builds it on first use and memoizes it per `env`, the way the
[platform seam](./platform-seam.md) memoizes its adapters.

Fedify itself is loaded on first use (`import()` inside `index.js`) rather than
at the top of the module. The lesson routes import `index.js` for
`announceLesson`, and Fedify brings a large dependency tree with it that an
instance with federation off never needs.

### Requests

`@fedify/hono` provides a middleware, registered in `app.js` before every route.
Fedify owns `/.well-known/webfinger`, `/.well-known/nodeinfo`, `/nodeinfo/2.1`,
the inboxes, the collections, and, **for ActivityPub requests only**, the
actor at `/users/<id>` and the Article at `/hub/<id>`. Both of those are also
pages in the app; which one a request gets is decided by its `Accept` header,
and a browser asking for HTML is handed on to the next handler as if the
middleware were not there. With federation off the middleware is a pass-through.

### Deliveries

A route that changes a lesson's public state calls `announceLesson(env, ctx, row, kind)`
after the row is written. It builds the activity and asks Fedify to send it to
the author's followers, preferring each remote server's shared inbox so one
delivery serves every follower there, and excluding this instance's own inbox,
since local followers read the hub directly. It runs after the response, through
the execution context's `waitUntil`, and a failure is logged and never fails the
save.

Whether a failed delivery is retried depends on the host's queue (see
[Per host](#per-host)). Fedify remembers which signature spec each remote
server accepted (it tries RFC 9421 first and falls back to the older draft
signatures Mastodon still uses) so later deliveries do not pay for the discovery
again.

A remote inbox that answers 404 or 410 is gone for good, and the followers
behind it are forgotten (`setOutboxPermanentFailureHandler`), so no later
lesson is retried against it.

### Keys

Every actor signs its requests, and a remote server verifies them against the
public key in the actor document it fetched. So a key pair, once given out, has
to stay the same: a key that changed under a remote server would make every
later delivery fail verification there.

Keys are made the first time an actor is asked for, and only for an account
that exists, so a request for a random id cannot fill the table with keys for
nobody. Each actor gets an RSA pair (HTTP Signatures, which is what the
fediverse verifies today) and an Ed25519 pair (Object Integrity Proofs, which
is where it is heading), stored as JWKs in `federation_keys`. The insert is
`ON CONFLICT DO NOTHING` and re-reads the winner, so two first requests racing
for the same actor end up with one key pair, not two.

### Followers

A `Follow` arrives at the author's inbox, signed by the follower, which Fedify
verifies before the listener runs. The listener checks the followed actor is a
real account here, fetches the follower's actor document (through the
recipient's authenticated loader, so a server in authorized-fetch mode answers
it), records the follower's id, inbox and shared inbox in `federation_followers`,
and sends an `Accept`. Re-following is an upsert rather than a duplicate.

The followers collection is served to anyone, paged, as the protocol expects.
Asked for the whole collection at once, which is what Fedify does to gather a
delivery's recipients, it answers with every follower in one go rather than
paging through its own table.

## Per host

Fedify needs two stores from the host, and the [platform seam](./platform-seam.md)
provides both:

| Seam member       | Hosted instance (Cloudflare)                                                      | Self-hosted (Node)                                                                             |
| ----------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `federationKv`    | `WorkersKvStore` over the rate-limit KV namespace; every key starts `_fedify`     | `postgrestFedifyKv`, the same `kv_store` table the rate limiters use, under a `fedify/` prefix |
| `federationQueue` | `WorkersMessageQueue` over a Cloudflare Queue, when the binding exists, else none | `InProcessMessageQueue`: retried while the process lives, lost when it stops                   |

The key-value store holds Fedify's caches: remote actor documents and their
public keys, which activities have already been processed, and which signature
spec each remote server accepts. Nothing in it is authoritative, which is what
lets it share a table with the rate limiters. `postgrestFedifyKv` is Fedify's
own wider interface (keys are arrays of strings, values are JSON, prefixes can
be listed) over PostgREST, with a key encoding that keeps a `_` or `%` in a key
from widening a prefix listing: see `apps/api/src/platform/postgrestFedifyKv.js`.

**Without a queue** (`federationQueue` null), deliveries are made from the
request that caused them and are not retried. For an instance with a handful of
followers that is an honest trade against running a broker; for one with many,
it is not, and the seam is where a Redis-backed queue would go. On the hosted
instance the queue is a Cloudflare Queue, created once and bound in
`wrangler.jsonc`; the Worker's `queue()` export works through its batches with
`Federation.processQueuedTask`, acknowledging each message on success and
retrying it alone on failure.

The dependency check (`docker compose logs app`, or `GET /_diagnostics`)
reports federation on its own line: off, on at which origin, and whether
deliveries will be retried.

## Turning it on

Set `FEDERATION_ORIGIN` to the origin other servers reach the instance at,
scheme included: `https://spelling.example.org`. It is written into every actor
and object id, which is why it is explicit rather than read off the request: an
id built from a `Host` header a client chose is an id another server will store.
For the same reason it must not change once anyone follows someone here;
followers hold the old ids and the keys that went with them.

On the hosted instance it is a `vars` entry in `wrangler.jsonc`, and
`apps/api/scripts/dev.sh` overrides it with the local address so a development
Worker never claims to live on the real site. In the compose stack it is the
`FEDERATION_ORIGIN` line of `.env`, normally the same value as `PUBLIC_URL`, and
empty keeps federation off. See [Self-hosting](./self-hosting.md#federation).

`FEDERATION_ALLOW_PRIVATE_ADDRESSES=true` switches off Fedify's refusal to fetch
from or deliver to private network addresses. That refusal is what stops a
remote actor document from pointing the server at its own network, so the
switch is for one thing only: two instances on one machine, in development.

## Schema

`apps/api/schema.sql` adds two tables, both with row level security on and no
policies, since one of them holds private keys:

```sql
create table public.federation_keys (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  rsa        jsonb not null,             -- { privateKey, publicKey } as JWKs
  ed25519    jsonb not null,
  created_at timestamptz not null default now()
);

create table public.federation_followers (
  user_id      uuid not null references auth.users (id) on delete cascade,
  actor_id     text not null,            -- the follower's actor URI
  inbox        text not null,
  shared_inbox text,
  created_at   timestamptz not null default now(),
  primary key (user_id, actor_id)
);
```

Creating them on an instance that never federates is harmless; nothing writes
to them until `FEDERATION_ORIGIN` is set.

## Testing it

`apps/api/src/lib/federation/federation.test.js` drives the real builder over an
in-memory key-value store and a fake of the slice of PostgREST and GoTrue the
dispatchers read, as another server would: WebFinger, the actor document, the
Article, the collections, a draft from outside, and a lesson publication
delivered as a signed request to a follower's shared inbox. It runs in the Node
project only; Fedify's OpenTelemetry dependency imports `node:process` when it
loads, which the Workers test runner cannot resolve, where the real Worker
bundle can (`pnpm --filter @spelling-creator/api bundle` checks that).
