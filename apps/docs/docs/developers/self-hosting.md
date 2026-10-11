---
title: Self-hosting
---

# Self-hosting

Spelling Creator's own instance runs on Cloudflare, and will keep doing so. But
nothing about the app requires it: the same API runs as a plain Node process
against Postgres and any S3-compatible object store, which is what this page is
about.

```bash
node apps/api/src/node/server.js
# or: pnpm --filter @spelling-creator/api start:node
```

That serves the whole route table from `apps/api/src/app.js` (the lesson hub,
images, git history, proposals, moderation, notifications, profiles, feeds, the
AI features), the built SPA and docs from disk, and server-rendered HTML for the
public read routes. The [platform seam](./platform-seam.md) explains how the same
route code runs on both hosts.

## With Docker

The repository ships a `Dockerfile` and an example `docker-compose.yml` that
stands the whole thing up: Postgres, PostgREST, GoTrue, RustFS and a Caddy
gateway around the app.

The object store is RustFS rather than MinIO, whose community edition is no
longer somewhere to point self-hosters. Nothing in the app knows which it is
(it speaks plain S3), so Garage, SeaweedFS, Ceph RGW or real S3 are a change of
image and endpoint and nothing else. The service is named `storage` for its role
rather than its implementation to keep that swap a one-line edit.

```bash
./scripts/generate-env.sh   # writes .env with every credential filled in
# then set PUBLIC_URL / PUBLIC_HOSTNAME in .env
docker compose up -d --build
```

The generator refuses to overwrite an existing `.env`; `--force` mints new
credentials into one anyway, and `--print` writes nothing and prints a fresh set.
It is POSIX `sh` and `openssl`, so it needs nothing installed; asking someone
whose only requirement is Docker to add a Node toolchain to produce a config file
would be a silly thing to ask. If `openssl` somehow isn't there, any container
has it:

```bash
docker run --rm -v "$PWD:/w" -w /w --entrypoint sh alpine/openssl:latest scripts/generate-env.sh
```

`--entrypoint sh` is not optional: that image's entrypoint is `openssl` itself,
so without it Docker runs `openssl sh scripts/generate-env.sh` and the script
never executes.

Use the generator rather than copying `.env.example` by hand. `ANON_KEY` and
`SERVICE_ROLE_KEY` are JWTs that must be signed with the same `JWT_SECRET`
PostgREST and GoTrue verify against, and a value that is not a valid token fails
in a way that points everywhere except at itself: PostgREST reports a signing
error, GoTrue reports a permissions error, and the app answers 502. The
dependency check below catches it directly (its `credentials` line), but not
generating a broken one is better still.

`PUBLIC_URL` is baked into the SPA at build time, so set it before the build, not
after.

That is the whole of it: there is no schema step to remember, because the
ordering it depends on is not something to leave to a reader. A one-shot
`schema` service waits for GoTrue to create `auth.users` on its first migration,
then applies `apps/api/schema.sql` with `ON_ERROR_STOP`, grants the new tables to
`service_role`, and the app waits for it to finish. A second one-shot service,
`storage-init`, creates the two buckets (`lesson-images` and `lesson-git`) the
same way.

Both halves of the schema step matter. Every hub table references `auth.users`,
so applying the schema before auth has migrated fails _every_ statement, and
`psql` walks past errors and exits 0, so the failure is silent. What you get is
an empty database, PostgREST reporting `0 Relations`, and the app answering 502.

The related trap is PostgREST's schema cache, which it builds once at startup: a
table created afterwards is invisible to it. The stack installs the same
`pgrst_watch` event trigger Supabase ships, so any DDL tells PostgREST to
re-read. If you ever suspect it has gone stale anyway,
`docker compose restart postgrest` settles it.

Filling in `.env` is not optional. Every credential is declared as a required
variable, so `docker compose up` without a filled-in `.env` stops and names what
is missing rather than standing the stack up with blank passwords. The SMTP
settings are the exception and default to empty, because the default
`AUTH_MODE=password` needs no mail at all; see [Sign-in](#sign-in) for what is
missing without them.

Two things about it are worth understanding before adapting it.

**One origin serves both `/rest/v1/*` and `/auth/v1/*`.** That is how Supabase
presents PostgREST and GoTrue, and this API was written against it. Nothing in
the compose file is Supabase: the `gateway` service is an ordinary reverse proxy
joining the two upstream projects under one origin, doing the job Kong does on
Supabase's own hosting. It is also the proxy that should sit in front of the app
anyway.

**The `VITE_*` values are build arguments, not runtime environment.** Vite
substitutes them into the SPA bundle at build time, so they are baked into the
image: an instance pointed at a different public URL needs `docker compose
build`, not just a restart. That is a property of shipping a static SPA rather
than a choice made here.

The compose file terminates no TLS and takes its credentials from `.env` with
example values, both deliberately. It is a starting point, not a deployment; a
compose file that pretended otherwise would be worse than one that is obviously
an example.

## When something doesn't work

Start here, before reading any of the rest of this page:

```bash
docker compose logs app
```

The server asks every dependency whether it is actually working, once it has
started listening, and prints the answer:

```text
Dependency check:
  [ok  ] configuration: database and identity credentials are set
  [ok  ] cross-origin: requests are accepted from spelling.example.com
  [ok  ] credentials: the service-role key is a JWT whose role claim is service_role
  [ok  ] database: PostgREST answered (HTTP 200)
  [FAIL] schema: PostgREST cannot see public.lessons (HTTP 404 PGRST205: Could
         not find the table 'public.lessons' in the schema cache)
         Either apps/api/schema.sql was never applied, or PostgREST has a stale
         cache. Check the tables exist, then restart PostgREST if they do.
  [ok  ] identity: the auth service is healthy
  [ok  ] identity-admin: the admin API accepts the service-role key
  [ok  ] images: the bucket exists and is readable
  [FAIL] lesson-history: the bucket does not exist (NoSuchBucket ...)
         Create it, or point the bucket variable at one that exists.
  [ok  ] key-value: a value round-tripped
  Something above is broken; the app will not work correctly until it is fixed.
```

Each check is written to distinguish causes rather than to confirm health, because
the causes are what look alike from outside. Reaching PostgREST is not the same
as PostgREST being able to see the tables. Reaching the auth service is not the
same as being allowed to call its admin API; that one looks like a working
instance right up until somebody opens a profile. A bucket that answers is not
the same as a bucket that exists. A check whose service isn't configured at all
is shown as `--` (skipped) rather than as a failure.

Results carry the upstream's own error code, not a paraphrase, because
`PGRST205` and `NoSuchBucket` are the strings worth searching for. The checks
live in `apps/api/src/lib/diagnostics.js`.

To ask again without restarting, set `ADMIN_TOKEN` in `.env` (the compose file
passes it to the app as `ADMIN_MIGRATE_TOKEN`) and send it as a header:

```bash
curl -H "X-Admin-Token: $ADMIN_TOKEN" "http://localhost:8080/_diagnostics?format=text"
```

Without `?format=text` the same report comes back as JSON. The answer is a 200
whether or not a check failed (the body is the answer), and a 503 if no token is
configured at all.

`GET /_health` is separate, public and cheap: it answers whether the process is
up and routing, and deliberately checks nothing else. A health check that fails
when a dependency hiccups makes an orchestrator restart a process that was fine.
The Docker image's own `HEALTHCHECK` follows the same rule by fetching
`/robots.txt`, which needs neither the database nor object storage.

## What you need

| Piece          | Hosted instance                    | Self-hosted                                   |
| -------------- | ---------------------------------- | --------------------------------------------- |
| Runtime        | Cloudflare Workers                 | Node 20 or newer (the image uses Node 24)     |
| Database       | Supabase Postgres                  | Postgres + [PostgREST](https://postgrest.org) |
| Identity       | Supabase Auth                      | [GoTrue](https://github.com/supabase/auth)    |
| Object storage | R2                                 | RustFS, Garage, Ceph RGW, SeaweedFS, B2, S3   |
| Expiring KV    | Workers KV                         | a table in the same Postgres                  |
| Response cache | `caches.default`                   | your reverse proxy                            |
| AI             | Gemini, OpenAI, etc. or Workers AI | the same, or a local Ollama / vLLM            |

Node 20 is past end of life, so prefer 22 or newer when running outside Docker.

The database layer is the part that is already vendor-neutral and always was:
this API talks to Postgres over PostgREST and to identity over GoTrue, both
ordinary HTTP APIs with open-source servers. There are no stored procedures and
no `supabase-js` on the server, so running the two upstream projects yourself
needs no code change, only different URLs. Self-hosted Supabase works equally
well and bundles both.

## What you don't get

Three features need Cloudflare specifically, and are simply not registered on
this host rather than stubbed; a stub would be a promise the process can't keep.

- **Live collaboration.** A Durable Object per session, which is the part that
  gives one authoritative room per share code globally. Everything else about the
  editor works; `/collab` is not registered here, so it reaches the frontend
  fall-through and answers 404.
- **The remote MCP endpoint.** Also a Durable Object, plus a KV-backed OAuth 2.1
  server. The MCP server itself is unaffected and still runs
  [over stdio](./mcp-server/setup.md), which is how most people use it anyway.
- **Crawler prerendering and og-image screenshots.** Both need Browser Rendering.
  This matters less than it sounds: [server rendering](./web-app/server-rendering.md)
  already covers `/hub`, `/hub/:id` (and its tabs) and `/users/:id` with real
  React for every visitor, and it runs here unchanged. What is lost is a
  headless-Chromium snapshot of `/` for crawlers, and link-preview images.

## Configuration

Everything is environment variables. `apps/api/src/node/platform.js` reads the
storage ones; the rest are read by the routes as they would be on the Worker.

### Database and identity

| Variable                    | Meaning                                                          |
| --------------------------- | ---------------------------------------------------------------- |
| `SUPABASE_URL`              | Base URL serving `/rest/v1` (PostgREST) and `/auth/v1` (GoTrue). |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses RLS. Server-only; never ship it to a browser.           |
| `SUPABASE_ANON_KEY`         | The publishable key the SPA uses for sign-in.                    |

The names are historical: they are the two upstream projects, whoever runs them.
Apply [`apps/api/schema.sql`](https://github.com/Spelling-Creator/spelling-creator/blob/main/apps/api/schema.sql)
once (the compose stack does it for you); it creates the hub tables and the
`kv_store` table this host needs. It does not create the `anon`,
`authenticated` and `service_role` roles PostgREST switches between, which
Supabase already has; the compose file's `roles-sql` config shows what a plain
Postgres needs.

### Object storage

| Variable               | Required | Meaning                                                 |
| ---------------------- | -------- | ------------------------------------------------------- |
| `S3_ENDPOINT`          | yes      | e.g. `http://storage:9000`                              |
| `S3_ACCESS_KEY_ID`     | yes      |                                                         |
| `S3_SECRET_ACCESS_KEY` | yes      |                                                         |
| `S3_BUCKET_IMAGES`     | yes      | Lesson images, keyed by content hash.                   |
| `S3_BUCKET_GIT`        | yes      | Lesson history packfiles.                               |
| `S3_REGION`            | no       | Defaults to `us-east-1`, which MinIO and Garage expect. |
| `S3_FORCE_PATH_STYLE`  | no       | Defaults to path style. `false` for AWS virtual hosts.  |
| `S3_SESSION_TOKEN`     | no       | For temporary credentials.                              |

Two buckets rather than prefixes in one, matching how the Cloudflare deployment
is arranged, so moving between hosts is a copy rather than a rename. Without
object storage the instance still starts: it serves the hub and refuses image
uploads with a clear error.

`S3_REGION` has to match what the store signs against, because SigV4 includes
the region and a mismatch is a 403 that looks like bad credentials. In the
compose stack the app and `storage-init` read it from the same variable.

### The server itself

| Variable              | Default                 | Meaning                                                         |
| --------------------- | ----------------------- | --------------------------------------------------------------- |
| `PORT`                | `8787`                  |                                                                 |
| `HOST`                | `0.0.0.0`               |                                                                 |
| `WEB_DIST`            | `apps/web/dist`         | The built SPA, with the docs site inside it.                    |
| `ALLOWED_HOSTNAMES`   | (none)                  | Comma-separated hostnames allowed to call the API cross-origin. |
| `CLIENT_IP_HEADER`    | `x-forwarded-for`       |                                                                 |
| `TRUSTED_PROXY_COUNT` | `1`                     | How many proxies sit in front of this process.                  |
| `AUTH_MODE`           | `magic-link`            | Must match the SPA's `VITE_AUTH_MODE`; see [Sign-in](#sign-in). |
| `USERNAME_DOMAIN`     | `users.noreply.invalid` | Must match the SPA's `VITE_USERNAME_DOMAIN`.                    |
| `ADMIN_MIGRATE_TOKEN` | (none)                  | Gates `/_diagnostics` and the one-time admin backfills.         |

`ALLOWED_HOSTNAMES` can stay unset when the SPA and the API share an origin, as
they do in the compose stack, but the AI features need it either way (see
[AI](#ai)).

`TRUSTED_PROXY_COUNT` is worth getting right. `x-forwarded-for` is a list that
each hop appends to, and the _client_ controls what is at the front, so the
trustworthy entry is the one your nearest proxy added, counted from the right.
The IP is what bans and rate limits are keyed on, so reading the leftmost entry
(the usual mistake) would let any caller forge both. With one reverse proxy the
default is correct; behind a CDN _and_ a proxy, set it to 2.

Set it to `0` if this process is exposed directly, with nothing in front of it.
Then no hop wrote the header, so nothing in it is believed and requests are
treated as having no IP: IP bans stop matching, and the AI rate limiter keys
everyone to one shared bucket. That is worse than having a proxy, and much
better than the alternative: a directly-exposed process that trusts the header
lets a banned visitor choose the address their ban is keyed on.

A `CLIENT_IP_HEADER` other than `x-forwarded-for` (nginx's `x-real-ip`, say) is
taken as a single value, and `TRUSTED_PROXY_COUNT` doesn't apply to it.

### Sign-in

The hosted instance signs people in with a magic link, which is the nicer
experience and needs a mail server. A self-hosted one frequently has no SMTP at
all, which would otherwise leave it with no way for anyone to sign in, so the
instance chooses:

| `AUTH_MODE`  | What the login page offers | Needs mail |
| ------------ | -------------------------- | ---------- |
| `password`   | Username and password      | no         |
| `magic-link` | A one-time emailed link    | yes        |
| `both`       | Both; sign in with either  | yes        |

Anything else reads as `magic-link`, so a typo falls back to the default rather
than to an instance nobody can get into.

Passwords are **username**-based, not email-based: asking somebody for an
address you will never send anything to is asking for a detail nobody needs.
With `both`, the sign-in field takes a username _or_ an email address, decided by
whether the value contains an `@` rather than by a toggle to find.

Under the hood a username is given to the identity service as an address under
`USERNAME_DOMAIN`: it authenticates by address and has no notion of a username.
The default domain (`users.noreply.invalid`) uses a top-level domain reserved by
RFC 2606, so it can never resolve, and nothing is ever sent there. If you change
it, set it in **both** places: the SPA bakes it in at build time as
`VITE_USERNAME_DOMAIN`, and the server reads it at runtime to resolve the
username an admin types into `POST /mod/password`. The two disagreeing is a
password reset that answers "no account with that username". Two things follow
for free: usernames are unique, because the service will not register the same
address twice; and signing in needs no lookup, so no public endpoint has to
answer "which email belongs to this username?".

A username is **not** a display name. Display names are moderated for profanity
and banned names, may contain spaces, and are deliberately not unique: two
people may both be "Alex Morgan". A username is unique, never shown to anybody
else, and exists only to sign in with. Registration deliberately does not set a
display name from it, which would route around those checks.

With `magic-link` or `both`, the sign-in email carries a one-time code as well
as the link. The installed app needs the code, because an emailed link opens
in the browser instead (see [Hub and accounts](./web-app/hub-and-accounts.md)).
Nothing needs setting up for that here: the GoTrue version the compose file pins
(`supabase/gotrue:v2.177.0`) has the code in its built-in magic link and signup
confirmation emails ("Alternatively, enter the code: ...").

**Check this before upgrading GoTrue.** Newer releases rewrote those built-in
emails without the code. If the new version's don't have it, point
`GOTRUE_MAILER_TEMPLATES_MAGIC_LINK` and `GOTRUE_MAILER_TEMPLATES_CONFIRMATION`
at your own templates that include <code v-pre>{{ .Token }}</code>. GoTrue takes
each one as a URL and fetches it, so the file has to be served from somewhere
the `auth` container can reach.

The compose file defaults to `password`, because an instance reaching for it is
more likely to have no mail server than to have one. It passes the same
`AUTH_MODE` and `USERNAME_DOMAIN` to the SPA build and to the server, so the two
cannot disagree. `AUTH_MODE` is baked into the SPA at build time, so changing it
means a rebuild.

Two things follow from running without mail, and both are worth deciding
deliberately rather than discovering:

- **New accounts are auto-confirmed** (`AUTH_AUTOCONFIRM`, on by default),
  because a confirmation nobody can receive would make registration a dead end.
  That means anyone can register with an address they don't own. An instance
  open to the internet with no SMTP should also set `GOTRUE_DISABLE_SIGNUP=true`
  and create accounts by hand.
- **There is no self-service password reset.** Resetting one the ordinary way
  means emailing a link. Instead, an admin sets the password from the
  **moderation page** (`POST /mod/password`, taking a username or an email; see
  [Moderation](./web-app/moderation.md)). Admin-only, never moderator: setting
  somebody's password is taking their account, which is a different kind of
  power from hiding a lesson. An admin may reset their own and anybody below
  them, but not another admin's: admins are peers, and taking a peer's account
  is an escalation the tier was never meant to allow.

  Two things follow. The last admin locking themselves out is a database problem,
  not an in-app one. And the reset changes the password without necessarily
  ending sessions already open elsewhere, so treat it as recovery from
  forgetfulness rather than as containment of a compromised account.

With SMTP configured, set `AUTH_AUTOCONFIRM=false` so addresses get verified
properly.

Passwords must be at least 8 characters. The login form and `POST /mod/password`
check that, and `GOTRUE_PASSWORD_MIN_LENGTH` enforces it, so all three agree.

### AI

Any of the hosted providers, or a local model through
[`openai-compatible`](./getting-started.md#ai-providers): Ollama, llama.cpp,
vLLM, LM Studio. The compose file has a commented-out `ollama` service and the
three variables to go with it. An instance with no AI configured serves
everything else; the suggestion buttons report that they are unavailable.

Every AI request (suggestions, fact checks, AI fixes, and Pixabay image search,
which goes through the same endpoint) is checked with
[Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/)
before anything else happens. Turnstile is a free service and works on any host,
but the instance needs a widget of its own:

- `VITE_TURNSTILE_SITE_KEY` at build time, so the SPA shows the challenge.
  Without it, the AI and image-search dialogs say they are unavailable.
- `TURNSTILE_SECRET_KEY` at runtime, so the server can verify it.
- `ALLOWED_HOSTNAMES` set to the hostname the app is served from, which the
  server compares with the hostname Turnstile reports.

The compose file sets none of these, so add them to use the AI features there.
Pixabay search also needs `PIXABAY_API_KEY`. Wikimedia Commons search needs
nothing, since the browser talks to Wikimedia directly.

## Notes on running it

**Put a reverse proxy in front.** The process serves static files itself so that
it _can_ run alone, but Caddy or nginx will do it better: ranges, compression,
and a real response cache, which is the one platform service this host
deliberately implements as a no-op. Terminate TLS there too.

If you do let the proxy serve `apps/web/dist`, send everything it has no file
for to the app rather than reaching for the usual SPA rule
(`try_files $uri /index.html`). The app knows its own route table and answers a
path that isn't a route with a real `404`; a blanket `index.html` fallback in
front of it puts that back to a `200`, which is a soft 404 on every dead link and
every probe for a well-known URI. See
[Pages and routing](./web-app/pages-and-routing.md) for how the app decides.

**It is stateless.** Run as many processes as you like behind the proxy; nothing
is held in memory between requests. The process shuts down cleanly on `SIGTERM`.

**Expired `kv_store` rows** are treated as absent on read and swept as they are
passed, so nothing depends on housekeeping. `schema.sql` has a `pg_cron` snippet
to reclaim the rows nobody asks for again.

**Migrating from Cloudflare** is a bucket copy and a database dump: the object
keys and the schema are identical, which is deliberate.
