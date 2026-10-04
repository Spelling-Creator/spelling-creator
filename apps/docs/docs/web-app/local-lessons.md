---
title: Lessons on this device
---

# Lessons on this device

The editor holds **as many lessons as you make**. They live in this browser, in
IndexedDB, and they are listed on a page of their own at `/library`, reached from
**On this device** in the app header, the **Lessons** button in the editor's top
bar, or **Manage lessons** in Settings.

Nothing you are working on is ever replaced. That is the whole point of the
feature, and it is worth saying plainly, because it used to be the opposite: the
editor kept exactly **one** working document, so opening a lesson from the hub,
forking one, or importing a Word file all overwrote whatever was on screen, and
each of those flows needed a "Replace your current work?" dialog to warn you
first. Those dialogs are gone, because there is nothing left to replace.

## The page

```text
Lessons on this device                          + New lesson
─────────────────────────────────────────────────────────
  Volcanoes                                    ✓  ⋯
  3 sections · 24 blocks · edited just now        Published

  Volcanoes (copy)                                 ⋯
  3 sections · 24 blocks · edited 2 minutes ago

  Year 4 spellings                                 ⋯
  1 section · 6 blocks · edited yesterday       Cloud draft
─────────────────────────────────────────────────────────
```

Clicking a row opens it in the editor. The tick marks the lesson the editor last
had open, which is the one it comes back to. The badge on the right says where
else that lesson exists: **Published** on the hub, or a private **Cloud draft**;
a lesson with no badge is on this device only. The `⋯` menu holds the three
things you can do to a lesson without opening it:

| Action                      | What it does                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Rename**                  | Retitles it. Same as editing the title at the top of the editor; the title _is_ the lesson's name.                   |
| **Duplicate**               | A full copy, including its [version history](/monorepo/version-history), unattached to the hub, titled "... (copy)". |
| **Delete from this device** | Removes the lesson, its document and its history. Asks twice, and cannot be undone.                                  |

The page works on the library directly, with the editor not mounted at all, so
there is nothing on screen to save first. Opening a lesson sets it as the
editor's current lesson and goes to `/editor`, which loads it on mount. **New
lesson** goes to `/editor?new=1`, so the editor can reuse an untouched lesson
instead of making another empty one. Deleting the lesson the editor last had
open is fine too: next time, the editor opens the most recent one left, or
starts a fresh one if there are none.

This used to be a dialog over the editor at `/editor/lessons`. That address now
redirects to `/library`, so old links still work.

## Where each lesson lives

A lesson is three things. The first two are keyed by its id in this device's
library; the third is keyed by whichever id its repository currently answers to:

| What                | Where                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| Its metadata        | The `lessons` store, under the local id: title, block counts, hub attachment, last-edited time |
| Its document        | The `lessonDocs` store, under that same local id                                               |
| Its version history | A git repository of its own, at `/lessons/<repoId>/.git` in LightningFS                        |

The split between the first two is what keeps the list cheap: showing you a
dozen titles reads a dozen small records, not a dozen whole lessons with their
images.

`repoId` is that local id too, right up until the lesson is saved to the cloud,
at which point the repository moves under the hub's id for it and follows the
lesson to your other devices, while its metadata and document stay where they
are. `repoIdFor(lessonId, localId)` is the one place that decides. See
[Version history](/monorepo/version-history) for what that repository holds.

## What each flow does now

| You do this                                | What happens                                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **New lesson** (app header)                | Adds an empty lesson and opens it. Pressing it while already in an untouched one stays put.                                                                                    |
| **Edit** on one of your hub lessons        | Opens the copy this device already has, exactly as you left it; never a second copy of the same lesson, and never overwritten by the cloud's. If the two differ, it tells you. |
| **Fork** a lesson from the hub             | A new lesson, cloned with the original's history, titled "... (copy)".                                                                                                         |
| **Fork into a new lesson** (in the editor) | The same, from the lesson you're in, which stays in the list, still attached to its hub row.                                                                                   |
| **Import** a Word or JSON file             | A new lesson, with a history that starts at the import.                                                                                                                        |
| **Save to cloud** on a device-only lesson  | Attaches it to the hub lesson it creates, and takes its history up with it.                                                                                                    |
| **Join** someone's live session            | Once the host adds you, a new lesson holding the session's document (or the untouched one you're in). It stays in the list after the session ends.                             |

## What this does not do

These lessons are **local**. Nothing here syncs: another browser, another device
or another profile has its own library, and clearing your browsing data clears
it. Saving a lesson to the cloud, published or as a private draft, is what puts
a copy somewhere else, and is the only thing that does. The page says so at the
bottom, for the same reason.

Deleting a lesson that has been saved to the cloud removes only the local copy.
The hub keeps the lesson and its published history, and opening it for editing
again clones that history back down.

Because the copy here is never replaced, it can drift from the cloud one: edits
made on this device and not saved, or edits saved from another. Saving to the
cloud is what settles that: the push refuses to overwrite a lesson that has moved
on since, and offers the same block-by-block merge everything else here uses.

## Where this lives in the code

| File                                      | What it holds                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/core/src/browser/storage.js`    | The library API: list, get, create, save, delete, and the two migrations         |
| `packages/core/src/browser/imageStore.js` | The IndexedDB stores themselves (`lessons`, `lessonDocs`, `images`, `app`)       |
| `apps/web/src/pages/LibraryPage.jsx`      | The page above: renaming, duplicating and deleting                               |
| `apps/web/src/pages/EditorPage.jsx`       | Opening, creating, and saving the lesson on screen before it switches to another |

## Upgrading from the single-document editor

Two migrations run in order the first time the editor or the library page
loads, and both are idempotent:

1. `migrateLocalStorage()`: the pre-IndexedDB draft (a `localStorage` document
   with base64 images) moves into IndexedDB, images becoming binary blobs.
2. `migrateToLibrary()`: that single document becomes the library's first
   lesson, keeping its title, its hub attachment and its fork origin.

The migrated lesson is given the id `draft`, which is not arbitrary: `draft` is
the name the old working lesson's repository already has on disk, and a local
lesson's id _is_ its repo id, so the whole timeline carries across without a
single git object being copied. Lessons made after it get ordinary random ids.
