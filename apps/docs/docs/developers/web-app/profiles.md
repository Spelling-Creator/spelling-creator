---
title: Profiles and display names
description: How display names and bios live in Supabase user metadata, how the public profile pages and Atom feeds are built, and how following works.
---

# Profiles and display names

For how to use this, see [Profiles](../../guide/profiles.md).

Every signed-in user has a public display name, an optional bio, and a public
profile page at `/users/:id`. None of this exposes the user's email: the API only
ever returns the display name (falling back to `"Anonymous"`) and the bio.

The page carries schema.org `ProfilePage` JSON-LD (`buildProfileSchema` in
`apps/web/src/lib/seo.jsx`): the person's name, id, flattened bio and the
page's own counts (followers, follows, lessons). Its Person has an `@id` that
the author in lesson markup points at, so a person's profile and their lessons
read as one entity. There is no `image` on purpose: the page shows an initials
placeholder, and Google's guidelines rule out placeholder images.

## Display names

`DisplayNameGate.jsx` wraps the whole app (in `main.jsx`, and in
`entry-server.jsx` for server rendering) and overlays a non-dismissable
`DisplayNameDialog.jsx` whenever `needsDisplayName` from `lib/auth.jsx` is true:
a signed-in user whose metadata has no display name yet. The same dialog opens
from the account menu's **Edit display name** and from the
[settings page](./pages-and-routing.md).

The name is **not** a database column; it lives in the Supabase user's
`user_metadata.display_name`. The browser can't write it directly (calling
`supabase.auth.updateUser` would skip validation), so it calls
`POST /profile/display-name` (`setDisplayName` in
`@spelling-creator/core/profile`). The handler (`apps/api/src/routes/profile.js`)
collapses whitespace, enforces 2 to 40 characters (`DISPLAY_NAME_MIN`,
`DISPLAY_NAME_MAX`), rejects profanity with `422` and banned names with `409`,
and writes the metadata through the Supabase **Admin API**. Because `author` is
denormalized onto each `lessons` and `comments` row for fast listing, a
successful change also backfills the new name onto the caller's existing rows
(best effort). After saving, the client refreshes its session so the new
metadata shows up.

Publishing a lesson or posting a comment re-checks that the caller has a display
name and refuses with `403` if not, so the gate can't be bypassed. Accounts
created with a username on a password instance also have to pick a display
name; the username is never used as one.

## Bios

A bio is edited in `BioDialog.jsx` (opened from your own profile or from the
settings page) and saved with `POST /profile/bio` (`setBio` in
`@spelling-creator/core/profile`). Like the display name it lives in
`user_metadata.bio`, written via the Admin API, and is never denormalized onto
rows.

Bios are rich text, written with the same [tiptap](https://tiptap.dev) editor as
a comment (`RichTextInput.jsx`) and stored as sanitized HTML: formatting, lists
and links, but no embedded media. See [Rich text](./rich-text.md). The handler
refuses raw input over 8000 characters before parsing, sanitizes, and then
checks the resulting **text**: over `BIO_MAX` (500) characters is `400`, and
profanity is `422`. Some consequences worth knowing:

- The 500-character cap counts the text, not the markup, so formatting never eats
  into the budget. The editor's counter measures it the same way.
- A bio that is nothing but media (say, a pasted image) sanitizes down to no text,
  and is stored as an empty bio rather than as stray empty markup. An empty bio
  clears it.
- The response returns exactly what was stored (the sanitized HTML), so the
  profile renders the truth without a refetch.
- Wherever a bio appears somewhere markup can't go, it is flattened to plain text
  first with `richTextToLine` from `@spelling-creator/core/richText`: the
  profile's meta and Open Graph description, and the one-line subtitle in the
  followers and following lists. A bio rendered as HTML into `<meta content>`
  would otherwise show up as literal tags in search snippets and link previews.

## Profile pages

`ProfilePage.jsx` renders `/users/:id`. It reads `GET /profiles/:id`
(`fetchUserProfile` in `@spelling-creator/core/users`). The data lives under
`/profiles` on the API so it never collides with the SPA's own `/users/:id`
page, the same split as lesson data at `/lessons` and the page at `/hub`.

```json
{
  "user": {
    "id": "...",
    "displayName": "Jordan",
    "bio": "<p>Speller and writer.</p>",
    "followerCount": 12,
    "followingCount": 4,
    "isFollowing": false
  },
  "lessons": [
    {
      "id": "...",
      "authorId": "...",
      "title": "...",
      "author": "...",
      "sectionCount": 4,
      "published": true,
      "shadowbanned": false,
      "forkedFrom": null,
      "createdAt": "..."
    }
  ]
}
```

The lesson list is the user's published, non-shadowbanned lessons, newest first
(the same visibility rule as the public hub). The profile is resolved via the
Admin API. The read is public; `isFollowing` reflects whether the caller follows
this profile and is only meaningful when the request carries a session token
(it is `false` for an anonymous view). The page is server-rendered anonymously,
and a signed-in viewer quietly re-fetches with their token to learn
`isFollowing`.

Each profile also has an Atom feed at `GET /profiles/:id/feed.xml` (shown as
**RSS** in the UI, built by `userFeedUrl`), merging the user's published lessons
and their comments, newest first, capped at 50 entries. Comment bodies are
flattened to plain text for the feed. The profile's **Activity** popover is
parsed from the same feed.

## Following

A follow is one row in the `follows` table, keyed by Supabase user id on both
sides so it survives a display-name change. The profile header shows the
Follow/Following button (never on your own profile) plus the follower and
following counts. The handlers are in `apps/api/src/routes/follows.js`; the
frontend wrappers are `setFollowing()`, `fetchFollowList()` and
`fetchFollowingActivity()` in `@spelling-creator/core/users`.

| Method and path               | Auth     | What it does                                                                                      |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `POST /profiles/:id/follow`   | `Bearer` | Follow. `201` for a new follow, `200` if it already existed. `{ following: true, followerCount }` |
| `DELETE /profiles/:id/follow` | `Bearer` | Unfollow. `{ following: false, followerCount }`                                                   |
| `GET /profiles/:id/followers` | none     | `{ users: [{ id, displayName, bio }] }`, the users who follow `:id`                               |
| `GET /profiles/:id/following` | none     | `{ users: [{ id, displayName, bio }] }`, the users `:id` follows                                  |
| `GET /following/activity`     | `Bearer` | `{ activity: [{ id, title, summary, link, updated }] }`, the caller's following feed              |

- Following is idempotent: the insert uses `resolution=ignore-duplicates`
  (`ON CONFLICT DO NOTHING`), so re-following creates no second row and sends no
  second notification. A genuinely new follow sends a `follow`
  [notification](./notifications.md). You can't follow yourself (`400`) or a
  user who doesn't exist (`404`). The follower always comes from the verified
  session, never the request body.
- The followers and following lists open in `FollowListDialog.jsx` (the
  **Connections** dialog). They are newest-follow first and capped at
  `LIST_LIMIT` (200); each id is resolved to its public profile via the Admin
  API, so no email leaks, and ids that no longer resolve are dropped.
- `GET /following/activity` backs the **From people you follow** panel on the
  signed-in home dashboard (`HomePage.jsx`). It merges the published,
  non-shadowbanned lessons and the comments of everyone the caller follows,
  newest first, capped at `FEED_LIMIT` (50), and returns an empty list when the
  caller follows no one. Names come from the denormalized `author` column.

## Profile endpoints

| Method and path              | Auth     | Body              | Response          |
| ---------------------------- | -------- | ----------------- | ----------------- |
| `POST /profile/display-name` | `Bearer` | `{ displayName }` | `{ displayName }` |
| `POST /profile/bio`          | `Bearer` | `{ bio }`         | `{ bio }`         |
| `GET /profiles/:id`          | none     |                   | see above         |
| `GET /profiles/:id/feed.xml` | none     |                   | Atom XML          |

## Schema

```sql
create table public.follows (
  follower_id  uuid not null references auth.users (id) on delete cascade,
  following_id uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id)  -- makes a follow idempotent
);
-- The primary key covers "who does X follow"; this covers "who follows X".
create index follows_following_id_idx on public.follows (following_id);
alter table public.follows enable row level security;  -- no policies: API only
```

Display names and bios are not in any table; they are Supabase auth user
metadata. See [Lesson hub and accounts](./hub-and-accounts.md#supabase-schema)
for the rest of the schema.
