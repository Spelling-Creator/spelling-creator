import { cn } from "@/lib/utils";

function Input({ className, type, ...props }) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // text-foreground is explicit (only placeholder/file-button text set
        // their own color) — native form elements don't inherit color while
        // Tailwind preflight is off. See the memory on this.
        //
        // No `dark:bg-input/30` here (stock shadcn has one). A field is defined
        // by its border in both themes now that --input is a solid colour, and
        // the dark-only fill actively broke the app's several deliberately
        // text-like inputs — the document title, a section's name — which pass
        // `bg-transparent` and got a filled bar in dark anyway, because
        // tailwind-merge keeps a `dark:` fill and an unprefixed one side by
        // side and the dark one then wins. It was invisible while --input was
        // white at 12%; it stopped being invisible the moment the token went
        // opaque. Buttons keep their dark fill — a thing you press should read
        // as raised, a thing you type into shouldn't.
        "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base text-foreground shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
