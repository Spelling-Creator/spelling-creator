---
title: Lessons on this device
---

# Lessons on this device

For how to use this, see [Lessons on this device](../../guide/local-lessons.md).

The editor holds **as many lessons as you make**. They live in this browser, in
IndexedDB, and they are listed on a page of their own at `/library`, reached from
**On this device** in the app header, the **Lessons** button in the editor's top
bar, or **Manage lessons** in Settings.

Nothing you are working on is ever replaced. That is the whole point of the
feature, and it used to be the opposite: the editor kept exactly **one** working
document, so opening a lesson from the hub, forking one, or importing a Word
file all overwrote whatever was on screen, and each of those flows needed a
"Replace your current work?" dialog to warn you first. Those dialogs are gone,
because there is nothing left to replace.

## The library page

`LibraryPage` works on the library directly, with the editor not mounted at
all, so there is nothing on screen to save first. Opening a lesson sets it as
the editor's current lesson and goes to `/editor`, which loads it on mount.
**New lesson** goes to `/editor?new=1`, so the editor can reuse an untouched
lesson instead of making another empty one. Deleting the lesson the editor last
had open is fine too: next time, the editor opens the most recent one left, or
starts a fresh one if there are none.

**Duplicate** clones the lesson's [version history](../version-history.md) along
with it, and the copy is unattached to the hub. **Delete from this device**
removes the metadata record, the document and the repository, after a second
confirmation ("Delete forever").

This used to be a dialog over the editor at `/editor/lessons`. That address now
redirects to `/library` (see `App.jsx`), so old links still work.

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
at which point the repository moves under the hub's id for it (`adoptDraftRepo`
in `packages/core/src/browser/git/fs.ts`) and follows the lesson to your other
devices, while its metadata and document stay where they are.
`repoIdFor(lessonId, localId)` in `packages/core/src/git/doc.ts` is the one
place that decides. See [Version history](../version-history.md) for what that
repository holds.

## How each flow uses the library

- **Edit** on one of your hub lessons reuses the copy this device already has
  and never overwrites it with the cloud's; if the two differ, the editor says
  so (`messages.loadedLocalCopyDiffers`).
- **Fork** (from the hub) and **Fork into a new lesson** (`handleFork`) create a
  new library record with the original's history cloned in.
- **Import** creates a new record whose history starts at the import.
- **Save to cloud** on a device-only lesson attaches it to the new hub row and
  pushes its history. The push refuses to overwrite a lesson that has moved on
  since, and offers the same block-by-block merge used everywhere else.
- **Joining a live session**: `openSessionLesson` makes a new lesson for the
  session's document once the host admits you, or reuses an untouched one.

## Where this lives in the code

| File                                      | What it holds                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/core/src/browser/storage.ts`    | The library API: list, get, create, save, delete, and the two migrations         |
| `packages/core/src/browser/imageStore.ts` | The IndexedDB stores themselves (`lessons`, `lessonDocs`, `images`, `app`)       |
| `packages/core/src/browser/git/fs.ts`     | The LightningFS layout, and moving a draft repository under its hub id           |
| `apps/web/src/pages/LibraryPage.jsx`      | The library page: opening, renaming, duplicating and deleting                    |
| `apps/web/src/pages/EditorPage.jsx`       | Opening, creating, and saving the lesson on screen before it switches to another |

## Upgrading from the single-document editor

Two migrations run in order the first time the editor or the library page
loads, and both are idempotent:

1. `migrateLocalStorage()`: the pre-IndexedDB draft (a `localStorage` document
   with base64 images) moves into IndexedDB, images becoming binary blobs.
2. `migrateToLibrary()`: that single document becomes the library's first
   lesson, keeping its title, its hub attachment and its fork origin.

The migrated lesson is given the id `draft`, which is not arbitrary: `draft` is
the name the old working lesson's repository already has on disk (`DRAFT_REPO`
in `packages/core/src/git/doc.ts`), and a local lesson's id _is_ its repo id, so
the whole timeline carries across without a single git object being copied.
Lessons made after it get ordinary random ids.
