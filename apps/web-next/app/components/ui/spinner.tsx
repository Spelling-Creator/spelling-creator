import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Loader2Icon } from "lucide-react";

import { cn } from "@/lib/utils";

// For the inside of a button while its request is in flight. Content that is
// loading gets a skeleton (components/Skeletons.tsx), not this.
function Spinner({ className, ...props }: ComponentProps<typeof Loader2Icon>) {
  const { t } = useTranslation("common");
  return (
    <Loader2Icon
      role="status"
      aria-label={t("status.loading")}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
