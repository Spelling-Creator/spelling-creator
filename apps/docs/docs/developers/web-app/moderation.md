---
title: Moderation
---

# Moderation

For how to use this, see [Moderation](../../guide/moderation.md).

On top of the automatic profanity filtering (comments, bios, display names,
send-link messages and proposals, all via `glin-profanity` in
`apps/api/src/lib/profanity.js`), the hub has a **moderation** layer with two
privilege tiers and a moderation page at `/moderation`
(`apps/web/src/pages/ModerationPage.jsx`). The page is linked from the account
menu only for moderators and admins, and it asks crawlers to stay out of the
index twice: an `X-Robots-Tag: noindex` header on the shell
(`routes/spa.js`), for crawlers that never run the app, and a `noindex` meta
tag once it renders. (`robots.txt` used to disallow it instead, but a crawler
can only read either signal on a page it is allowed to fetch.)

The browser holds no authority of its own. `lib/auth.jsx` asks
`GET /mod/whoami` for the caller's role whenever the access token changes and
exposes `role`, `isModerator` and `isAdmin`, which only decide which controls to
render. The API **re-derives the caller's role from `user_roles` on every
privileged request** (`verifyUserAndRole` in `apps/api/src/lib/auth.js`), so a
tampered client can never grant itself power.

The API's moderation routes live at `/mod`, not `/moderation`, on purpose: the
API sees every request before the static assets do, so a route at the same path
as the SPA's `/moderation` page would swallow that page's direct loads and
answer them with `401`. See the registration comment in `apps/api/src/app.js`.
The handler is `apps/api/src/routes/moderation.js`; the frontend wrapper is
`@spelling-creator/core/moderation`.

## Roles

Roles live in the `user_roles` table. A normal signed-in user is a plain author
who can only touch their own content. Above that:

- **Moderator**: delete any comment, close any
  [proposed change](./pull-requests.md), shadowban a lesson, ban users by name,
  and request that a lesson be fully deleted.
- **Admin**: everything a moderator can do, plus add moderators, approve or deny
  a moderator's deletion request, fully delete a lesson, ban users by IP, and
  set a user's password.

`isModeratorRole(role)` is true for both tiers. Moderators and admins can also
read drafts and shadowbanned lessons, their comments, pulls and history
(`canReadLesson` in `lib/lesson.js`), and get the lesson's `authorIp` on those
reads.

What is _not_ on either list is **editing** someone else's comment. A comment
can only be edited by its author (`PATCH /lessons/:id/comments/:commentId`
checks the stored `author_id`); a moderator's power over a bad comment is to
delete it, not to rewrite it under its author's name. For the same reason a
moderator can **close** a proposal (`closePull` in `routes/pulls.js` accepts
`isModeratorRole`) but never **merge** one: merging writes a lesson under its
author's name, which is authorship, not moderation, so only the author and their
trusted collaborators can do it.

There is deliberately **no in-app way to create an admin**. Admins are seeded by
hand with the snippet at the bottom of `apps/api/schema.sql`, after the person
has signed in once:

```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'you@example.com'
on conflict (user_id) do update set role = 'admin';
```

Admins add moderators with `POST /mod/moderators` (by email, via the Admin
API), and `granted_by` records which admin added each one. Adding a moderator
never touches an existing admin (`409`), and removing one is filtered to
`role = 'moderator'`, so it can never remove an admin.

## Shadowbanning vs. deletion

A **shadowbanned** lesson (`lessons.shadowbanned`) is dropped from every public
listing (the hub, profiles, the following feed, the Atom feed and the spelling
words aggregate all filter `shadowbanned=eq.false`) and from public reads of
the lesson, its comments, pulls and history, which `404` to everyone except its
author, its trusted collaborators and moderators/admins. It is reversible and
any moderator can do it. The author can still load and edit the lesson; note
that `rowToLesson` includes `shadowbanned` in every response and the lesson page
(`pages/lesson/LessonLayout.jsx`) renders a **Shadowbanned** badge whenever it
is set, so an author who opens their own lesson does see it.

A **full deletion** is destructive, so moderators can't do it directly. A
moderator files a row in `lesson_delete_requests` (status `pending`), and an
admin approves it (which deletes the lesson) or denies it. Both outcomes record
`resolved_by` and `resolved_at`. The delete itself is `fullyDeleteLesson` in
`lib/lesson.js`: it sweeps the packs of any proposals, deletes the lesson's
comments first (so it works on a database whose comment foreign key doesn't
cascade), deletes the row, and then drops the stored history. Ratings,
proposals and deletion requests go with the row through their cascading foreign
keys.

Deleting a comment (`DELETE /mod/comments/:id`) removes its replies too, through
`comments.parent_id ... on delete cascade`.

## Bans

- **Name bans** (`banned_names`, created by moderators) block any account whose
  current display name matches. Names are stored normalized (lowercased,
  trimmed) as the primary key for an exact, case-insensitive match;
  `display_name` keeps the original casing for the moderation page.
  `POST /profile/display-name` also refuses a banned name (`409`). Because the
  check is against the current display name, changing one's name escapes the
  ban.
- **IP bans** (`banned_ips`, created by admins) block requests from an address.

Both are checked by `bannedResponse` in `lib/bans.js`, which returns
`403 "Your access has been suspended."`. It runs at the top of the
content-creating routes: `POST` and `PUT /lessons`, `PUT /git/:id/pack`,
`POST /lessons/:id/comments`, `PATCH /lessons/:id/comments/:commentId`, and
opening, updating and merging proposals. Reads, follows, profile changes and
send-link are not ban-checked.

To support banning by IP from a piece of content, the API records the creator's
IP into `lessons.author_ip`, `comments.author_ip` and
`lesson_pull_requests.author_ip`. Which header that comes from is the
platform's business (`clientIp` in `src/platform/`): `cf-connecting-ip` on
Cloudflare, and on Node the header named by `CLIENT_IP_HEADER` (default
`x-forwarded-for`, read `TRUSTED_PROXY_COUNT` hops from the right; `0` means no
IP at all, so IP bans stop matching). See [Platform seam](../platform-seam.md)
and [Self-hosting](../self-hosting.md).

The address is **only ever returned to moderators/admins**, never in public
responses, and currently only on two paths: `GET /lessons/:id` for a draft or
shadowbanned lesson, and the response to `POST /mod/lessons/:id/shadowban`. The
published-lesson read doesn't include it, so the lesson page's **Ban author by
IP** item is disabled ("no IP on record") until the lesson is shadowbanned and
reloaded. No endpoint returns `comments.author_ip` or a proposal's `author_ip`
at all yet; admins can still ban an address typed into the moderation page.

## API endpoints

All require a `Bearer <Supabase JWT>` (`401` without one) and the role shown
(`403 "Moderator access required."` or `"Admin access required."`).

| Method and path                         | Role  | Body                        | What it does                                                               |
| --------------------------------------- | ----- | --------------------------- | -------------------------------------------------------------------------- |
| `GET /mod/whoami`                       | any   |                             | `{ role }`: `"admin"`, `"moderator"` or `null`                             |
| `DELETE /mod/comments/:id`              | mod   |                             | Delete any comment and its replies                                         |
| `POST /mod/lessons/:id/shadowban`       | mod   | `{ shadowbanned: boolean }` | Hide or unhide a lesson. Returns `{ lesson }` with `authorIp`              |
| `GET /mod/lessons/shadowbanned`         | mod   |                             | `{ lessons }`, every shadowbanned lesson, newest first                     |
| `POST /mod/lessons/:id/delete-request`  | mod   | `{ reason? }`               | File a deletion request (reason cut to 1000 characters). `201 { request }` |
| `DELETE /mod/lessons/:id`               | admin |                             | Fully delete a lesson                                                      |
| `GET /mod/delete-requests`              | admin |                             | `{ requests }`, pending only, with the lesson's title and author           |
| `POST /mod/delete-requests/:id/approve` | admin |                             | Delete the lesson and mark the request approved                            |
| `POST /mod/delete-requests/:id/deny`    | admin |                             | Mark the request denied without deleting                                   |
| `GET /mod/bans`                         | mod   |                             | `{ names, ips }`; `ips` is only filled in for admins                       |
| `POST /mod/bans/name`                   | mod   | `{ name }`                  | Ban a display name                                                         |
| `DELETE /mod/bans/name/:nameLower`      | mod   |                             | Lift a name ban                                                            |
| `POST /mod/bans/ip`                     | admin | `{ ip, reason? }`           | Ban an address (reason cut to 200 characters)                              |
| `DELETE /mod/bans/ip/:ip`               | admin |                             | Lift an IP ban                                                             |
| `GET /mod/moderators`                   | admin |                             | `{ moderators: [{ userId, email, createdAt }] }`                           |
| `POST /mod/moderators`                  | admin | `{ email }`                 | Make a signed-in-at-least-once user a moderator. `201 { moderator }`       |
| `DELETE /mod/moderators/:userId`        | admin |                             | Remove a moderator                                                         |
| `POST /mod/password`                    | admin | `{ identifier, password }`  | Set a user's password (self-hosted recovery)                               |

## Setting a password

An instance that signs people in with a username and has no mail server has
nowhere to send a reset link, so a forgotten password would otherwise be
unrecoverable short of the database. An admin can set one from the moderation
page, identifying the person by username or by email, whichever they are known
by. `identifierToEmail` from `@spelling-creator/core/username` turns a username
into the synthetic address it registered under (using `USERNAME_DOMAIN`), and
the password must be at least `PASSWORD_MIN_LENGTH` (8) characters, matching
`GOTRUE_PASSWORD_MIN_LENGTH`. The section only appears when `hasPasswordAuth()`
is true; there is nothing to set on a magic-link-only instance.

It is **admin-only, never moderator**. Setting somebody's password is taking
their account, which is a different kind of power from hiding a lesson. An admin
may reset their own and anybody below them, but not another admin's (`409`):
admins are peers, and taking a peer's account is an escalation the tier was
never meant to allow.

That last rule fails closed. If the target's role cannot be read at all (the
database is unreachable, or answers with something that isn't a row list),
`lookupUserRole` reports `known: false` and the reset is refused with `502`
rather than allowed through. Everywhere else an unknown role means "no
privileges" and blocks by itself; here an absent role is what _permits_ the
reset, so the same reading would hand over another admin's account whenever the
database hiccuped.

There is no audit table, so the action leaves a line in the server log naming
who reset whom (`admin <id> reset the password of <id>`). It records identities
only, never the password.

Two limits worth knowing. The last admin locking themselves out is a database
problem, not an in-app one. And the reset changes the password without
necessarily ending sessions already open elsewhere, so treat it as recovery from
forgetfulness rather than as containment of a compromised account. See
[Self-hosting](../self-hosting.md).

## Schema

```sql
create table public.user_roles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null check (role in ('moderator','admin')),
  granted_by uuid references auth.users (id) on delete set null,  -- null for hand-seeded admins
  created_at timestamptz not null default now()
);

alter table public.lessons  add column if not exists shadowbanned boolean not null default false;
alter table public.lessons  add column if not exists author_ip text;
alter table public.comments add column if not exists author_ip text;

create table public.banned_names (
  name_lower   text primary key,   -- lowercased, trimmed
  display_name text,               -- original casing, for the moderation page
  banned_by    uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

create table public.banned_ips (
  ip         text primary key,
  reason     text,
  banned_by  uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.lesson_delete_requests (
  id           uuid primary key default gen_random_uuid(),
  lesson_id    uuid not null references public.lessons (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  reason       text,
  status       text not null default 'pending' check (status in ('pending','approved','denied')),
  resolved_by  uuid references auth.users (id) on delete set null,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index lesson_delete_requests_status_idx on public.lesson_delete_requests (status, created_at desc);
```

All four tables have RLS enabled with no policies, so only the service-role API
can read or write them. (`lesson_pull_requests.author_ip` is part of that
table's own `create table`; see [Pull requests](./pull-requests.md).)
