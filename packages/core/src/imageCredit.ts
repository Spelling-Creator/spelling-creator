// An image's caption and its credit, kept apart.
//
// A picture from Pixabay or Wikimedia Commons comes with a credit line its
// license asks for ("Image (by Jane Doe, CC BY-SA 4.0) via Wikimedia Commons").
// That line used to be written into the block's `caption`, which meant it was
// read aloud to the speller, used as the picture's alt text, machine-translated
// and fed to the summarizer, and that an author who rewrote the caption deleted
// the credit with it. Image blocks (and VAKT blocks carrying a picture) now hold
// it separately, in `credit`.
//
// Lessons saved before that still have the credit in `caption`. Rather than
// rewrite every stored lesson (which would show up as an edit to every image in
// version history, and race collaborators in a live session), the split is made
// when a block is read: imageCaptionParts recognizes the credit lines this app
// itself wrote and moves them out of the caption. The first time someone edits
// either field in the editor, both are written back explicitly and the block no
// longer needs the guess.
//
// Nothing in this module may touch the DOM: the MCP server and the Worker
// import it too.

export interface CaptionParts {
  caption: string;
  credit: string;
}

/** The fields this module reads off a block that may carry a picture. */
interface CaptionFields {
  caption?: unknown;
  credit?: unknown;
}

// One pair of parentheses, which may hold one more pair inside it ("(by John
// Smith (NASA), Public domain)"). Balanced rather than greedy, so a caption
// that opens with "Image (cute) of a dog." isn't swallowed up to a credit
// further along.
const PARENS = String.raw`\((?:[^()]|\([^()]*\))*\)`;

// The credit lines this app has written into captions, as the whole tail of
// one. Each is strict about the words between "Image" and the source, so a
// caption that merely starts with "Image of..." isn't taken for a credit. An
// author may have wrapped the credit in brackets ("Lions (Image from
// Pixabay)"), so one closing bracket may follow it.
//
//   Image (by Jane Doe, CC BY-SA 4.0) via Wikimedia Commons   (current)
//   Image by Jane Doe via Wikimedia Commons                   (older)
//   Image by jdoe from Pixabay / Image from Pixabay
const LEGACY_CREDIT = new RegExp(
  String.raw`(?:^|(?<=[\s.;:,|([-]))` +
    String.raw`(Image(?: ${PARENS}| by [^()]*?)? via Wikimedia Commons|Image(?: by [^()]*?)? from Pixabay)` +
    String.raw`\.?[)\]]?\.?\s*$`,
);

// Separators an author may have put between their own caption and the credit
// they kept after it ("A red panda. Image (by...) via Wikimedia Commons"),
// including the opening bracket of a credit they wrapped in brackets.
const TRAILING_SEPARATOR = /[\s,;:|([-]+$/;

/**
 * Split a caption written before credits had their own field into the author's
 * caption and the credit line this app appended or wrote for them. A caption
 * with no recognized credit comes back whole, with an empty credit.
 */
export function splitLegacyCredit(caption: unknown): CaptionParts {
  const text = typeof caption === "string" ? caption.trim() : "";
  const match = LEGACY_CREDIT.exec(text);
  if (!match) return { caption: text, credit: "" };
  return {
    caption: text.slice(0, match.index).replace(TRAILING_SEPARATOR, ""),
    credit: match[1],
  };
}

/**
 * The caption and the credit an image block (or a VAKT block's picture) shows.
 *
 * A block with a `credit` field, even an empty one, has already been split, so
 * both fields are taken as they are. An empty credit there means someone
 * removed it on purpose and must not be re-derived from the caption. A block
 * without one is from before the split, and its caption is read with
 * splitLegacyCredit.
 */
export function imageCaptionParts(
  block: CaptionFields | null | undefined,
): CaptionParts {
  if (typeof block?.credit === "string") {
    return {
      caption: typeof block.caption === "string" ? block.caption.trim() : "",
      credit: block.credit.trim(),
    };
  }
  return splitLegacyCredit(block?.caption);
}

/**
 * The block with its caption and credit written out as separate fields, so it
 * no longer relies on the legacy split. Used when either field is edited.
 */
export function withImageCaptionParts<T extends CaptionFields>(
  block: T,
  changes: Partial<CaptionParts> = {},
): Omit<T, keyof CaptionParts> & CaptionParts {
  const parts = imageCaptionParts(block);
  return {
    ...block,
    caption: changes.caption ?? parts.caption,
    credit: changes.credit ?? parts.credit,
  };
}

/**
 * Whether a block carries a picture, and so a caption and credit: every image
 * block, and a VAKT block that has one.
 */
export function hasPicture(
  block: { type?: unknown; image?: unknown; src?: unknown } | null | undefined,
): boolean {
  if (block?.type === "image") return true;
  return block?.type === "vakt" && Boolean(block.image || block.src);
}

/**
 * A block with its caption and credit as separate fields when it carries a
 * picture, and unchanged when it doesn't. For the places a block leaves the
 * app's own renderers, where a reader would otherwise see an older block's
 * combined caption as it's stored: what an assistant is shown (presentDoc)
 * and what a three-way merge compares (git/merge.ts).
 *
 * The editor doesn't apply it on load. Doing so would change every older
 * picture in the stored lesson the moment it was opened, which version
 * history would record as an edit by whoever opened it and a live session
 * would broadcast to everyone in it.
 */
export function withSeparateCredit<
  T extends CaptionFields & { type?: unknown; image?: unknown; src?: unknown },
>(block: T): T {
  // A picture's caption and credit come back as strings, which a block that
  // carries one already holds them as (see Picture in types.ts).
  return hasPicture(block) ? (withImageCaptionParts(block) as T) : block;
}
