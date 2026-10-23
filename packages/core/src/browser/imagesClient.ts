// Uploads a lesson's images to the Worker (R2-backed) before the lesson doc is
// saved to the cloud. Images live only in IndexedDB while a lesson is drafted
// offline; this is what copies them to the cloud so other viewers (and the
// server-side og-image/prerender) can load them by hash.
import { hasApi } from "../config.ts";
import { MAX_IMAGE_BYTES } from "../image.ts";
import type { ImageRef, LessonDoc } from "../types.ts";
import { findImageBlob } from "./imageStore.ts";
import { imagePublicUrl, storeImageBytes } from "./imageRef.ts";

// Hashes already confirmed present in R2 this session (uploaded, or known to be
// cloud-sourced). Lets repeated saves of the same lesson skip re-PUTting every
// image — keeping R2 write (class-A) operations ≈ the number of distinct images,
// not number of saves.
const known = new Set<string>();

// Every distinct image hash referenced by the doc. Legacy `src` blocks must be
// converted to refs (convertDocImages) before calling this.
//
// Image blocks aren't the only thing holding a picture: a VAKT activity can carry
// one too, in the same `{ image: { hash } }` shape. Missing those here would save
// a lesson whose activity image exists only in the author's own IndexedDB, so it
// would show for them and be a broken frame for everyone else.
export function collectImageHashes(
  doc: Partial<LessonDoc> | null | undefined,
): string[] {
  const hashes = new Set<string>();
  for (const section of doc?.sections || []) {
    for (const block of section.blocks || []) {
      if (
        (block.type === "image" || block.type === "vakt") &&
        block.image?.hash
      ) {
        hashes.add(block.image.hash);
      }
    }
  }
  return [...hashes];
}

// PUT one blob to R2. The endpoint is content-addressed and idempotent, so a
// re-upload of identical bytes is harmless.
async function uploadImage(hash: string, blob: Blob, accessToken: string) {
  let res: Response;
  try {
    res = await fetch(imagePublicUrl(hash), {
      method: "PUT",
      headers: {
        "Content-Type": blob.type || "application/octet-stream",
        Authorization: `Bearer ${accessToken}`,
      },
      body: blob,
    });
  } catch {
    throw new Error("Could not reach the image store.");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Image upload failed (${res.status}).`);
  }
}

// Ensure every image referenced by the doc exists in R2, uploading any blob that
// is currently only local. Throws on the first failure so the caller aborts the
// save before writing a doc row that would reference a missing object.
export async function ensureImagesUploaded(
  doc: Partial<LessonDoc> | null | undefined,
  accessToken: string | null | undefined,
): Promise<void> {
  if (!hasApi()) throw new Error("The image store is not configured.");
  if (!accessToken) throw new Error("Please sign in before saving.");
  for (const hash of collectImageHashes(doc)) {
    if (known.has(hash)) continue;
    // A store that can't be read is not the same as a picture this device
    // doesn't hold: taking it for one would save the lesson pointing at a
    // picture that never reached R2, and remember it as uploaded.
    let blob: Blob | null;
    try {
      blob = await findImageBlob(hash);
    } catch {
      throw new Error(
        "This device's copy of the lesson's pictures couldn't be read. Please try again.",
      );
    }
    // No local blob means the image came from the cloud already (an existing
    // lesson's image) — it's in R2, nothing to upload.
    if (!blob) {
      known.add(hash);
      continue;
    }
    // The Worker refuses a picture over the limit, so say so before sending
    // it all (one stored before the limit was enforced, say).
    if (blob.size > MAX_IMAGE_BYTES) {
      throw new Error(
        `Image is too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB).`,
      );
    }
    await uploadImage(hash, blob, accessToken);
    known.add(hash);
  }
}

// How many pictures are fetched from another instance at once.
const COPY_CONCURRENCY = 4;

// Fetch one picture from another instance and keep it here, returning its new
// ref. Only what this hub's own upload accepts is kept: an image type, within
// the size limit. A picture kept here is uploaded on every save until it
// lands, so an `application/octet-stream` object or an error page kept as one
// would make every later save of the fork fail on it.
async function copyRemoteImage(base: string, hash: string): Promise<ImageRef> {
  const res = await fetch(`${base}/images/${hash}`);
  if (!res.ok) throw new Error(`Image fetch failed (${res.status}).`);
  const type = (res.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!type.startsWith("image/")) {
    throw new Error(`Not an image (${type || "no type"}).`);
  }
  if (Number(res.headers.get("content-length") || 0) > MAX_IMAGE_BYTES) {
    throw new Error("Image is too large.");
  }
  const blob = await res.blob();
  if (blob.size === 0 || blob.size > MAX_IMAGE_BYTES) {
    throw new Error("Image is empty or too large.");
  }
  return storeImageBytes(blob, type);
}

/**
 * Bring the pictures of a lesson forked from another instance over here.
 *
 * The document's image refs point at that instance's store, which this hub
 * knows nothing about, so each picture (every one collectImageHashes finds)
 * is fetched from there, a few at a time (an instance's image route answers
 * any origin, as ours does), kept locally like a picture the user added, and
 * referenced by the hash of what was kept. That is what lets the normal
 * save-to-cloud upload it here under a hash the server can verify. The hash
 * usually differs from the old one, because the other instance serves the
 * compressed form it stored; when it stored the original, it comes out the
 * same.
 *
 * A picture that cannot be fetched, is not an image this hub would accept, or
 * cannot be stored keeps its old ref and is counted in `failed`, rather than
 * failing the fork. Storing hashes with `crypto.subtle`, which a browser only
 * offers on a secure origin, so on an instance served over plain http at a
 * network address no picture can be copied (or added at all).
 *
 * @param origin  The other instance's origin, e.g. `https://other.example`.
 */
export async function copyRemoteImages(
  doc: LessonDoc,
  origin: string,
): Promise<{ doc: LessonDoc; copied: number; failed: number }> {
  const base = origin.replace(/\/$/, "");
  const hashes = collectImageHashes(doc);
  const refs = new Map<string, ImageRef>();
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < hashes.length) {
      const hash = hashes[next++];
      try {
        refs.set(hash, await copyRemoteImage(base, hash));
      } catch {
        failed += 1;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(COPY_CONCURRENCY, hashes.length) }, worker),
  );
  if (refs.size === 0) return { doc, copied: 0, failed };
  return {
    doc: {
      ...doc,
      sections: doc.sections.map((section) => ({
        ...section,
        blocks: (section.blocks || []).map((block) =>
          block &&
          "image" in block &&
          block.image?.hash &&
          refs.has(block.image.hash)
            ? { ...block, image: refs.get(block.image.hash) }
            : block,
        ),
      })),
    },
    copied: refs.size,
    failed,
  };
}
