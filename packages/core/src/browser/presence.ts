// Helpers for live editing presence: a stable per-collaborator colour and the
// pixel position of a caret inside a <textarea>/<input>, or inside a lesson text
// block's editor (a contenteditable). These power the floating "who's editing
// where" avatars (see components/CollabCursors.jsx).

// A small, visually distinct palette. Each collaborator is mapped to one colour
// by hashing their stable id, so the same person keeps the same colour across
// their floating cursor and the roster avatar in CollaborateDialog.
const PALETTE = [
  "#e53935",
  "#8e24aa",
  "#3949ab",
  "#039be5",
  "#00897b",
  "#7cb342",
  "#fb8c00",
  "#6d4c41",
  "#d81b60",
  "#5e35b1",
  "#1e88e5",
  "#00acc1",
  "#43a047",
  "#f4511e",
  "#546e7a",
  "#c0ca33",
];

export function colorForId(id) {
  const s = String(id || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// Properties copied onto the mirror element so it lays text out identically to
// the real field. Based on the well-known textarea-caret-position technique.
const MIRROR_PROPS = [
  "direction",
  "boxSizing",
  "width",
  "height",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontSizeAdjust",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "textDecoration",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
  "MozTabSize",
];

/**
 * Pixel coordinates of the caret at `index` within a textarea/input, relative
 * to the element's own top-left (border box). Add the element's
 * getBoundingClientRect() and subtract its scroll offsets to get a viewport
 * position. Works by mirroring the field in an off-screen div and measuring
 * where a marker span lands.
 *
 * @returns {{ left: number, top: number, height: number }}
 */
export function getCaretCoordinates(element, index) {
  const isInput = element.nodeName.toLowerCase() === "input";
  const computed = window.getComputedStyle(element);

  const div = document.createElement("div");
  const style = div.style;
  style.position = "absolute";
  style.visibility = "hidden";
  style.whiteSpace = "pre-wrap";
  if (!isInput) style.wordWrap = "break-word";

  for (const prop of MIRROR_PROPS) {
    if (isInput && prop === "lineHeight") {
      // Single-line inputs render text vertically centred; approximate that by
      // letting the line fill the element's height.
      style.lineHeight = computed.height;
    } else {
      style[prop] = computed[prop];
    }
  }
  // Inputs never wrap and we don't want the mirror to scroll.
  style.overflow = "hidden";

  div.textContent = element.value.substring(0, index);
  // Spaces in a single-line input must not collapse in the mirror.
  if (isInput) div.textContent = div.textContent.replace(/\s/g, " ");

  const span = document.createElement("span");
  // The remaining text gives the span a sensible height; a fallback keeps it
  // non-empty at the very end of the field.
  span.textContent = element.value.substring(index) || ".";
  div.appendChild(span);

  document.body.appendChild(div);
  const coords = {
    left: span.offsetLeft + parseInt(computed.borderLeftWidth, 10),
    top: span.offsetTop + parseInt(computed.borderTopWidth, 10),
    height:
      parseInt(computed.lineHeight, 10) ||
      parseInt(computed.fontSize, 10) ||
      18,
  };
  document.body.removeChild(div);
  return coords;
}

// ---- Carets in a contenteditable -------------------------------------------
//
// A lesson text block is edited in tiptap, a contenteditable whose root holds
// one <p> per paragraph, rather than in a textarea, so there is no
// selectionStart to read and no value to mirror. Its caret is described the way
// a textarea's is, as a character offset, counted over the block's plain text:
// each paragraph's words, one character for each break between paragraphs, and
// nothing for a footnote marker (an empty element numbered by CSS). That is the
// text textBlockPlain gives for the block, which every collaborator holds, so an
// offset taken on one screen lands on the same character on another, and the
// cursor message stays { field, start, end } whichever kind of field it is.

function paragraphsOf(root) {
  return Array.from(root.children);
}

// How many characters of plain text a paragraph holds.
function paragraphLength(paragraph) {
  return paragraph.textContent.length;
}

// The paragraph of `root` that contains `node`, or null.
function paragraphContaining(root, node) {
  let el = node;
  while (el && el.parentNode !== root) el = el.parentNode;
  return el && el.parentNode === root ? el : null;
}

/**
 * The plain-text offset of a DOM point (as a Selection reports it) within a
 * contenteditable's paragraphs.
 * @param {Element} root
 * @param {Node} node
 * @param {number} offset
 * @returns {number}
 */
export function contentEditableOffset(root, node, offset) {
  const paragraphs = paragraphsOf(root);
  const lengthBefore = (count) =>
    paragraphs
      .slice(0, count)
      .reduce((sum, p) => sum + paragraphLength(p) + 1, 0);

  // A point on the root itself sits before its `offset`th paragraph, or after
  // the last one (whose closing break isn't a character).
  if (node === root) {
    return offset >= paragraphs.length
      ? Math.max(0, lengthBefore(paragraphs.length) - 1)
      : lengthBefore(offset);
  }

  const paragraph = paragraphContaining(root, node);
  if (!paragraph) return 0;
  const range = document.createRange();
  range.setStart(paragraph, 0);
  range.setEnd(node, offset);
  return lengthBefore(paragraphs.indexOf(paragraph)) + range.toString().length;
}

/**
 * The local selection inside a contenteditable as { start, end } plain-text
 * offsets, or null when the selection isn't in it.
 * @param {Element} root
 * @returns {{ start: number, end: number } | null}
 */
export function contentEditableSelection(root) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
  if (!root.contains(anchorNode) || !root.contains(focusNode)) return null;
  const a = contentEditableOffset(root, anchorNode, anchorOffset);
  const b = contentEditableOffset(root, focusNode, focusOffset);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

/**
 * Where the caret at plain-text `index` sits in a contenteditable, in viewport
 * pixels, or null when the field has no paragraphs to measure. An index past the
 * end (the block is a moment behind a collaborator's typing) clamps to the end.
 * @param {Element} root
 * @param {number} index
 * @returns {{ left: number, top: number, height: number } | null}
 */
export function contentEditableCaretRect(root, index) {
  const paragraphs = paragraphsOf(root);
  if (!paragraphs.length) return null;

  let remaining = Math.max(0, index);
  let paragraph = paragraphs[paragraphs.length - 1];
  for (const p of paragraphs) {
    if (remaining <= paragraphLength(p)) {
      paragraph = p;
      break;
    }
    remaining -= paragraphLength(p) + 1;
  }
  remaining = Math.min(Math.max(remaining, 0), paragraphLength(paragraph));

  // Find the text node the offset falls in.
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let last = null;
  while (node) {
    if (remaining <= node.data.length) break;
    remaining -= node.data.length;
    last = node;
    node = walker.nextNode();
  }

  const lineHeight = (el) =>
    parseFloat(window.getComputedStyle(el).lineHeight) ||
    parseFloat(window.getComputedStyle(el).fontSize) * 1.5 ||
    18;

  // An empty paragraph has no text to put a range in; its own box is the line.
  if (!node && !last) {
    const rect = paragraph.getBoundingClientRect();
    return { left: rect.left, top: rect.top, height: lineHeight(paragraph) };
  }

  const range = document.createRange();
  if (node) range.setStart(node, remaining);
  else range.setStart(last, last.data.length);
  range.collapse(true);
  const rect = range.getClientRects()[0] || range.getBoundingClientRect();
  const height = rect.height || lineHeight(paragraph);
  return { left: rect.left, top: rect.top, height };
}
