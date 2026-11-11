// The page for a URL that isn't one.
//
// An unknown path is a 404, status and page both: the catch-all route
// (routes/not-found.tsx) throws the status and the shell's error boundary
// renders this inside the usual chrome, offering the home page and the hub.
// A silent redirect to the homepage would hide that anything went wrong and
// leave someone who followed a stale link with no idea whether the thing
// they wanted moved or never existed.

import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { CompassIcon } from "lucide-react";
import PageBody from "@/components/layout/PageBody";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  const { t } = useTranslation("common");

  return (
    <PageBody width="reading">
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <CompassIcon
          className="size-10 text-muted-foreground"
          aria-hidden="true"
        />
        {/* h1: this page's only heading. */}
        <h1 className="text-xl font-semibold">{t("notFound.heading")}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          {t("notFound.description")}
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to="/" className="no-underline">
              {t("notFound.goHome")}
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/hub" className="no-underline">
              {t("notFound.browseHub")}
            </Link>
          </Button>
        </div>
      </div>
    </PageBody>
  );
}
