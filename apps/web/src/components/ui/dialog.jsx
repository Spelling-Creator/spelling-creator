import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Every direct wrapper of a Radix primitive below is forwardRef'd. On React 19
// `ref` is an ordinary prop, so this is no longer what makes a ref arrive — the
// wrappers are kept because they still work and unwinding all 58 of them across
// ui/ is a mechanical cleanup in its own right, not part of the upgrade.
//
// The refs themselves are not optional either way: Radix needs them for asChild
// composition and internally too — Overlay/Content use Presence, which grabs the
// real DOM node to wait out exit animations before unmounting.

function Dialog({ ...props }) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

const DialogTrigger = forwardRef(function DialogTrigger(props, ref) {
  return (
    <DialogPrimitive.Trigger ref={ref} data-slot="dialog-trigger" {...props} />
  );
});

function DialogPortal({ ...props }) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

const DialogClose = forwardRef(function DialogClose(props, ref) {
  return (
    <DialogPrimitive.Close ref={ref} data-slot="dialog-close" {...props} />
  );
});

const DialogOverlay = forwardRef(function DialogOverlay(
  { className, ...props },
  ref,
) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
});

/**
 * The dialog is two boxes, and `className` and `bodyClassName` style one each.
 *
 * - The **frame** (`className`) is the surface: position, size, border,
 *   background, and the close button. It never scrolls. Width and height
 *   classes go here (`sm:max-w-md`, `max-h-[85dvh]`).
 * - The **body** (`bodyClassName`) holds the children and is what scrolls when
 *   they don't fit. Layout classes go here: the default is `grid gap-4 p-6`,
 *   so a dialog that wants `flex flex-col`, or `p-0 gap-0`, says so on the
 *   body.
 *
 * It was one box until dialogs had to scroll. A phone turned sideways is
 * ~390px tall, and a dialog taller than that ran off both ends of the screen
 * with no way to reach its buttons. Making the one box scroll fixed that, but
 * took the close button with it: an absolutely positioned child of a scroll
 * container scrolls with the content (so does a `fixed` one, inside a
 * transformed parent like this). With the scrolling one level in, the button
 * stays in the corner however far down the body is.
 */
const DialogContent = forwardRef(function DialogContent(
  { className, bodyClassName, children, showCloseButton = true, ...props },
  ref,
) {
  const { t } = useTranslation("common");
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        data-slot="dialog-content"
        className={cn(
          // An opaque overlay surface: bg-card, a real border, and the panel
          // shadow — which now means "this floats above the page" rather than
          // "this is a card", since nothing in the page's own flow carries it
          // any more. This used to be the design mockup's ".glass" surface
          // (translucent card, backdrop-blur + saturate, and a second 1px outer
          // ring in the shadow to give the translucency an edge); all three
          // went when the surfaces went opaque. text-foreground is explicit
          // (vanilla shadcn relies on a global `body { color: var(--foreground)
          // }` for this, deliberately deferred to the migration's cleanup phase
          // — see the comment at the bottom of styles/globals.css).
          //
          // The size caps keep 1rem of overlay on every side, plus the
          // screen's safe-area inset. The box is centred, so the bigger of the
          // two insets on an axis is taken off both ends of it: otherwise, in
          // the installed app, the top of a tall dialog (and its close button)
          // would sit under the clock. --safe-x/--safe-y are in globals.css.
          "fixed top-[50%] left-[50%] z-50 flex max-h-[calc(100dvh-2rem-2*var(--safe-y))] w-full max-w-[calc(100%-2rem-2*var(--safe-x))] translate-x-[-50%] translate-y-[-50%] flex-col overflow-hidden rounded-panel border bg-card text-foreground shadow-(--shadow-panel) duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg",
          className,
        )}
        {...props}
      >
        {/* min-h-0 lets the body shrink below its content inside the capped
            frame, which is what makes overflow-y-auto engage. A dialog with a
            scrolling list of its own (history, merge) makes the body a flex
            column with the list as an overflow-y-auto item, which a flex
            column is allowed to shrink: the list gives way first, and the body
            only scrolls if what's around the list can't fit either. */}
        <div
          data-slot="dialog-body"
          className={cn(
            "grid min-h-0 gap-4 overflow-y-auto p-6",
            bodyClassName,
          )}
        >
          {children}
        </div>
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            // bg-transparent/text-foreground/border-0/cursor-pointer are all
            // explicit — native <button> elements neither reset their UA
            // chrome nor inherit color while Tailwind preflight is off. See
            // the memory on this.
            className="absolute top-4 right-4 cursor-pointer rounded-xs border-0 bg-transparent p-0 text-foreground opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">{t("buttons.close")}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});

function DialogHeader({ className, ...props }) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}) {
  const { t } = useTranslation("common");
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">{t("buttons.close")}</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
