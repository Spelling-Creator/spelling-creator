---
title: Self-hosting
description: "Running your own instance on Node with Docker Compose: Postgres, PostgREST, GoTrue, S3 storage, HTTPS, sign-in modes, AI checks, and federation."
---

# Self-hosting

Spelling Creator's own instance runs on Cloudflare, and will keep doing so. But
nothing about the app requires it: the same API runs as a plain Node process
against Postgres and any S3-compatible object store, which is what this page is
about.

```bash
pnpm build:docs     # build the SPA, its server-rendering bundle and the docs
node apps/api/src/node/server.js
# or: pnpm --filter @spelling-creator/api start:node
```

That serves the whole route table from `apps/api/src/app.js` (the lesson hub,
images, git history, proposals, moderation, notifications, profiles, feeds, the
AI features), the built SPA and docs from disk, and server-rendered HTML for the
public read routes. The [platform seam](./platform-seam.md) explains how the same
route code runs on both hosts.

## With Docker

The app is published as a multi-platform image (amd64 and arm64) at
`ghcr.io/spelling-creator/spelling-creator`, built from the repository's
`Dockerfile` on every change to `main`. The example `docker-compose.yml` runs it
with everything it needs around it: Postgres, PostgREST, GoTrue, RustFS and a
Caddy gateway.

The object store is RustFS rather than MinIO, whose community edition is no
longer somewhere to point self-hosters. Nothing in the app knows which it is
(it speaks plain S3), so Garage, SeaweedFS, Ceph RGW or real S3 are a change of
image and endpoint and nothing else. The service is named `storage` for its role
rather than its implementation to keep that swap a one-line edit.

You need Docker and nothing else: no clone, no Node, no Git LFS. In an empty
directory:

```bash
curl -fsSLO https://raw.githubusercontent.com/Spelling-Creator/spelling-creator/main/docker-compose.yml
docker run --rm -v "$PWD:/w" -w /w -u "$(id -u):$(id -g)" \
  ghcr.io/spelling-creator/spelling-creator generate-env
# then set PUBLIC_URL / PUBLIC_HOSTNAME in .env
docker compose up -d
```

`generate-env` writes `.env` into the mounted directory with every credential
filled in, and says what is left to set by hand. Running it as yourself (`-u`)
makes the file yours rather than the image's user's. It never overwrites an
existing `.env`, writes through a temporary file so an interrupted run leaves
nothing half-written, and creates the file readable only by its owner, since it
holds the service-role key. That is also why it writes the file itself rather
than printing it into `> .env`, which would empty an existing file before
anything ran and create a new one with whatever permissions the shell's umask
allows. (`generate-env --print` prints a fresh set instead, with nothing
mounted.)

The compose file pulls the same image to run the app and to apply the database
schema, so those two can never be out of step.

That pulls the published image, and only that: a tag that can't be pulled
stops with an error rather than being built from whatever is on disk. `latest`
follows `main`. To stay on one build until you choose to move, set `IMAGE_TAG`
in `.env` to one of the `sha-<commit>` tags on the package page, and take the
compose file from the same commit (replace `main` in the URL above with the
commit), since a new version may also change the services around the app.
Upgrading is then a matter of changing both and running
`docker compose pull && docker compose up -d`.

The image is public, so pulling it needs no login. If a pull is refused with
"denied" or "unauthorized", the package's visibility has been changed on
GitHub, which is something for the repository's maintainers to put back.

### From a checkout

The same steps work from a clone of the repository, where the generator can
also write `.env` directly:

```bash
./scripts/generate-env.sh   # writes .env, refusing to overwrite one
docker compose up -d        # pulls the published image
```

`--force` mints new credentials into an existing `.env`, keeping everything else
in it, and `--print` writes nothing and prints a fresh set (that is what the
image's `generate-env` runs). The script is POSIX `sh` and `openssl`, so it
needs nothing installed; if `openssl` somehow isn't there, use the image's copy
as above.

To run your own changes instead, add `compose.build.yml`, which builds the
checkout and tags it with the published image's name, so the `app` and `schema`
services both run it:

```bash
docker compose -f docker-compose.yml -f compose.build.yml up -d --build
```

It is a separate file, used only when named, so that `docker-compose.yml` alone
never quietly builds a checkout in place of a pinned image. To use it for every
command in the directory, set `COMPOSE_FILE=docker-compose.yml:compose.build.yml`
in `.env`. Building needs Git LFS, because the images and videos the app ships
are stored there, and the build stops with the fix if it finds pointer files
where they should be.

### What the stack does for you

Use the generator rather than copying `.env.example` by hand. `ANON_KEY` and
`SERVICE_ROLE_KEY` are JWTs that must be signed with the same `JWT_SECRET`
PostgREST and GoTrue verify against, and a value that is not a valid token fails
in a way that points everywhere except at itself: PostgREST reports a signing
error, GoTrue reports a permissions error, and the app answers 502. The
dependency check below catches it directly (its `credentials` line), but not
generating a broken one is better still.

That is the whole of it: there is no schema step to remember, because the
ordering it depends on is not something to leave to a reader. A one-shot
`schema` service runs `apps/api/scripts/apply-schema.sh` from the app image: it
waits for GoTrue to create `auth.users` on its first migration (up to five
minutes, since that first migration can be slow on a small machine), then
applies `apps/api/schema.sql` with `ON_ERROR_STOP`, grants the new tables to
`service_role`, and the app waits for it to finish. A password the database
refuses stops it at once with Postgres's own message, since waiting would not
fix it, and the schema is applied under an advisory lock, so two runs against
one database take turns rather than colliding. It runs on every
`docker compose up`, and every statement in the schema is safe to re-run, so
this is also how an upgrade brings in new tables and columns. A second one-shot
service, `storage-init`, creates the two buckets (`lesson-images` and
`lesson-git`) the same way.

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

**Nothing about an instance is baked into the image.** See
[How the browser gets its settings](#how-the-browser-gets-its-settings): every
setting, the SPA's included, is environment, so changing one is
`docker compose up -d` and never a rebuild.

### HTTPS

The gateway is [Caddy](https://caddyserver.com), which gets and renews
certificates by itself. Turning it on is a matter of giving the instance its
real address in `.env`:

```bash
PUBLIC_URL=https://spelling.example.org
PUBLIC_HOSTNAME=spelling.example.org
PUBLIC_PORT=80
PUBLIC_HTTPS_PORT=443
```

then `docker compose up -d`. When `PUBLIC_URL` starts with `https://`, the
gateway serves its hostname over HTTPS with a certificate from Let's Encrypt,
and redirects plain http to it. With an `http://` address (the default, for
trying it out on `localhost`) it serves plain http and needs nothing.

Let's Encrypt checks that the domain is yours by connecting to it, so two things
have to be true first: the domain's DNS points at this machine, and ports 80
and 443 reach it from the internet. Certificates are kept on the `caddy-data`
volume, so restarts reuse them rather than asking for new ones, which would hit
Let's Encrypt's rate limits within a day. `docker compose logs gateway` shows
what it is doing.

If something in front of the gateway already terminates TLS (a tunnel, a CDN,
another reverse proxy), set `SITE_ADDRESS=:80` so the gateway serves plain http
behind it instead of trying for a certificate of its own, and
`TRUSTED_PROXY_COUNT=2` to count the extra hop.

The gateway has to trust that hop too. Caddy only passes on the
`X-Forwarded-For` and `X-Forwarded-Proto` it receives from a proxy it trusts,
and replaces them otherwise, which would leave the app seeing the tunnel's
address for every visitor (one shared rate limit, and bans that hit everyone)
and http for every page. So with a count above 1 the gateway trusts private
addresses, which covers a tunnel such as cloudflared running on the same machine
or network. A CDN reaching the gateway over the internet comes from public
addresses instead: list its published ranges in `GATEWAY_TRUSTED_PROXIES`,
separated by spaces. `docker compose logs gateway` says what it trusts.

The app learns that a request arrived over https from the `X-Forwarded-Proto`
header the gateway sends (see [`TRUSTED_PROXY_COUNT`](#the-server-itself)),
which is what keeps the links it builds, in the sitemap, the feed and
server-rendered pages, on `https://`.

What the stack does not do for you is back up the `postgres-data` and
`storage-data` volumes, which hold every account, lesson and image.

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

Four features need Cloudflare specifically, and are simply not registered on
this host rather than stubbed; a stub would be a promise the process can't keep.

- **Live collaboration.** A Durable Object per session, which is the part that
  gives one authoritative room per share code globally. Everything else about the
  editor works; `/collab` is not registered here, so it reaches the frontend
  fall-through and answers 404.
- **Letterboard sessions.** Also a Durable Object per session code (see
  [Letterboard sync](./web-app/letterboard-sync.md)). Interactive mode works as
  it does anywhere, without the tablet button in its top bar: the page asks
  `GET /practice` first, which answers 404 here, so it never offers a session
  that can't start. The letterboard app's read-only lesson browsing, which only
  needs `GET /lessons`, is unaffected.
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
once (the compose stack does it for you); it creates the hub tables, the
`kv_store` table this host needs, and the two federation tables. It does not create the `anon`,
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
| `AUTH_MODE`           | `magic-link`            | How people sign in; see [Sign-in](#sign-in).                    |
| `USERNAME_DOMAIN`     | `users.noreply.invalid` | The domain usernames become addresses under.                    |
| `ADMIN_MIGRATE_TOKEN` | (none)                  | Gates `/_diagnostics` and the one-time admin backfills.         |
| `FEDERATION_ORIGIN`   | (none)                  | Joins the fediverse; see [Federation](#federation).             |

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

The same count decides whether `x-forwarded-proto` is believed. The process
reads the scheme of each request from its own socket, which behind a proxy that
terminates TLS is always plain http, so it takes the scheme the proxy reports
instead, and builds its absolute URLs (the sitemap, the feed, `robots.txt`, the
canonical and `og:` links in server-rendered pages) from that. With
`TRUSTED_PROXY_COUNT=0` the header is ignored, for the same reason as above.
Caddy sends it by default; with nginx, add
`proxy_set_header X-Forwarded-Proto $scheme;`.

### How the browser gets its settings

The SPA needs a few settings of its own: where to sign in, which sign-in modes
to offer, the Turnstile and Google client ids. On the hosted instance these are
`VITE_*` values Vite substitutes into the bundle at build time. Here they come
from the server's environment instead: as it serves `index.html`, the server
writes them into the page, and `apps/web/src/main.jsx` prefers them to anything
the build baked in. That is what lets one published image run with anyone's
configuration, and why the settings both halves need are one variable each.

| Variable              | Read by        | Becomes                                                           |
| --------------------- | -------------- | ----------------------------------------------------------------- |
| `SUPABASE_ANON_KEY`   | server and SPA | The key the browser signs in with.                                |
| `AUTH_MODE`           | server and SPA | Which sign-in methods the login page offers.                      |
| `USERNAME_DOMAIN`     | server and SPA | The domain usernames become addresses under.                      |
| `AI_CHALLENGE`        | server and SPA | Which check the AI dialogs show; see [AI](#ai).                   |
| `TURNSTILE_SITE_KEY`  | SPA            | The Turnstile widget the AI dialogs show.                         |
| `GOOGLE_CLIENT_ID`    | SPA            | "Save to Google Docs".                                            |
| `PUBLIC_SUPABASE_URL` | SPA            | Where the browser reaches `/auth/v1` and `/rest/v1`, if not here. |

Only these names are ever written into the page. Everything else in the
environment, the service-role key above all, stays on the server.

There is no API address to set. The server is the API and serves the page, so
the page's own origin is always right; server rendering already works the same
way. `PUBLIC_SUPABASE_URL` likewise defaults to the page's origin, which is the
one-origin layout the compose stack's gateway gives PostgREST and GoTrue. Set it
only if the browser reaches them somewhere else, such as a hosted Supabase
project. It is separate from `SUPABASE_URL` because that is the address the
_server_ uses, which in the compose stack is a service name no browser can
resolve.

A change reaches browsers that already have the app as well. The service worker
serves the precached `index.html`, so the server also rewrites that entry's
revision in `sw.js` with a hash of the settings. A new configuration then looks
like a new build: the browser installs the new worker, fetches the new shell,
and the app offers its usual reload prompt. The code is in
`apps/api/src/node/browserConfig.js`.

This only happens when the Node server serves the shell. If your reverse proxy
serves `apps/web/dist` itself, the page arrives as built and the `VITE_*` values
apply, so either let the app serve `/` and `/index.html` or build with them.

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
RFC 2606, so it can never resolve, and nothing is ever sent there. The SPA uses
it to sign people in and the server uses it to resolve the username an admin
types into `POST /mod/password`. Both read the one `USERNAME_DOMAIN` variable
(see [How the browser gets its settings](#how-the-browser-gets-its-settings)),
which matters because the two disagreeing is a password reset that answers "no
account with that username". Two things follow
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
more likely to have no mail server than to have one. Changing it is a restart.

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
which goes through the same endpoint) has to pass a check before anything else
happens, so that nobody can script the instance's AI quota away. `AI_CHALLENGE`
chooses which, and the server hands the same value to the SPA, so the browser
always shows the widget the server expects:

| `AI_CHALLENGE` | The check                                   | Needs                               |
| -------------- | ------------------------------------------- | ----------------------------------- |
| `turnstile`    | Cloudflare Turnstile (the hosted instance)  | A Turnstile widget of your own      |
| `altcha`       | An ALTCHA proof of work, served by this API | Nothing                             |
| `none`         | No check                                    | An instance only trusted people use |

Unset, it is `turnstile`, which is what the hosted instance runs. The compose
stack defaults to `altcha`, because it works with nothing to sign up for.
Anything else reads as `turnstile`, so a typo fails closed: the AI features
refuse until it is fixed rather than quietly running with no check. The
dependency check in `docker compose logs app` says which one is in effect, on
its `ai-challenge` line.

Whichever is chosen, the per-address rate limiter still applies afterwards, 60
requests a minute.

With `altcha` or `none`, the server also leaves Cloudflare's Turnstile script
out of the page it serves. The built `index.html` loads it on every page,
because the hosted instance needs it, but an instance that will never use it
shouldn't send each visitor's address to Cloudflare, or make a request that
fails on every page when it has no internet access.

#### ALTCHA

[ALTCHA](https://altcha.org) is an open-source proof of work. When an AI dialog
opens, the widget fetches a signed challenge from `GET /altcha/challenge` and
solves it in the background, which takes about a second on a typical computer,
so there is usually a token before anyone has finished reading the dialog. The
server checks the signature and the solution (`apps/api/src/lib/altcha.js`), and
accepts each solved challenge once: its nonce goes in the rate-limit store until
the challenge would have expired, ten minutes after it was issued.

Challenges are rate-limited per address too, at the same 60 a minute with a
bucket of their own. Making one costs the server a key derivation, so without a
limit anyone could have it make them in a loop without solving any.

Recording a spent challenge is a read and then a write, because the rate-limit
store has no atomic insert (on Cloudflare it is Workers KV). Two copies of one
solution sent at the same instant can therefore both pass. That is accepted: it
takes the work of solving the challenge in the first place, it only works
within that instant, and both requests still pay the rate limiter.

It is a cost rather than a proof of a human. Every request makes the sender do
some work, which is what makes scripting the AI endpoints expensive, without
sending visitors or their addresses to a third party.

Challenges are signed with `ALTCHA_HMAC_KEY`. It is optional: without it the
key is derived from `SUPABASE_SERVICE_ROLE_KEY`, which every instance with a hub
already has and which never leaves the server. Set it to keep the two
independent, for example so that rotating the service-role key doesn't
invalidate challenges that are already out.

#### Turnstile

[Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) is a free
service and works on any host, but the instance needs a widget of its own:

- `TURNSTILE_SITE_KEY`, so the SPA shows the challenge. Without it, the AI and
  image-search dialogs say they are unavailable.
- `TURNSTILE_SECRET_KEY`, so the server can verify it.
- `ALLOWED_HOSTNAMES` set to the hostname the app is served from, which the
  server compares with the hostname Turnstile reports.

In the compose stack, set `AI_CHALLENGE=turnstile` and fill in the two keys in
`.env`; `ALLOWED_HOSTNAMES` is already set from `PUBLIC_HOSTNAME`.

#### None

No widget and no check: the SPA sends a placeholder token and the server lets
every request through to the rate limiter. Only for an instance that just
trusted people can reach, such as one on a home network. On anything public it
lets anyone spend the instance's AI quota.

Pixabay search also needs `PIXABAY_API_KEY`. Wikimedia Commons search needs
nothing, since the browser talks to Wikimedia directly.

### Federation

Set `FEDERATION_ORIGIN` to the instance's public origin (the same value as
`PUBLIC_URL` in the compose stack) and every author becomes an ActivityPub
actor that people on Mastodon, or on another instance of this app, can follow;
each lesson they publish is delivered to those followers. Leave it empty and
none of that runs. See [Federation](./federation.md) for what it sends and what
it accepts.

The origin goes into every actor's id, so it has to be the https address other
servers reach, and it must not change once anyone follows someone here. The
dependency check reports it on its `federation` line, including a misspelled
value, which would otherwise silently leave federation off.

Fedify's caches go in the `kv_store` table, under their own prefix, and
outgoing deliveries queue in memory: they are retried while the process runs and
lost when it stops. That is the right trade for an instance with a handful of
followers; see [Per host](./federation.md#per-host) for where a durable queue
would go.

To try federation between two instances on one machine or private network,
whose origins are private addresses, set `FEDERATION_ALLOW_PRIVATE_ADDRESSES=true`
on both; without it each refuses to talk to the other, as it should on the
internet. Two compose stacks on one machine need their own directory, `.env`
and `COMPOSE_PROJECT_NAME`, and different `PUBLIC_PORT`s; see
[Trying it with two instances](./federation.md#trying-it-with-two-instances).

## Notes on running it

**Put a reverse proxy in front.** The process serves static files itself so that
it _can_ run alone, but Caddy or nginx will do it better: ranges, compression,
and a real response cache, which is the one platform service this host
deliberately implements as a no-op. Terminate TLS there too, and have it send
`X-Forwarded-Proto` (see [The server itself](#the-server-itself)).

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
