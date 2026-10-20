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

## Forking a lesson from another instance

The attachments on an Article are what makes this possible: a lesson on any
federating instance can be forked here with the full history a local fork gets,
and the fork records where it came from.

The hub's **Copy a lesson from another instance** button takes the address of a
lesson page elsewhere and hands it to the editor (through
`REMOTE_FORK_REQUEST_KEY` in `sessionStorage`, the way a local fork request
travels). The button only appears once `GET /remote` has said this instance
can copy lessons, which it can when it federates. The editor cannot read the
other instance itself: that instance's API only answers cross-origin reads from
its own app, which is right. So this instance's API reads for it, on the
signed-in caller's behalf:

| Route                             | Does                                                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /remote`                     | Public. `{ available }`: whether this instance federates, and so whether it can copy lessons at all.                                    |
| `GET /remote/lesson?url=<page>`   | Finds the lesson through ActivityPub and answers `{ lesson: { url, origin, title, author, sectionCount, createdAt, doc, packUrl } }`.   |
| `GET /remote/pack?url=<pack url>` | Fetches the lesson's packed history and passes it through, tip and branch map in `X-Git-Head` and `X-Git-Refs` as from `/git/:id/pack`. |

The last two need a `Bearer` token and answer `501` on an instance that does not
federate. Both are shaped around the fact that the server is fetching an
address a visitor typed, and every fetch either makes goes through the same
guards (`lib/federation/remote.js`):

- **No private addresses.** An address written as a private IP is refused up
  front. On the Node host the connection itself is made by a fetch whose
  socket lookup refuses any name with a private address among its answers
  (`node/remoteFetch.js`), so a domain that answers a public address when
  checked and `127.0.0.1` when fetched (DNS rebinding) gains nothing: the
  check happens when the socket opens. A Worker cannot reach a private network
  at all. A test pair (`FEDERATION_ALLOW_PRIVATE_ADDRESSES`) switches this off.
- **Redirects one by one.** Up to three are followed by hand, each new address
  checked the same way; the pack proxy follows none.
- **Bounded reads.** Bodies are read chunk by chunk and dropped the moment they
  pass the cap (20 MB for a lesson, the pack limit for a history), whatever
  `Content-Length` says or leaves out, and every fetch has a deadline.
- **Fedify parses, it does not fetch.** The Article is loaded with those guards
  and handed to Fedify only to parse. Fedify's own `lookupObject` would fall
  back to a WebFinger request with its own fetch, outside them. The id
  of what comes back has to be on the origin that served it, as
  `lookupObject` requires.
- **One origin.** It has to be an `Article`, and its two links, and the page
  the fork will be credited to, all have to be on its own origin, so an
  Article cannot send the server elsewhere or have a fork claim another hub's
  lesson. An Article on this very hub is refused with a pointer to the
  lesson's own Fork action.
- **Checked headers.** The pack proxy passes a tip only when it is a commit id,
  and a branch map only when it reads cleanly and agrees with the tip, since
  both go on to the browser. The browser checks the tip again, and a clone that
  fails leaves no half-made repository behind.

With the document and the pack in hand the editor does what a local fork does
(`forkRemoteLessonRepo` in `core/browser/git/sync`): clones the pack into the
new lesson's repository, so the fork shares the original's commits and oids,
and records the origin, which the lesson page shows as "Forked from the
original on `<host>`". It is kept in `lessons.forked_from_url`, sent as
`forkedFromUrl` on `POST /lessons`, since nothing in this database can be a
foreign key to a row elsewhere; a lesson has one pointer home or the other,
never both.

Pictures are the one part that is copied rather than cloned. The document
refers to them by content hash, and the hashes belong to the other instance's
store. The browser fetches each one from there, a few at a time (an instance's
`/images/:hash` answers any origin, as this one's does), keeps it like a
picture the user added, and rewrites the reference to the hash of the bytes it
stored. Those are usually the compressed form the other instance serves, so the
hash changes and the fork's first commit touches that picture block, an honest
record of what happened to it; when the other instance kept the original, the
hash comes out the same and nothing changes. Either way the picture is now in
this browser's store, which is what lets the normal save-to-cloud upload it
here under a hash the server can verify.

Only a picture this hub's own upload would take is kept: an `image/` type,
under the 8 MB limit (`MAX_IMAGE_BYTES` in `core/image`, which the upload route
uses too). Anything else, such as an object served as
`application/octet-stream` or an error page, would be uploaded on every save
and refused every time, so it is treated as a picture that could not be copied:
it keeps its old reference, and the editor says how many could not be copied,
and also whether the history failed to come along. See `copyRemoteImages` in
`core/imagesClient`.

Storing a picture hashes it with `crypto.subtle`, which browsers only offer on a
secure origin: https, or `localhost`. An instance served over plain http at a
network address is neither, so no picture can be copied there, and none can be
added in its editor either. Two test instances reached over an SSH tunnel are
on `localhost` and work.

Not done yet: pulling the original's later changes into a remote fork. The
clone makes that merge possible (the shared ancestry is real), but the sync
action is keyed on a local `forkedFrom` id today and stays hidden for a remote
one.

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
be listed) over PostgREST. A listing matches whole key segments, as Fedify
expects (`publicKey` does not list `publicKeyX`), with a key encoding that keeps
a `_` or `%` in a key from widening it, and it reads in pages, since PostgREST
cuts a single response at its `max-rows` without saying so. See
`apps/api/src/platform/postgrestFedifyKv.js`.

**Without a queue** (`federationQueue` null), deliveries are made from the
request that caused them and are not retried. For an instance with a handful of
followers that is an honest trade against running a broker; for one with many,
it is not, and the seam is where a Redis-backed queue would go. On the hosted
instance the queue is a Cloudflare Queue bound in `wrangler.jsonc`, which the
first deploy creates: wrangler provisions a named queue that does not exist
yet, since its `experimental-provision` and `experimental-auto-create` flags
are on by default. The Worker's `queue()` export works through its batches
with `Federation.processQueuedTask`, acknowledging each message on success and
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
followers hold the old ids and the keys that went with them. And it has to be
https: an origin on plain http leaves federation off (the dependency check says
so), since those stored ids would point other servers at an address anyone on
the path can read and rewrite. The one exception is a test pair, below.

On the hosted instance it is a `vars` entry in `wrangler.jsonc`, and
`apps/api/scripts/dev.sh` overrides it with the local address so a development
Worker never claims to live on the real site. In the compose stack it is the
`FEDERATION_ORIGIN` line of `.env`, normally the same value as `PUBLIC_URL`, and
empty keeps federation off. See [Self-hosting](./self-hosting.md#federation).

`FEDERATION_ALLOW_PRIVATE_ADDRESSES=true` switches off Fedify's refusal to fetch
from or deliver to private network addresses, and lets the origin be plain
http. That refusal is what stops a remote actor document from pointing the
server at its own network, so the switch is for one thing only: two instances
on one machine or private network, in development. The development Worker under
portless has an https origin and federates; run with `PORTLESS=0`, its origin is
plain http and federation stays off.

## Trying it with two instances

Federation is server to server, so a test needs two instances that can each
reach the other's `FEDERATION_ORIGIN`, not only a browser that can reach both.
A development Worker on a laptop and a compose stack on another machine do not
qualify unless the laptop is reachable from that machine under the very name
its origin uses. Two compose stacks on one Docker host do, with the host's
address on its network as both origins, and a script sets that up. On the
Docker host, from a checkout with Git LFS:

```bash
./scripts/federation-pair.sh            # or --address <ip> if it can't guess
```

It builds the image from the checkout under its own tag (so neither stack pulls
the published one), writes `~/spelling-creator-federation/hub-a` and `hub-b`
with a `.env` each, starts both on ports 8080 and 8081, waits for them, and
checks that each app container can reach the other instance at its origin,
which a host firewall can quietly prevent. `--help` lists the options. Running
it again keeps each instance's credentials, which its database volume was
created with, and only rewrites the settings it owns.

What it sets in each `.env`, for doing the same by hand: its own
`COMPOSE_PROJECT_NAME` (so the two stacks share no containers or volumes), a
different `PUBLIC_PORT` and `PUBLIC_HTTPS_PORT`, `PUBLIC_URL` and
`FEDERATION_ORIGIN` both `http://<host address>:<port>`, `PUBLIC_HOSTNAME` the
address plus `localhost`, the same `IMAGE_TAG`, and
`FEDERATION_ALLOW_PRIVATE_ADDRESSES=true`.

Then, in a browser that can reach the host (over SSH, `ssh -L` for each port
works, since the pages only ever talk to their own origin): sign in on each,
publish a lesson on one, and on the other paste that lesson's page address into
**Copy a lesson from another instance** on the hub, using the host's address
rather than `localhost`, since the server is what fetches it. For the follow
side, `curl` one instance's WebFinger from the other host, or follow an author
from any fediverse account that can reach the address.

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
