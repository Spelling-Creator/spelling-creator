---
title: Lesson hub and accounts
---

# Lesson hub and accounts

The **Lesson hub** is where people share the lessons they've made. Anyone can
browse it, open a lesson, print it, download it as a Word document or fork it
into a lesson of their own, all without an account. You only need to sign in
to publish lessons, keep private drafts in the cloud, comment, rate lessons and
follow people.

## Browsing the hub

Open **Lesson hub** from the menu. Lessons are listed newest first. Use
**Search lessons** to find one by its title or its author's name, and the RSS
button to subscribe to new lessons in a feed reader.

Click a lesson to open its page. The page is split into tabs:

- **Lesson**: the lesson itself, with an **About** panel showing who made it,
  how many sections it has, when it was published and its star rating.
- **Practice**: work through the lesson a step at a time. See
  [Interactive mode](./interactive-mode.md).
- **Discussion**: comments and ratings (see below).
- **Proposals**: changes other people have offered to make to the lesson. See
  [Pull requests](./pull-requests.md).
- **History**: the lesson's saved versions.

The **Lesson actions** menu (the three dots at the top of the page) has
**Print PDF**, **Download Word** and **Fork**. On a lesson you published it also
has **Edit** and **Delete**.

## Signing in

Choose **Sign in**, enter your email address and press **Send magic link**.
You'll get an email with a one-time sign-in link and a code. Either open the
link on the same device, or type the code into **Code from the email** and press
**Sign in**. The code is the easier route if you've installed the app, because
email links often open in a separate browser that doesn't share the app's
sign-in. See [Installing and offline use](./install-and-offline.md).

Some self-hosted instances sign people in with a username and password instead
of email. There you'll see **Username or email** and **Password** fields, and
**Don't have an account? Create one** to make an account without an email
address.

The first time you sign in you'll be asked to choose a display name. That's the
only name other people ever see; your email address is never shown. See
[Profiles](./profiles.md).

## Saving lessons to the cloud

In the editor, **Save to cloud** offers two choices:

- **Publish to hub** shares the lesson publicly.
- **Save as draft** backs the lesson up to the cloud but keeps it private. Only
  you can see it, in **Your drafts** on the hub.

Once a lesson is in the cloud, the same menu reads **Update published lesson**
or **Update draft**, and the other choice switches it: you can publish a draft
when it's ready, or pull a published lesson back to a draft. You can keep up to
8 private drafts at a time. Published lessons have no limit.

## Editing and deleting your lessons

Your own lessons show **Edit** and **Delete** buttons on their hub cards and in
the lesson's **Lesson actions** menu.

**Edit** opens the lesson in the editor. If this device already has a copy of
it, that copy reopens; otherwise a new one is made, so nothing you were working
on is replaced. The editor shows **Editing a published lesson** (or **Editing a
cloud draft**) so you know saving will update the version in the cloud.

**Delete** removes the lesson for good, along with its comments, ratings and
history. To make sure it's deliberate, you'll be asked to type the lesson's name
before the **Delete** button works.

## Comments

Comments live on a lesson's **Discussion** tab. Type in **Add a comment** and
press **Post comment**, or press **Reply** under someone's comment to answer
them. Replies are shown nested under the comment they answer.

Comments can have simple formatting: bold, italic, underline, strikethrough,
code, lists, quotes and links. Pictures, videos and other embedded media can't
be added. A comment can be up to 2000 characters, counting only the words you
write, not the formatting.

Comments that contain language that isn't allowed are blocked before they're
saved. You'll see **Comment blocked** with the reason, and you can change the
wording and try again.

You can **Edit** your own comments after posting. An edited comment shows an
**edited** label next to its time, so readers know it changed. There's no way to
delete your own comment, so edit it instead, or ask a moderator if it needs to
go.

Any comment can be translated into your language with **Translate**. This
happens on your device and needs no account. See
[Translation](./translation.md).

When someone replies to your comment, or replies to a comment on a lesson you
published, you get a [notification](./notifications.md).

## Ratings

Next to the comment box, **Rate this lesson** lets you give the lesson 1 to 5
stars when you post a comment. Each person has one rating per lesson: rating
again changes your earlier rating rather than adding a second one. The
lesson's average and number of ratings show in its **About** panel.

## Forking a lesson

**Fork** (in the **Lesson actions** menu) starts a new lesson of your own from
any lesson in the hub. The original isn't changed. Your fork keeps the
original's full history, so later on you can bring in changes its author has
made since you forked it, and you can offer your own changes back to the author
from the **Proposals** tab. See [Pull requests](./pull-requests.md) and
[Variations](./variations.md).

## Trusted collaborators

A lesson's author can add people by email to the lesson's **Trusted
collaborators** list, in the collaboration dialog (see
[Live collaboration](./live-collaboration.md)). Trusted collaborators can save
changes to the lesson's title and content, and can review and merge proposed
changes. They can't publish or unpublish it, delete it, or change who else is
on the list. The author gets a notification whenever a trusted collaborator
saves the lesson.

If someone else saved the lesson since you last synced, your save stops with a
message asking you to merge their changes and then save again. Nothing is
overwritten, for the author or for a collaborator.

## See it in action

<DemoVideo name="hub-browse-and-discuss" title="Finding a lesson and joining the discussion">
From the signed-in home page into the hub, a search, a lesson's discussion
with a comment and a 5-star rating, and the lesson's version history.
</DemoVideo>

<DemoVideo name="hub-publish-a-draft" title="Publishing a draft">
A draft saved to the cloud, opened in the editor from "Your drafts" and
published to the hub.
</DemoVideo>

The people in these videos are made up; the lessons are real ones from the hub.

For how the hub, sign-in and comments work under the hood, see
[Lesson hub and accounts for developers](../developers/web-app/hub-and-accounts.md).
