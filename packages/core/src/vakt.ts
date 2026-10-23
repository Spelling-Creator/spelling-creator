// Shared definitions for the VAKT block — a regulation activity, not a question.
//
// VAKT (visual, auditory, kinaesthetic, tactile) activities are the movement and
// sensory breaks a lesson is punctuated with: "VAKT: Bob likes to do jumping
// jacks. Let's do 3 of those." They are addressed to whoever is running the
// lesson, they are never answered, and they are never scored — which is why they
// are their own block type rather than a seventh question type. Questions carry
// answers, print in the footer legend, and are counted by interactive mode's
// progress; a VAKT activity does none of those things.
//
// Imported by the editor (SectionCard / ContentBlock), the read-only viewer, the
// exporters and the importers, so the colour, the label and the block shape stay
// in sync everywhere.
//
// A VAKT block carries three things:
//   text   the activity itself, in the author's words, without the "VAKT:" label
//          (the label is added by whatever renders the block — see VAKT_LABEL).
//   links  optional outward links: a video to play, a printable, a song. Held as
//          { id, label, url } rows so each has a stable React/collab key.
//   image  an optional picture, referenced by content hash exactly as an image
//          block's is, so it resolves, uploads and exports through the same path,
//          and framed by the same optional `size` / `align` pair.

import { isSafeLink } from "./richText.ts";
import {
  IMAGE_ALIGNS,
  IMAGE_SIZES,
  type ImageAlign,
  type ImageSize,
} from "./image.ts";
import type { VaktBlock, VaktLink } from "./types.ts";

// The accent colour: a bright, unambiguous red — the one colour the question
// types and the teal spelling block deliberately leave free, so a regulation
// break is the thing that jumps off a page of colour-coded prompts. Red at hue 0
// rather than anything warmer: an orange or an amber would collide with the
// `multiple` question type, which is what pushed that type off burnt orange in
// the first place (see questions.ts).
export const VAKT_COLOR = "#ee1111";

// The label every VAKT activity is prefixed with, on screen and in print. Stored
// nowhere: `block.text` holds the activity alone, and each renderer puts the
// label in front of it, the same way the spelling block's "Spell:" works. That
// keeps one authored string from ever carrying two prefixes, and lets the label
// be translated on screen while the export keeps its canonical form.
export const VAKT_LABEL = "VAKT:";

// A leading "VAKT:" the author typed anyway (or that came back in from a DOCX
// import, where the label is part of the paragraph's text). Stripped on the way
// in so the label is never doubled up.
const LEADING_LABEL = /^\s*VAKT\s*:\s*/i;

// What joins a link's label to its URL in print, where a link can't be clicked
// and the address itself has to be readable.
export const VAKT_LINK_JOINER = " — ";

// Where a VAKT block's image starts when the author hasn't framed it. VAKT
// images illustrate an action ("this is what a wall push looks like") rather
// than carrying the lesson's content, so they default smaller than an image
// block's full width — but they are framed with the same `size` and `align`
// fields, and the block offers the same controls, so an activity whose picture
// has to be read from across the room can have one.
export const VAKT_DEFAULT_IMAGE_SIZE = "medium" satisfies ImageSize;
export const VAKT_DEFAULT_IMAGE_ALIGN = "center" satisfies ImageAlign;

/**
 * The size key a VAKT picture is drawn at. Anything unrecognised falls back to
 * the VAKT default rather than to `imageSizeScale`'s full width: a block that
 * never had a size, or whose size arrived corrupted, should look the way VAKT
 * pictures have always looked, not jump to the largest one.
 */
export function vaktImageSize(
  block: Partial<VaktBlock> | null | undefined,
): ImageSize {
  const size = block?.size;
  return (
    IMAGE_SIZES.find((s) => s.key === size)?.key ?? VAKT_DEFAULT_IMAGE_SIZE
  );
}

/** Where a VAKT picture sits, defaulting the same way. */
export function vaktImageAlign(
  block: Partial<VaktBlock> | null | undefined,
): ImageAlign {
  const align = block?.align;
  return IMAGE_ALIGNS.find((a) => a === align) ?? VAKT_DEFAULT_IMAGE_ALIGN;
}

/**
 * A VAKT block seen as an image block: the picture plus the framing the
 * renderers want, with the VAKT defaults filled in. Every renderer draws a VAKT
 * picture by handing this to its own image path, so the two kinds of picture can
 * never drift apart.
 */
export function vaktImageBlock<T extends Partial<VaktBlock>>(
  block: T,
): Omit<T, "size" | "align"> & { size: ImageSize; align: ImageAlign } {
  return {
    ...block,
    size: vaktImageSize(block),
    align: vaktImageAlign(block),
  };
}

// ---------------------------------------------------------------------------
// The Word character style carrying the red, mirroring questionStyleId and
// friends in questions.ts. mammoth drops run colours, so the PDF path (which
// renders the docx as HTML) would print a VAKT activity in plain black without
// this; the DOCX importer reads the label off the text instead, since a
// hand-written document has no style to match on.
// ---------------------------------------------------------------------------

/** The Word style id for a VAKT activity's run. */
export const VAKT_STYLE_ID = "s2cVakt";
/** The Word style *name* — what mammoth matches on in a style map. */
export const VAKT_STYLE_NAME = "S2C VAKT";
/** The HTML class mammoth is told to emit for that style. */
export const VAKT_STYLE_CLASS = "s2c-vakt";

/** The mammoth style-map entry turning the VAKT style back into a tagged span. */
export function vaktStyleMap() {
  return [`r[style-name='${VAKT_STYLE_NAME}'] => span.${VAKT_STYLE_CLASS}`];
}

/** Whether a block is a VAKT activity. */
export function isVaktBlock(
  block: { type?: unknown } | null | undefined,
): boolean {
  return Boolean(block) && block?.type === "vakt";
}

/**
 * Build a fresh, empty VAKT block. `newId` is injected so this stays decoupled
 * from the id helper (same convention as createQuestionBlock/createSpellingBlock).
 * It starts with no links and no image: both are optional extras, and an activity
 * is usually a sentence and nothing else.
 */
export function createVaktBlock(newId: () => string): VaktBlock {
  return { id: newId(), type: "vakt", text: "", links: [] };
}

/** Build a VAKT link row. */
export function createVaktLink(newId: () => string): VaktLink {
  return { id: newId(), label: "", url: "" };
}

/**
 * The activity text alone, with any label the author typed themselves removed so
 * the renderers can put exactly one "VAKT:" in front of it.
 */
export function vaktText(block: { text?: unknown } | null | undefined): string {
  return String(block?.text ?? "")
    .replace(LEADING_LABEL, "")
    .trim();
}

/**
 * The links worth showing: those with a usable, safe destination, in the order
 * the author put them in.
 *
 * `isSafeLink` is the same http/https/mailto rule the comment and bio sanitizers
 * enforce (see richText.ts). A lesson's links are authored rather than
 * user-submitted, but they end up as real `<a href>` in a published page and in
 * an exported Word document, so a `javascript:` or `data:` URL is no more welcome
 * here than in a comment. An unsafe row is dropped at render time rather than
 * refused at edit time, so a half-typed URL never destroys what's in the field.
 */
export function vaktLinks(
  block: { links?: unknown } | null | undefined,
): Array<{ id: unknown; label: string; url: string }> {
  const links: unknown[] = Array.isArray(block?.links) ? block.links : [];
  return links
    .filter(
      (link): link is { id?: unknown; label?: unknown; url: string } =>
        typeof link === "object" &&
        link !== null &&
        "url" in link &&
        typeof link.url === "string" &&
        isSafeLink(link.url),
    )
    .map((link) => ({
      id: link.id,
      label: String(link.label ?? "").trim(),
      url: String(link.url).trim(),
    }));
}

/**
 * How a link reads where it can't be clicked — a printed lesson, a plain-text
 * summary. The label alone would send the reader nowhere, so the address is
 * always spelled out; a link with no label is just its address.
 */
export function vaktLinkText(
  link: { label?: unknown; url?: unknown } | null | undefined,
): string {
  const label = String(link?.label ?? "").trim();
  const url = String(link?.url ?? "").trim();
  return label ? `${label}${VAKT_LINK_JOINER}${url}` : url;
}

/**
 * Whether a VAKT block holds anything at all. An activity with no text, no links
 * and no image is an empty row the author never filled in — importers drop it
 * rather than carrying a blank red card into the lesson.
 */
export function vaktHasContent(
  block:
    | { text?: unknown; links?: unknown; image?: unknown; src?: unknown }
    | null
    | undefined,
): boolean {
  return Boolean(
    vaktText(block) ||
    vaktLinks(block).length > 0 ||
    block?.image ||
    block?.src,
  );
}
