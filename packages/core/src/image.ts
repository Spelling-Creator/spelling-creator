// Image sizing — the numbers the editor preview, the docx export and the
// PDF/preview HTML all scale from, so a picked size looks consistent everywhere.
//
// Pure arithmetic, deliberately kept out of the browser tier: the import/export
// paths and the lesson-file parser need these constants, and none of them should
// have to pull in a module that touches a <canvas>. Reading a File and encoding
// it lives in ./browser/imageFile.ts instead.

// Selectable image sizes, expressed as a fraction of the available width.
// "full" is the default and matches the original (un-scaled) behaviour for
// older lessons.
export const IMAGE_SIZES = [
  { key: "small", label: "Small", scale: 0.4 },
  { key: "medium", label: "Medium", scale: 0.65 },
  { key: "large", label: "Large", scale: 0.85 },
  { key: "full", label: "Full", scale: 1 },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  scale: number;
}>;

export type ImageSize = (typeof IMAGE_SIZES)[number]["key"];

// Where an image sits across the width it doesn't fill. One list, so the editor
// toggles, the importers and the MCP server all agree on what a valid alignment
// is instead of each spelling out its own three strings.
export const IMAGE_ALIGNS = ["left", "center", "right"] as const;

export type ImageAlign = (typeof IMAGE_ALIGNS)[number];

/**
 * The short extension an image block stores for a mime type. The one copy of
 * this rule: the web editor (browser/imageRef.ts), the Worker
 * (apps/api/src/lib/images.js) and the MCP server all take it from here, so a
 * block built anywhere carries the same ext for the same mime.
 *
 * The exts are the ones the docx export's ImageRun accepts (png, jpg, gif,
 * bmp). webp, svg and anything unknown map to png: the export transcodes webp
 * bytes to PNG to match (see getImageBytes in browser/imageRef.ts).
 */
export function extFromMime(mime: string | null | undefined): string {
  const raw = (mime || "").toLowerCase().replace(/^image\//, "");
  if (raw === "jpeg") return "jpg";
  if (["png", "jpg", "gif", "bmp"].includes(raw)) return raw;
  return "png";
}

/**
 * The largest picture the hub stores. The Worker refuses an upload above it
 * (apps/api/src/lib/images.js), and the editor refuses to keep a picture it
 * could never upload, such as one copied from another instance.
 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const DEFAULT_IMAGE_SIZE = "full" satisfies ImageSize;
export const DEFAULT_IMAGE_ALIGN = "center" satisfies ImageAlign;

export function imageSizeScale(size: unknown): number {
  const found = IMAGE_SIZES.find((s) => s.key === size);
  return found ? found.scale : 1; // unknown / missing → full width
}

// Fit an image inside a max width (in px) while preserving aspect ratio.
export function fitWithin(
  width: number | null | undefined,
  height: number | null | undefined,
  maxWidth: number,
): { width: number; height: number } {
  if (!width || !height) return { width: maxWidth, height: maxWidth };
  if (width <= maxWidth) return { width, height };
  const scale = maxWidth / width;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}
