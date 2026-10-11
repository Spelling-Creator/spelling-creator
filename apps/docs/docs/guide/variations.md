---
title: Variations
---

# Variations

A **variation** is a separate copy of a lesson that you can change freely. The
main lesson, the one everybody else sees, stays exactly as it is while you work
on a variation, and nothing you do there reaches it until you bring the
variation in.

Use one when you want to try something bigger, like rewriting a section or
reordering the questions, and decide afterwards whether it's better. You don't
have to make a whole second lesson to do it.

## Where to find them

In the editor, next to the "Version saved" chip, there's a second chip that
shows which copy you're working on. It reads **Main lesson** normally, and the
variation's name (highlighted) when you're on one.

Click it to open **Variations**. From there you can:

- **New variation**: give it a name and press **Create**. It starts as a copy
  of whatever you're working on right now.
- Switch between the main lesson and any variation by clicking it. The one
  you're on says "You're working on this".
- **Rename...** or **Delete** a variation from its menu. Deleting asks first,
  because anything that's only in that variation goes with it. If you delete
  the one you're on, the editor switches you back to the main lesson first.
- **Bring into the main lesson**, which is what a variation is for (see below).

Each variation shows how much work is on it that the main lesson doesn't have
yet, such as "3 changes that aren't in the main lesson".

Names can use letters, numbers, spaces, dots and hyphens, up to 32 characters.
Other characters are dropped. A lesson can have up to 11 variations besides the
main lesson.

## Bringing a variation in

Choose **Bring into the main lesson** from the variation's menu. The editor
switches to the main lesson and merges the variation's changes into it, block
by block, the same way other merges in the app work:

- Changes to different blocks, or to different parts of the same block (a
  caption in one, a picture's size in the other), are combined automatically.
- Only a block that was changed in the same place on both sides is put to you,
  and you choose which version to keep. Usually there's nothing to choose.
- The dialog sums up what it merged on its own, and you press **Bring it in**
  to finish.

Anything you hadn't saved yet in the variation is kept in the variation on the
way out, so nothing half-finished is carried across by accident.

Afterwards the variation is still there, now reading "0 changes that aren't in
the main lesson". Keep working in it or delete it.

## Trying out a proposal in a variation

If someone has [proposed changes](./pull-requests.md) to your lesson and you're
not sure about them, press **Try it in a variation** on the proposal's page.
The changes go into a variation of your own named after the proposal, so you can
look through the whole lesson with them in place. The main lesson doesn't change,
and the proposal stays open for you to decide on. Trying the same proposal again
takes you back to the variation you made the first time.

## Variations are as public as the lesson

Variations are saved with the lesson, so once you've saved the lesson to the
cloud, a variation you started on one computer is there when you open the
lesson on another.

That also means **anyone who can open the lesson can see its variations**. On a
private draft that's you and anyone you trust with it. On a published lesson
it's everyone. The Variations dialog says this too.

If you want to try something privately, use **Fork into a new lesson** in the
editor instead, which makes a separate copy that's yours alone until you choose
to publish it.

Variations stay with their lesson: someone who forks your lesson gets the main
lesson only, and a proposal you send carries only the copy you were working on
(see [Proposing changes](./pull-requests.md)).

For how variations are stored and synced, see the
[developer notes on variations](../developers/web-app/variations.md).
