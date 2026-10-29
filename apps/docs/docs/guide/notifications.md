---
title: Notifications
description: "What the notification bell tells you about: replies, new followers, session invite links, proposed changes, and saves by trusted collaborators."
---

# Notifications

When you're signed in, a **bell** in the header tells you when something
happens that involves you. A red badge on it shows how many notifications you
haven't seen yet.

Click the bell to see your notifications, newest first. Opening it marks them
all as read. Click one to go where it points: a lesson, a proposal or someone's
profile. A link to another website opens in a new tab. The bell checks for new
notifications about every 30 seconds, so there's no need to reload the page. The
**Notifications** panel on your home page shows the same list.

## What you're notified about

- **Replies.** Someone replied to your comment, or replied to a comment on a
  lesson you published. You get one notification even if both are true. A new
  comment that isn't a reply doesn't send a notification.
- **New followers.** Someone started following you. The notification opens
  their profile. Following you again after unfollowing doesn't send a second
  one.
- **Invite links.** Someone sent you the link to a live session, either with
  **Send link** in the collaboration dialog or automatically because you're one
  of the lesson's trusted collaborators. These are addressed to your email, so
  if you don't have an account yet, the link is waiting for you the first time
  you sign in with that email. Any message that comes with it is checked for
  language that isn't allowed. See [Live collaboration](./live-collaboration.md).
- **Proposed changes.** Someone proposed changes to a lesson you published, or
  updated a proposal they'd already made; the notification opens the proposal so
  you can review it. Or a proposal _you_ made was merged or closed; that
  notification opens the lesson, since the decision has been made. Nothing is
  sent until a proposal has finished uploading, and withdrawing your own
  proposal doesn't notify you. A proposal opened from your own account (which is
  how an AI assistant offers you changes) reads **Changes are waiting for your
  review**, because otherwise you'd have no way of knowing it's there. See
  [Pull requests](./pull-requests.md).
- **Saves by trusted collaborators.** A trusted collaborator saved changes to a
  lesson you published. Merging a proposal into your lesson also counts, when a
  trusted collaborator does it.

Moderation actions, such as a moderator deleting a comment or hiding a lesson,
don't send notifications. The one exception is a moderator closing a proposal,
which tells the person who proposed it, the same as when the lesson's author
closes it. See [Moderation](./moderation.md).

For how notifications are stored and the endpoints behind them, see
[Notifications for developers](../developers/web-app/notifications.md).
