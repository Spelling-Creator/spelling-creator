import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type InputEvent,
  type Ref,
} from "react";
import { cn } from "@/lib/utils";

// Grow the field to fit what's in it, so a lesson paragraph or a long
// question prompt is readable in the editor instead of being scrolled through
// a two-line slot.
//
// This used to be `field-sizing: content`, one CSS declaration that does
// exactly this. It's dropped: when a browser doesn't honor it there is no
// symptom to debug, just a field stuck at its min-height with a scrollbar and
// a resize grabber, which is precisely what it was there to avoid. Measuring
// the content behaves the same everywhere, so this is the only path rather
// than a fallback behind a feature test.
function fitToContent(el: HTMLTextAreaElement | null) {
  // A field inside a collapsed section is display:none, where scrollHeight
  // reads 0; committing that would leave it 0px tall when the section opens
  // again. The ResizeObserver below re-measures it once it has a width.
  if (!el || el.clientWidth === 0) return;
  const style = getComputedStyle(el);
  // scrollHeight covers content and padding but never the border, so under
  // border-box the height set has to carry it or the field lands 2px short
  // and scrolls anyway.
  const border =
    style.boxSizing === "border-box"
      ? parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
      : 0;
  el.style.height = "auto"; // shrink first, so deleting text shrinks the field
  el.style.height = `${el.scrollHeight + border}px`;
}

function Textarea({
  className,
  value,
  onInput,
  ref: forwardedRef,
  ...props
}: ComponentProps<"textarea"> & { ref?: Ref<HTMLTextAreaElement> }) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const setRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      innerRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );

  // Controlled fields re-fit whenever their value changes, including when it
  // arrives from somewhere other than typing (a lesson loading, a
  // collaborator's edit, an AI suggestion inserted into a block).
  useLayoutEffect(() => {
    fitToContent(innerRef.current);
  }, [value]);

  // ...and uncontrolled ones on the keystroke itself. `input` rather than
  // `change` so the field grows as it's typed into, not on blur.
  const handleInput = (e: InputEvent<HTMLTextAreaElement>) => {
    fitToContent(e.currentTarget);
    onInput?.(e);
  };

  // A change of width re-wraps the text and so changes how tall it needs to
  // be: a resized window, or a block moving between the desktop content and
  // controls row and the mobile column. Observing the element also catches
  // 0 to a real width, which is how a field in a section that was collapsed
  // at mount gets its first measurement.
  useEffect(() => {
    const el = innerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return; // our own height change
      lastWidth = el.clientWidth;
      fitToContent(el);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <textarea
      ref={setRef}
      data-slot="textarea"
      value={value}
      onInput={handleInput}
      className={cn(
        // resize-none and overflow-hidden go with the auto-sizing above: the
        // field is never scrollable (it's always exactly as tall as its
        // text), and a hand-dragged height would only be overwritten by the
        // next keystroke.
        "flex min-h-16 w-full resize-none overflow-hidden rounded-md border border-input bg-transparent px-3 py-2 text-base text-foreground shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
