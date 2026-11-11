import type { ComponentProps } from "react";
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner } from "sonner";
import { useColorScheme } from "@/lib/colorScheme";

// The CLI-generated version of this file reads next-themes' useTheme(); this
// app has its own dark-mode mechanism (data-theme on <html>, driven by
// ColorSchemeProvider), so it reads that instead.

// Sonner's own gaps from the screen edge (24px, or 16px on a phone) with the
// safe-area insets added, so a toast never lands on the home indicator or
// under the notch. Sonner (2.x) takes a per-edge object for both props and
// writes each value into its --offset-* and --mobile-offset-* variables as
// given, so the var() references resolve in the page. Built once: they never
// change, and new objects on every render would only hand Sonner new props
// to re-apply.
const edgeOffset = (px: number) => ({
  top: `calc(${px}px + var(--safe-top))`,
  right: `calc(${px}px + var(--safe-right))`,
  bottom: `calc(${px}px + var(--safe-bottom))`,
  left: `calc(${px}px + var(--safe-left))`,
});
const OFFSET = edgeOffset(24);
const MOBILE_OFFSET = edgeOffset(16);

function Toaster({ ...props }: ComponentProps<typeof Sonner>) {
  const { resolved } = useColorScheme();

  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      offset={OFFSET}
      mobileOffset={MOBILE_OFFSET}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      toastOptions={{
        // The same opaque overlay surface as dialog.tsx and popover.tsx, on
        // the denser --popover background since a toast is small and
        // text-dense.
        classNames: {
          toast:
            "rounded-panel! border! bg-popover! text-popover-foreground! shadow-(--shadow-panel)!",
          description: "text-muted-foreground!",
          actionButton:
            "bg-primary! text-primary-foreground! hover:bg-primary/90!",
          cancelButton:
            "bg-transparent! text-muted-foreground! hover:bg-accent!",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
