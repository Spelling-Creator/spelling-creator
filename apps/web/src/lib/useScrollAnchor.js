import { useCallback, useLayoutEffect, useRef } from "react";

// An attribute selector for one id — `[data-block-id=abc]`. CSS.escape (and the
// unquoted form it produces a valid identifier for) matters because ids are not
// always ours: jsonImport's keepId() passes any string in a lesson file through
// verbatim, and one containing a quote would make querySelector throw.
export function idSelector(attr, id) {
  return `[${attr}=${CSS.escape(id)}]`;
}

// Scroll an element into view, honouring the OS "reduce motion" setting. A
// smooth scroll is worth it for a deliberate jump (you see where you're being
// taken), but never for restoring a position on load — that one should just be
// where you left it, so callers pass smooth: false.
export function scrollToElement(el, { block = "start", smooth = true } = {}) {
  if (!el) return;
  const reduce = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  )?.matches;
  el.scrollIntoView({ behavior: smooth && !reduce ? "smooth" : "auto", block });
}

// Scroll to a block of the lesson, or to its section when the block isn't on
// the page (a section's own name has no block). This is the one anchor
// contract the lesson surfaces share: SectionCard's rows and LessonView's
// wrappers publish data-block-id, and both publish data-section-id on the
// section, so the Check panel's findings and Find in lesson's hits go to the
// same place through the same code whichever surface is mounted.
//
// It waits two animation frames first: one for whatever the caller changed
// (a folded section opening, preview closing) to render, one for it to be
// laid out. A block is centered so it doesn't land under its section's sticky
// header; a section is aligned to the top, where its header is. `then` gets
// the element about to be scrolled to and whether it is the block, for
// whatever the caller wants to do there (focus a field, draw a ring). It runs
// *before* the scroll: focusing a rich-text field puts its caret into view on
// its own, even with preventScroll, which cut a smooth scroll started just
// before it short and left the block at the bottom of the screen. Done
// first, that jump happens and the deliberate scroll has the last word.
export function scrollToLessonTarget({ blockId, sectionId }, then) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const block = blockId
        ? document.querySelector(idSelector("data-block-id", blockId))
        : null;
      const target =
        block ||
        (sectionId
          ? document.querySelector(idSelector("data-section-id", sectionId))
          : null);
      if (!target) return;
      then?.(target, Boolean(block));
      scrollToElement(target, { block: block ? "center" : "start" });
    }),
  );
}

// Keeps one element visually still across a DOM change that moves it.
//
// The editor's move buttons reorder things that are screenfuls tall — a section
// in a six-section lesson is ~4,900px on a desktop and ~9 viewport-heights on a
// phone. Reordering under a fixed scrollY means the thing you just moved, and
// the button you just pressed, are flung far off screen: "move section down"
// scrolled the page into the middle of a different section, so pressing it
// twice was impossible without hunting for the button again.
//
// Usage: call the returned `anchor(selector)` immediately *before* the state
// update that reorders the DOM. After React commits, the hook re-measures that
// element and scrolls by the difference, so the element ends up back under the
// same pixel it was on — the page moves, the anchor doesn't.
//
// Anchoring the moved element (rather than, say, the section header) is what
// makes the move buttons repeatable: they stay under the pointer, so a block
// can be walked up a section one click at a time.
//
// Deletes deliberately don't use this. Deleting only changes the layout *below*
// the deleted element, and you can only delete something you can see, so the
// content above the viewport never shifts and there's nothing to correct.
//
// The correction is bounded by how far the page can actually scroll: reordering
// inside a document only a screen or two tall (every section collapsed, say)
// can leave some drift because the browser clamps at the end of the scroll
// range. That's unavoidable rather than a bug — and in a document that short,
// whatever moved is still on screen.
export function useScrollAnchor() {
  // { selector, top } between the anchor() call and the commit that follows it.
  const pending = useRef(null);

  const anchor = useCallback((selector) => {
    const el = document.querySelector(selector);
    pending.current = el
      ? { selector, top: el.getBoundingClientRect().top }
      : null;
  }, []);

  // No dep array: this has to run after whichever commit the anchor() call was
  // paired with, and it's a no-op on every other render. useLayoutEffect (not
  // useEffect) so the correction lands in the same frame as the reorder —
  // otherwise the page paints once at the wrong offset and visibly jumps.
  useLayoutEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    const el = document.querySelector(p.selector);
    if (!el) return;
    const delta = el.getBoundingClientRect().top - p.top;
    // Instant, not smooth: this is a correction that should never be perceived
    // as motion of its own.
    if (delta) window.scrollBy(0, delta);
  });

  return anchor;
}
