// Small image helpers for the API client (api.js, which uploads bytes). Kept
// dependency-free and using Web Crypto so they work on both transports (Node ≥18
// and the Worker).
//
// An image block references its bytes by content hash, exactly like the web app
// (see apps/web/src/lib/imageRef.js):  image: { hash, mime, ext }. The hash is the
// lowercase-hex SHA-256 of the raw bytes, which is also the R2 object key the
// Worker stores them under and recomputes on upload (PUT /images/:hash).

// Lowercase hex SHA-256 of the given bytes — the content address used as the R2
// object key, so a hash computed here matches the one the Worker recomputes.
export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// The short extension the editor stores on the block. It lives in core because
// the doc builder (core's lessonBuild.js) needs it too.
export { extFromMime } from "@spelling-creator/core/image";
