---
title: Following from the fediverse
---

# Following from the fediverse

The lesson hub is part of the fediverse, the network of servers that speak
ActivityPub: Mastodon, Pixelfed, Friendica, and other instances of Spelling
Creator among them. If you use any of those, you can follow an author on the
hub and see their lessons as they publish them, without an account here.

## Following an author

Every author has a fediverse address of the form `@<id>@<the hub's domain>`,
where `<id>` is the long string in their profile page's web address. For an
author at `https://spellingcreator.org/users/6f1c2d3e-...`, the address is
`@6f1c2d3e-...@spellingcreator.org`.

Paste that address into the search box of your Mastodon app and follow it as
you would anyone else. You can also paste the profile page's web address
itself; most apps resolve it to the account.

The address is the account id rather than the author's name because a fediverse
address has to be unique and can never change, and display names are neither.
The name you know the author by is what your app shows; the id only appears in
the small print.

## What you see

Each lesson an author publishes arrives as a post from them, with the lesson's
title, a line saying how many sections it has, the first few lines of the
passage, and a link to the lesson page on the hub. Open the link to read the
whole lesson, print it, practice it or fork it, all of which work without an
account.

When an author edits a published lesson, the post is updated. When they delete
or unpublish it, or a moderator hides it, the post is deleted.

Drafts are private and never leave the hub, so following someone shows you
only what they have chosen to publish.

## Copying a lesson from another instance

A lesson on another Spelling Creator instance can be forked into this one, the
same way as a lesson on this hub, with its whole history. On the hub, choose
**Copy a lesson from another instance** (the globe button next to the RSS
button), paste the address of the lesson's page there, and press **Open in the
editor**. You need to be signed in, because the hub fetches the lesson for you.

The lesson opens in the editor as a new lesson of your own, titled as a copy,
with its pictures brought over. Edit it as you like and save it to this hub;
its page will say which instance it was forked from. The other instance has to
federate too, and to run a version that offers its lessons this way.

For now a copy does not pull in the original's later changes, as a fork of a
lesson on this hub can. The history it brought with it is what would make that
possible later.

## What you can't do yet

Replying to a lesson post from Mastodon does not add a comment to the lesson,
and nothing you write elsewhere appears on the hub. Comments, ratings and
proposed changes still need an account on the hub itself, where they go
through its moderation like everything else.

## For instance owners

Federation is off until an instance turns it on. If you run your own instance,
see [Federation](../developers/federation.md) for what it sends, what it
accepts, and the one setting that switches it on.
