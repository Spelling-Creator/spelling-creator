---
title: Moderation
description: "What moderators and admins can do: shadowbanning lessons, deleting comments, bans by name or IP address, and what each action means for the person."
---

# Moderation

This page is for people with the **moderator** or **admin** role. It explains
what each role can do, where the tools are, and what the people on the other
end experience.

Everyone already gets some protection automatically: comments, bios, display
names, invite messages and proposals containing language that isn't allowed are
blocked before they're saved. Moderation is for everything a filter can't
catch.

## Roles

- **Moderators** can hide (shadowban) a lesson, delete any comment, close any
  proposed change, ban people by display name, and ask an admin to delete a
  lesson.
- **Admins** can do everything a moderator can, and also delete lessons
  outright, approve or deny moderators' deletion requests, ban by internet (IP)
  address, add and remove moderators, and, on instances where people sign in
  with a password, set someone's password.

Admins add moderators from the **Moderation** page. The person has to have
signed in at least once first. Admins themselves are set up by whoever runs
the site; there's no button for it.

Neither role can **edit** someone else's comment or **merge** someone's proposed
changes into a lesson. Both would put words into a lesson or comment under
another person's name. A moderator's power over a bad comment is to delete it,
and over a proposal is to close it.

## Where the tools are

- **On a lesson's page**: a shield button next to the **Lesson actions** menu
  opens the moderation menu: **Shadowban lesson** (or **Un-shadowban lesson**),
  **Ban author by name**, and either **Request deletion...** (moderators) or
  **Delete lesson fully...** and **Ban author by IP** (admins).
- **On a comment**: the comment's moderation menu has **Delete comment** and
  **Ban author by name**.
- **On a proposal**: **Close**, on the lesson's **Proposals** tab.
- **The Moderation page**: choose **Moderation** from the account menu (it only
  appears for moderators and admins). It has **Shadowbanned lessons** and
  **Bans** for everyone with a role, and for admins **Pending deletion
  requests**, **Moderators** and, on password instances, **Set a password**.

## What each action does to the person

None of these actions sends the person a notification, except closing a
proposal (they're told it was closed, the same as when the author closes it).

### Shadowbanning a lesson

The lesson disappears from public view: it's no longer listed on the hub, in
search, on the author's profile, in people's following feeds or in the RSS feed,
and anyone else who opens its link sees "Lesson not found". Its comments and
proposals are hidden the same way.

The author can still open and edit it as normal, and nothing is deleted. Their
lesson page does show a **Shadowbanned** label next to the title, so the author
can tell it has been hidden if they look at the lesson itself.

It's fully reversible: use **Un-shadowban lesson** on the lesson's page, or
**Un-shadowban** in the **Shadowbanned lessons** list on the Moderation page.

### Deleting a comment

The comment disappears for everyone, and **every reply under it goes too**. This
happens straight away, with no confirmation, and can't be undone. The person
isn't told.

### Deleting a lesson

Deleting a lesson removes it for good, along with its comments, ratings,
proposals and history. It can't be undone.

Moderators can't do this directly. **Request deletion...** asks the admins,
with an optional reason. Admins see the request under **Pending deletion
requests** and choose **Approve** (the lesson is deleted) or **Deny** (nothing
happens). Admins can also use **Delete lesson fully...** on any lesson, which
asks them to type the lesson's name to confirm.

### Banning by display name

A name ban stops any account whose display name matches (capital letters don't
matter) from publishing, saving or editing lessons, posting or editing
comments, and proposing changes. When they try, they see "Your access has been
suspended." They can still browse and read. Nobody can choose a banned name as
their display name.

Their existing lessons and comments stay where they are; hide or delete those
separately if they need to go.

Name bans match the current display name only. Someone who changes their
display name to a different one is no longer covered by the ban. If that
happens, an admin can ban their IP address instead.

Moderators can ban a name from a lesson or comment menu, or type one into
**Banned names** on the Moderation page. Lifting a ban is done from the same
list.

### Banning by IP address (admins)

An IP ban blocks the same posting actions as a name ban, but for anyone posting
from that internet address, whatever account or name they use. Existing content
stays in place. Be aware that several people can share one address (a home
network, an office, a library), and an IP ban blocks all of them.

**Ban author by IP** only works when the address the lesson was published from
is available to the page, which at the moment is only for a lesson that is
shadowbanned or still a draft. On a normal published lesson the menu item reads
**Ban by IP (no IP on record)**. To ban that author's address, shadowban the
lesson first and reload the page. Admins can also type an address into **Banned
IPs** on the Moderation page.

### Closing a proposal

**Close** ends a proposed change without merging it. The proposal and its
discussion stay visible, but the changes themselves are discarded. The person
who proposed it is notified. See [Pull requests](./pull-requests.md).

## Setting a password (admins)

On an instance where people sign in with a username and password and there's no
email, a forgotten password can't be reset by email. An admin can set a new one
under **Set a password**, identifying the person by **Username or email**. The
password must be at least 8 characters, and the person should change it
afterwards.

Admins can set their own password and anyone else's except another admin's.
This doesn't necessarily sign the person out on devices where they're already
signed in, so it's for recovering a forgotten password, not for locking out
someone whose account was taken over.

For roles, endpoints and the database tables behind moderation, see
[Moderation for developers](../developers/web-app/moderation.md).
