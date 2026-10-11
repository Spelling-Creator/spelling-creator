---
title: Notifications
---

# Notifications

For how to use this, see [Notifications](../../guide/notifications.md).

Signed-in users get a notification bell in the app header
(`apps/web/src/components/NotificationBell.jsx`). It fetches the caller's
notifications on mount and then every 30 seconds (`POLL_INTERVAL_MS`), shows an
unread badge (capped at "9+"), and marks everything read when the menu opens
(optimistically, then on the server). Internal links (starting with `/`) route
inside the app; anything else opens in a new tab. The signed-in home dashboard
(`HomePage.jsx`) shows the same list in its **Notifications** panel.

The browser never queries the table directly. Everything goes through the API's
`/notifications` endpoints (`apps/api/src/routes/notifications.js`), which scope
every query to the signed-in caller. The frontend wrapper is
`@spelling-creator/core/notifications` (`fetchNotifications`,
`markNotificationsRead`, `sendLink`).

## Types and where they're created

Every notification is inserted by `createNotification()` in
`routes/notifications.js`. Callers that create one as a side effect swallow
failures, so a notification can never fail the action that caused it.

- **`comment`**, from `routes/comments.js`. Only a **reply** creates one: it
  notifies the parent comment's author ("replied to your comment") and the
  lesson's author ("replied to a comment on your lesson"), deduplicated by
  recipient so someone who is both gets the more specific one, and never
  notifying the replier. A top-level comment notifies nobody. Comments are
  [rich text](./rich-text.md), but the notification's `body` carries the comment
  flattened to plain text, because the bell renders it as text.
- **`link`**, from `POST /notifications/send-link`. The live-collaboration
  dialog (`CollaborateDialog.jsx`) uses it for the host's **Send link** action
  and to email the invite link to the lesson's trusted collaborators
  automatically when a session starts. Because the recipient may not have an
  account yet, a `link` notification is addressed by **email**
  (`recipient_email`), so it's waiting for them the next time they sign in.
- **`follow`**, from `POST /profiles/:id/follow` in `routes/follows.js`, only
  when a new follow row is actually inserted. Its link opens the follower's
  profile. See [Profiles](./profiles.md).
- **`pull_request`**, from `routes/pulls.js`. It is sent to the lesson's author
  once a proposal's pack has landed (not when the row is first created), and
  again when an open proposal is updated; those link to
  `/hub/:id/proposals/:prId`. A proposal opened from the author's own account
  (how an AI assistant over MCP offers changes) is titled "Changes are waiting
  for your review" (or "Changes waiting for your review were updated"). It is
  sent to the proposer when someone else merges or closes their proposal, linking
  to `/hub/:id`; withdrawing your own, or closing a proposal that never became
  ready, sends nothing. See [Pull requests](./pull-requests.md).
- **`lesson_update`**, from `PUT /lessons/:id` in `routes/lessons.js`, when the
  writer is a trusted collaborator rather than the author. A trusted
  collaborator merging a proposal saves the lesson this way, so that lands as a
  `lesson_update` too.

Moderation actions create no notifications of their own. The only one that
notifies anybody is a moderator closing a proposal, which goes through the same
`closePull` path as an author declining it and so sends the proposer the usual
`pull_request` notification.

## How it's stored

```sql
create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users (id) on delete cascade,
  recipient_email text,
  type            text not null,  -- 'comment' | 'link' | 'follow' | 'lesson_update' | 'pull_request'
  title           text not null,
  body            text,
  link            text,
  read            boolean not null default false,
  created_at      timestamptz not null default now()
);
create index notifications_user_id_idx on public.notifications (user_id, created_at desc);
create index notifications_recipient_email_idx on public.notifications (recipient_email, created_at desc);
alter table public.notifications enable row level security;  -- no policies: API only
```

A notification reaches its recipient by their auth user id (`user_id`) or by
their email (`recipient_email`, stored lowercased, used by send-link before the
person's id is known). Reads match either: the API filters on
`or=(user_id.eq.<id>,recipient_email.eq.<email>)`.

## API endpoints

| Method and path                 | Auth                    | Body                        | What it does                                                                                       |
| ------------------------------- | ----------------------- | --------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /notifications`            | `Bearer <Supabase JWT>` |                             | `{ notifications: [{ id, type, title, body, link, read, createdAt }] }`, newest first, at most 100 |
| `POST /notifications/read`      | `Bearer <Supabase JWT>` | `{ id? }`                   | Marks one notification, or all of the caller's unread ones, as read. `{ ok: true }`                |
| `POST /notifications/send-link` | `Bearer <Supabase JWT>` | `{ email, link, message? }` | Sends a `link` notification. `201 { notification }`                                                |

Send-link checks that `email` looks like an address, that `link` is an `http:`
or `https:` URL, and that `message` is at most 1000 characters and free of
profanity (`422` otherwise). The sender's display name goes into the title
("... sent you a link"); the sender always comes from the verified session.
