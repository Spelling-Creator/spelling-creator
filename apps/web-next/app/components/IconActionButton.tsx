import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Small icon button with a tooltip, used throughout the editor's block and
// section controls (move up and down, delete, and so on). Wrapped in a <span>
// so the tooltip still shows while the button is disabled (a plain disabled
// <button> doesn't fire pointer events at all).
//
// `tooltip` doubles as the accessible name. A tooltip alone labels these
// buttons for nobody but a mouse user: touch devices have no hover, and
// assistive tech gets nothing from the icon. The aria-label is overridable
// for the rare caller wanting a longer spoken name than the tooltip's text.
//
// Sizing: 40px on touch, shrinking to 32px only on a wide screen with a fine
// pointer. 32px is under both Apple's 44pt and Material's 48dp minimum
// targets, and these sit in rows of three to five buttons with only 4px
// between them. Gated on `pointer-fine` as well as `sm` because width alone
// doesn't imply a mouse: a tablet is 640px+ and still finger-driven.
export default function IconActionButton({
  tooltip,
  disabled,
  destructive,
  className,
  ...props
}: ComponentProps<typeof Button> & {
  tooltip: string;
  destructive?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={tooltip}
            disabled={disabled}
            className={cn(
              "size-10 sm:pointer-fine:size-8",
              destructive &&
                "text-destructive hover:bg-destructive/10 hover:text-destructive",
              className,
            )}
            {...props}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
