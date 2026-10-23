// IndexedDB-backed storage for the lessons held on this device and their images.
//
// This replaces the old localStorage doc + flags (which were capped at ~5 MB
// and forced images to be stored as base64). Images live as binary Blobs keyed
// by their SHA-256 content hash (so identical images dedupe automatically); the
// small editor flags live in a key-value store.
//
// The lessons themselves are split across *two* stores, and the split is the
// reason the library can be listed cheaply:
//
//   lessons     one small metadata record per lesson — title, counts, which hub
//               lesson it is attached to, when it was last touched
//   lessonDocs  the documents themselves, keyed by the same id
//
// A lesson document with images and a hundred blocks is not small, and the
// library UI (and the sidebar) only ever want the titles. Keeping the bodies in
// their own store means listing every lesson reads the metadata store and
// nothing else — `getAll` on a store that held the documents too would deserialise
// every one of them to show a list of names.
//
// Everything here is async — IndexedDB has no synchronous API. Callers await.

import type { LessonDoc } from "../types.ts";

/** Image bytes in any of the shapes the store takes. */
export type ImageInput = Blob | ArrayBuffer | ArrayBufferView<ArrayBuffer>;

/** A stored image, keyed by `hash`. */
export interface ImageRecord {
  hash: string;
  blob: Blob;
  mime: string;
  size: number;
  createdAt: number;
}

/**
 * A lesson's library record: the metadata kept beside its document (see
 * storage.ts), keyed by `id`.
 */
export interface LessonRecord {
  /** The lesson's id here, and its git repository's while it is a local draft. */
  id: string;
  title: string;
  /** How many sections and blocks the document has. */
  sections: number;
  blocks: number;
  /** The hub lesson this one is attached to, if any. */
  lessonId: string | null;
  /** Whether that hub lesson is public rather than a private draft. */
  published: boolean;
  /** The hub lesson this one was forked from. */
  forkedFrom: string | null;
  /** Or the address of the page on another instance it was forked from. */
  forkedFromUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

const DB_NAME = "s2c-lesson-maker";
// v2 added the `lessons` / `lessonDocs` stores — the library. v1 held a single
// working document under the app store's `doc` key; see migrateToLibrary() in
// storage.ts, which moves it across.
const DB_VERSION = 2;
const IMAGE_STORE = "images";
const APP_STORE = "app";
const LESSON_STORE = "lessons";
const LESSON_DOC_STORE = "lessonDocs";

// app-store keys for the bits of editor state that used to live in localStorage.
const DOC_KEY = "doc";
const EDITING_ID_KEY = "editing-id";
const EDITING_PUBLISHED_KEY = "editing-published";
const WIZARD_SEEN_KEY = "wizard-seen";
// The lesson the working doc was forked from, if any. Persisted alongside the
// editing id so a fork still knows where it came from after a reload, and can
// offer to pull the original's later changes in (see git/sync.ts).
const FORKED_FROM_KEY = "forked-from";
// Which lesson in the library is open in the editor.
const CURRENT_LESSON_KEY = "current-lesson";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IMAGE_STORE)) {
        db.createObjectStore(IMAGE_STORE, { keyPath: "hash" });
      }
      if (!db.objectStoreNames.contains(APP_STORE)) {
        db.createObjectStore(APP_STORE);
      }
      if (!db.objectStoreNames.contains(LESSON_STORE)) {
        db.createObjectStore(LESSON_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(LESSON_DOC_STORE)) {
        db.createObjectStore(LESSON_DOC_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  // An open that failed (storage refused, another tab mid-upgrade) isn't kept:
  // the caller still sees it fail, and the next call tries again rather than
  // every read and write failing for the rest of the page's life.
  dbPromise = opening;
  opening.catch(() => {
    if (dbPromise === opening) dbPromise = null;
  });
  return opening;
}

function store(db: IDBDatabase, name: string, mode: IDBTransactionMode) {
  return db.transaction(name, mode).objectStore(name);
}

// IndexedDB types what a store gives back as `any`; the caller names what it
// stored there.
function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Normalise any supported image input (Blob / ArrayBuffer / typed array) to a
// Uint8Array we can both hash and wrap in a Blob.
async function toBytes(input: ImageInput): Promise<Uint8Array<ArrayBuffer>> {
  if (input instanceof Blob) return new Uint8Array(await input.arrayBuffer());
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new Error("Unsupported image data type.");
}

// Lowercase hex SHA-256 of the given bytes — the content-address used as both
// the IndexedDB key and the R2 object key, so a hash computed here matches one
// the Worker recomputes from the same bytes.
export async function sha256Hex(input: ImageInput): Promise<string> {
  const bytes = await toBytes(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---- image blobs -----------------------------------------------------------

// Store image bytes and return their content hash. Idempotent: identical bytes
// map to the same hash and are stored only once.
export async function putImageBlob(
  input: ImageInput,
  mime?: string | null,
): Promise<string> {
  const bytes = await toBytes(input);
  const hash = await sha256Hex(bytes);
  if (await hasImageBlob(hash)) return hash;
  const type = mime || "application/octet-stream";
  const blob = new Blob([bytes], { type });
  const db = await openDb();
  await reqToPromise(
    store(db, IMAGE_STORE, "readwrite").put({
      hash,
      blob,
      mime: type,
      size: bytes.byteLength,
      createdAt: Date.now(),
    } satisfies ImageRecord),
  );
  return hash;
}

export async function getImageBlob(
  hash: string | null | undefined,
): Promise<Blob | null> {
  if (!hash) return null;
  try {
    const db = await openDb();
    const rec = await reqToPromise<ImageRecord | undefined>(
      store(db, IMAGE_STORE, "readonly").get(hash),
    );
    return rec ? rec.blob : null;
  } catch {
    return null;
  }
}

export async function hasImageBlob(
  hash: string | null | undefined,
): Promise<boolean> {
  if (!hash) return false;
  try {
    const db = await openDb();
    const key = await reqToPromise(
      store(db, IMAGE_STORE, "readonly").getKey(hash),
    );
    return key !== undefined;
  } catch {
    return false;
  }
}

// Every image hash currently held locally — handy for a future garbage-collect
// of blobs no longer referenced by any doc.
export async function getAllImageHashes(): Promise<Set<string>> {
  try {
    const db = await openDb();
    const keys = await reqToPromise(
      store(db, IMAGE_STORE, "readonly").getAllKeys(),
    );
    // The store's keys are its records' hashes.
    return new Set(keys as string[]);
  } catch {
    return new Set();
  }
}

// ---- app state (replaces the old localStorage storage.js) ------------------

// What each app-store key holds.
interface AppState {
  [DOC_KEY]: LessonDoc;
  [EDITING_ID_KEY]: string;
  [EDITING_PUBLISHED_KEY]: boolean;
  [WIZARD_SEEN_KEY]: boolean;
  [FORKED_FROM_KEY]: string;
  [CURRENT_LESSON_KEY]: string;
}

async function appGet<K extends keyof AppState>(
  key: K,
): Promise<AppState[K] | undefined> {
  const db = await openDb();
  return reqToPromise(store(db, APP_STORE, "readonly").get(key));
}

async function appSet<K extends keyof AppState>(key: K, value: AppState[K]) {
  const db = await openDb();
  await reqToPromise(store(db, APP_STORE, "readwrite").put(value, key));
}

async function appDelete(key: keyof AppState) {
  const db = await openDb();
  await reqToPromise(store(db, APP_STORE, "readwrite").delete(key));
}

export async function loadDocument(): Promise<LessonDoc | null> {
  try {
    return (await appGet(DOC_KEY)) || null;
  } catch {
    return null;
  }
}

export async function saveDocument(doc: LessonDoc): Promise<void> {
  try {
    await appSet(DOC_KEY, doc);
  } catch {
    // Quota errors are non-fatal — the in-memory doc still works.
  }
}

export async function clearDocument(): Promise<void> {
  try {
    await appDelete(DOC_KEY);
  } catch {
    /* ignore */
  }
}

export async function loadEditingId(): Promise<string | null> {
  try {
    return (await appGet(EDITING_ID_KEY)) || null;
  } catch {
    return null;
  }
}

export async function saveEditingId(
  id: string | null | undefined,
): Promise<void> {
  try {
    if (id) await appSet(EDITING_ID_KEY, id);
    else await appDelete(EDITING_ID_KEY);
  } catch {
    /* ignore */
  }
}

export async function loadForkedFrom(): Promise<string | null> {
  try {
    return (await appGet(FORKED_FROM_KEY)) || null;
  } catch {
    return null;
  }
}

export async function saveForkedFrom(
  id: string | null | undefined,
): Promise<void> {
  try {
    if (id) await appSet(FORKED_FROM_KEY, id);
    else await appDelete(FORKED_FROM_KEY);
  } catch {
    /* ignore */
  }
}

// Returns true when no flag is stored, matching the pre-draft behaviour where
// every saved lesson was published.
export async function loadEditingPublished(): Promise<boolean> {
  try {
    return (await appGet(EDITING_PUBLISHED_KEY)) !== false;
  } catch {
    return true;
  }
}

export async function saveEditingPublished(
  published: boolean | null | undefined,
): Promise<void> {
  try {
    if (published === null || published === undefined) {
      await appDelete(EDITING_PUBLISHED_KEY);
    } else {
      await appSet(EDITING_PUBLISHED_KEY, Boolean(published));
    }
  } catch {
    /* ignore */
  }
}

export async function loadWizardSeen(): Promise<boolean> {
  try {
    return (await appGet(WIZARD_SEEN_KEY)) === true;
  } catch {
    // Treat an unreadable store as "already seen" so we never nag in a loop.
    return true;
  }
}

export async function saveWizardSeen(): Promise<void> {
  try {
    await appSet(WIZARD_SEEN_KEY, true);
  } catch {
    /* ignore — the wizard just shows again next visit */
  }
}

// ---- the lesson library ----------------------------------------------------
//
// Raw store access, no policy: storage.ts layers the library API (titles,
// counts, timestamps, the current lesson) on top of these. Every one of them
// swallows a failed transaction and answers with "nothing", because a browser
// that has denied us IndexedDB (private mode, a full disk) must still let the
// editor run against an in-memory document.

/** Every lesson's metadata record, in no particular order. */
export async function listLessonRecords(): Promise<LessonRecord[]> {
  try {
    const db = await openDb();
    return (
      (await reqToPromise<LessonRecord[]>(
        store(db, LESSON_STORE, "readonly").getAll(),
      )) || []
    );
  } catch {
    return [];
  }
}

export async function getLessonRecord(
  id: string | null | undefined,
): Promise<LessonRecord | null> {
  if (!id) return null;
  try {
    const db = await openDb();
    return (
      (await reqToPromise<LessonRecord | undefined>(
        store(db, LESSON_STORE, "readonly").get(id),
      )) || null
    );
  } catch {
    return null;
  }
}

/**
 * Read-modify-write a lesson's record — and, when `doc` is given, store that
 * document in the *same* transaction.
 *
 * The single transaction is the point. A lesson's title and block counts are
 * derived from its document, while its hub attachment is set from somewhere else
 * entirely, and the editor writes both on their own schedules: a debounced save
 * as you type, and a metadata write the moment a lesson is published. Done as
 * separate get-then-put pairs, the save that read first could put its stale copy
 * back last and quietly drop the lesson's brand-new hub id. IndexedDB serialises
 * overlapping readwrite transactions over the same store, so doing the read and
 * the write inside one makes each update see the previous one's result.
 *
 * It is also the deletion guard: `derive` is never called, and nothing is
 * written, when the record is already gone — so a save still in flight when its
 * lesson is deleted cannot resurrect it.
 *
 * `derive` must be synchronous; awaiting anything else would let the transaction
 * close underneath it.
 */
export async function updateLessonRecord(
  id: string | null | undefined,
  derive: (record: LessonRecord) => LessonRecord,
  doc?: LessonDoc,
): Promise<LessonRecord | null> {
  if (!id) return null;
  try {
    const db = await openDb();
    const tx = db.transaction([LESSON_STORE, LESSON_DOC_STORE], "readwrite");
    const record = await reqToPromise<LessonRecord | undefined>(
      tx.objectStore(LESSON_STORE).get(id),
    );
    if (!record) return null;
    const next = derive(record);
    if (doc !== undefined) tx.objectStore(LESSON_DOC_STORE).put(doc, id);
    tx.objectStore(LESSON_STORE).put(next);
    return next;
  } catch {
    // Quota errors and the like are non-fatal — the in-memory lesson still works.
    return null;
  }
}

export async function putLessonRecord(record: LessonRecord): Promise<void> {
  try {
    const db = await openDb();
    await reqToPromise(store(db, LESSON_STORE, "readwrite").put(record));
  } catch {
    /* ignore — the in-memory lesson still works */
  }
}

export async function deleteLessonRecord(
  id: string | null | undefined,
): Promise<void> {
  if (!id) return;
  try {
    const db = await openDb();
    await reqToPromise(store(db, LESSON_STORE, "readwrite").delete(id));
  } catch {
    /* ignore */
  }
}

/** One lesson's document, or null when it has none stored yet. */
export async function getLessonDoc(
  id: string | null | undefined,
): Promise<LessonDoc | null> {
  if (!id) return null;
  try {
    const db = await openDb();
    return (
      (await reqToPromise<LessonDoc | undefined>(
        store(db, LESSON_DOC_STORE, "readonly").get(id),
      )) || null
    );
  } catch {
    return null;
  }
}

export async function putLessonDoc(
  id: string | null | undefined,
  doc: LessonDoc,
): Promise<void> {
  if (!id) return;
  try {
    const db = await openDb();
    await reqToPromise(store(db, LESSON_DOC_STORE, "readwrite").put(doc, id));
  } catch {
    // Quota errors are non-fatal — the in-memory doc still works.
  }
}

export async function deleteLessonDoc(
  id: string | null | undefined,
): Promise<void> {
  if (!id) return;
  try {
    const db = await openDb();
    await reqToPromise(store(db, LESSON_DOC_STORE, "readwrite").delete(id));
  } catch {
    /* ignore */
  }
}

/** The library lesson the editor is on, so a reload comes back to it. */
export async function loadCurrentLessonId(): Promise<string | null> {
  try {
    return (await appGet(CURRENT_LESSON_KEY)) || null;
  } catch {
    return null;
  }
}

export async function saveCurrentLessonId(
  id: string | null | undefined,
): Promise<void> {
  try {
    if (id) await appSet(CURRENT_LESSON_KEY, id);
    else await appDelete(CURRENT_LESSON_KEY);
  } catch {
    /* ignore */
  }
}
