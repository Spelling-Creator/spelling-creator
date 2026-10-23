// The CRDT model behind live collaboration: a bridge between the editor's plain
// JSON document ({ title, sections: [{ id, name, blocks: [...] }] }) and a Yjs
// document, so concurrent edits merge instead of clobbering each other.
//
// Why a bridge rather than making Yjs the editor's state? Because EditorPage —
// and every exporter, importer and preview that reads a lesson — works on plain
// objects. Rewriting all of that to read Y types would be an enormous change for
// no user-visible gain. Instead the plain doc stays the source of truth for
// rendering, and this module keeps a Y.Doc in step with it:
//
//   local edit  -> setDoc(next) -> reconcile(ydoc, next) -> Yjs emits an update
//   remote edit -> Y.applyUpdate -> docFromY(ydoc) -> setDoc
//
// The critical property is that `reconcile` is IDEMPOTENT: reconciling a Y.Doc
// against a document it already matches performs no operations, so Yjs emits no
// update. That is what stops the round-trip above from looping forever — the
// remote branch's setDoc re-runs reconcile, which finds nothing to do, and the
// cycle terminates on its own. (It's also why every write below is guarded by a
// comparison: Y.Map.set() records a change even when the value is identical.)
//
// Merge granularity. Text is stored as a plain string, so two people editing the
// *same* field is still last-write-wins. Two people editing *different* blocks,
// sections or fields — the case that actually breaks today — merges cleanly.
// Upgrading a field to character-level merging means making it a Y.Text; the
// scalar path in `reconcileKey` is the only place that would need to change.

import * as Y from "yjs";

import { isRecord } from "./guards.ts";
import type { LessonDoc } from "./types.ts";

// The Y.Doc's root map, holding the whole lesson document.
export const ROOT = "lesson";

// Transaction origins. A Yjs update carries the origin of the transaction that
// produced it, which is how we tell our own edits (broadcast them) from ones we
// just received (don't echo them back).
export const LOCAL = "local";
export const REMOTE = "remote";

function isYType(v: unknown): v is Y.Map<unknown> | Y.Array<unknown> | Y.Text {
  return v instanceof Y.Map || v instanceof Y.Array || v instanceof Y.Text;
}

/**
 * The stable identity of an item in a list, or null if it has none.
 *
 * Sections, blocks, spelling words and question answers all already carry a
 * unique `id`, which is what lets us match items across edits (rather than by
 * position, which would make every insert look like a rewrite of the tail).
 * Entries with no id are matched by email instead — this module stays generic
 * about what it is handed. (The app does not in fact send it the lesson's
 * trusted-collaborator list: those are email addresses, and the room is mirrored
 * to everyone the host admits, so lib/collab.js strips the field before
 * reconciling. See stripLocalFields in git/doc.ts.)
 */
export function keyOf(item: unknown): string | null {
  if (!isRecord(item)) return null;
  if (typeof item.id === "string" && item.id) return item.id;
  if (typeof item.email === "string" && item.email.trim()) {
    return item.email.trim().toLowerCase();
  }
  return null;
}

// The same identity, read from a Y.Map without materialising the whole subtree
// (keyOf(ymap.toJSON()) would deep-convert an entire block just to read its id).
function yKeyOf(v: unknown): string | null {
  if (!(v instanceof Y.Map)) return null;
  const id = v.get("id");
  if (typeof id === "string" && id) return id;
  const email = v.get("email");
  if (typeof email === "string" && email.trim()) {
    return email.trim().toLowerCase();
  }
  return null;
}

// A list we can merge item-by-item: every entry has a stable key. An empty list
// counts (it's the state every lesson starts in, and it must still become a
// Y.Array so the first item added merges rather than replacing the whole list).
// Anything else — a list of bare strings, say — is treated as an opaque value
// and replaced wholesale.
function isKeyedList(arr: unknown[]): boolean {
  return arr.every((item) => keyOf(item) !== null);
}

// Deep-convert a plain value into the Y type that represents it.
function toY(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (!isKeyedList(value)) return value; // opaque: last-write-wins
    const yarr = new Y.Array<unknown>();
    yarr.push(value.map(toY));
    return yarr;
  }
  if (isRecord(value)) {
    const ymap = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(value)) ymap.set(k, toY(v));
    return ymap;
  }
  return value;
}

// Structural equality for the values we store opaquely (primitives, and lists
// with no stable keys). Order matters for those lists, so a JSON comparison is
// both correct and cheap enough at this size.
function sameOpaque(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isYType(a)) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Make `ymap` match `obj`, touching only what actually differs.
 */
function reconcileMap(ymap: Y.Map<unknown>, obj: Record<string, unknown>) {
  for (const k of [...ymap.keys()]) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) ymap.delete(k);
  }
  for (const [k, v] of Object.entries(obj)) reconcileKey(ymap, k, v);
}

function reconcileKey(ymap: Y.Map<unknown>, key: string, value: unknown) {
  const cur = ymap.get(key);

  if (Array.isArray(value) && isKeyedList(value)) {
    if (cur instanceof Y.Array) reconcileArray(cur, value);
    else ymap.set(key, toY(value));
    return;
  }

  if (isRecord(value)) {
    if (cur instanceof Y.Map) reconcileMap(cur, value);
    else ymap.set(key, toY(value));
    return;
  }

  // A scalar, or an opaque list. Only write when it genuinely changed — an
  // unguarded set() would make every reconcile emit an update and the sync loop
  // would never settle.
  if (!sameOpaque(cur, value)) ymap.set(key, toY(value));
}

/**
 * Make the Y.Array `yarr` match the plain list `items`, matching entries by
 * their stable key so an edit to one item never disturbs its neighbours.
 */
function reconcileArray(yarr: Y.Array<unknown>, items: unknown[]) {
  const targetKeys = items.map(keyOf);
  const wanted = new Set(targetKeys);

  // Pass 1 — drop entries that are gone, malformed, or duplicated.
  //
  // Duplicates are not paranoia: Yjs has no move operation, so reordering an
  // item is expressed as delete-then-insert. If two people reorder the same item
  // concurrently, both inserts survive the merge and the item appears twice.
  // Healing that here (and in docFromY, for a peer that never edits) is what
  // keeps drag-and-drop safe under collaboration.
  const seen = new Set<string>();
  const doomed: number[] = [];
  for (let i = 0; i < yarr.length; i++) {
    const k = yKeyOf(yarr.get(i));
    if (k === null || !wanted.has(k) || seen.has(k)) doomed.push(i);
    else seen.add(k);
  }
  for (let i = doomed.length - 1; i >= 0; i--) yarr.delete(doomed[i], 1);

  // Pass 2 — align positions: insert what's new, move what's out of order.
  for (let i = 0; i < items.length; i++) {
    const want = targetKeys[i];
    if (i < yarr.length && yKeyOf(yarr.get(i)) === want) continue;

    let at = -1;
    for (let j = i + 1; j < yarr.length; j++) {
      if (yKeyOf(yarr.get(j)) === want) {
        at = j;
        break;
      }
    }
    if (at >= 0) {
      // yKeyOf found a key on it, and only a Y.Map has one.
      const moved = (yarr.get(at) as Y.Map<unknown>).toJSON();
      yarr.delete(at, 1);
      yarr.insert(i, [toY(moved)]);
    } else {
      yarr.insert(i, [toY(items[i])]);
    }
  }

  // Pass 3 — recurse. Positions now line up, so each entry reconciles against
  // its counterpart.
  for (let i = 0; i < items.length; i++) {
    const cur = yarr.get(i);
    const item = items[i];
    if (cur instanceof Y.Map && isRecord(item)) {
      reconcileMap(cur, item);
    }
  }
}

/**
 * Push the editor's plain document into `ydoc`.
 *
 * Runs as a single transaction, so a burst of changes produces one Yjs update
 * rather than one per field. Emits no update at all when `doc` already matches
 * what the Y.Doc holds — see the note on idempotency at the top of this file.
 *
 * @param doc     The editor document ({ title, sections, ... }), a LessonDoc
 *                in practice. Any plain object will do, since nothing here
 *                knows the lesson's schema.
 * @param origin  Transaction origin; LOCAL edits are the ones we broadcast.
 */
export function reconcile(
  ydoc: Y.Doc,
  doc: object,
  origin: string = LOCAL,
): void {
  ydoc.transact(() => {
    reconcileMap(ydoc.getMap(ROOT), isRecord(doc) ? doc : {});
  }, origin);
}

// Strip duplicate-keyed entries from a plain tree. The reconcile pass above heals
// them in the Y.Doc, but a peer that only *receives* edits never reconciles, so
// the read path has to heal them too or a concurrent reorder would show them a
// doubled block.
function dedupe(value: unknown): unknown {
  if (Array.isArray(value)) {
    const seen = new Set<string>();
    const out: unknown[] = [];
    for (const item of value) {
      const k = keyOf(item);
      if (k !== null) {
        if (seen.has(k)) continue;
        seen.add(k);
      }
      out.push(dedupe(item));
    }
    return out;
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = dedupe(v);
    return out;
  }
  return value;
}

/**
 * Read the Y.Doc back out as the plain document the editor renders.
 *
 * Typed as the lesson because that is what every caller reconciles in. The
 * bridge itself checks nothing: a Y.Doc nobody has reconciled reads as `{}`.
 */
export function docFromY(ydoc: Y.Doc): LessonDoc {
  return dedupe(ydoc.getMap(ROOT).toJSON()) as LessonDoc;
}

/**
 * The whole Y.Doc as one update — used to seed a room and to hand the current
 * lesson to someone the host has just admitted.
 */
export function encodeState(ydoc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(ydoc);
}

/**
 * Merge an update received from the room. Tagged REMOTE so the update handler
 * knows not to echo it back to the sender.
 */
export function applyRemote(ydoc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(ydoc, update, REMOTE);
}
