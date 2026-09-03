// The page for a URL that isn't one.
//
// This used to be `<Navigate to="/" replace />`: an unknown path silently became
// the homepage. That is a poor answer to a mistyped or dead link — it hides the
// fact that anything went wrong, and it leaves someone who followed a stale link
// with no idea whether the thing they wanted moved or never existed.
//
// It was also only half of the problem. The host answered every such path with a
// `200`, so a crawler was told each junk URL was a real page (a "soft 404"). The
// host now sends a genuine `404` with this same shell — see
// apps/api/src/routes/spa.js — and this page is what renders inside it. The
// `robots` tag is belt and braces for the crawlers that reach it another way.
//
// Deliberately eager rather than lazy: it is a handful of elements, and the one
// moment it is needed is a page load that has already gone wrong. Waiting on a
// chunk request to be told the page doesn't exist would be a poor trade.

import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CompassIcon } from "lucide-react";
import PageBar from "../components/layout/PageBar.jsx";
import PageBody from "../components/layout/PageBody.jsx";
import { Button } from "../components/ui/button.jsx";
import { DocumentMeta } from "../lib/seo.jsx";

export default function NotFoundPage() {
  const { t } = useTranslation("common");

  return (
    <>
      {/* No preview image: the default is a live screenshot of the current
          page, and a screenshot of an error is not worth rendering a browser
          for — let alone unfurling into a chat. */}
      <DocumentMeta title={t("notFound.title")} image={null} />
      <meta name="robots" content="noindex" />

      <PageBar crumbs={[{ label: t("notFound.title") }]} />

      <PageBody width="reading">
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <CompassIcon
            className="size-10 text-muted-foreground"
            aria-hidden="true"
          />
          <h2 className="text-xl font-semibold">{t("notFound.heading")}</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {t("notFound.description")}
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Button asChild>
              <RouterLink to="/" className="no-underline">
                {t("notFound.goHome")}
              </RouterLink>
            </Button>
            <Button variant="outline" asChild>
              <RouterLink to="/hub" className="no-underline">
                {t("notFound.browseHub")}
              </RouterLink>
            </Button>
          </div>
        </div>
      </PageBody>
    </>
  );
}
