// What a route's error boundary shows for an error that isn't a 404: a
// loader that failed, a component that threw. The message is shown in
// development, where it is the fastest way to the cause; in production the
// page says only that something went wrong, since the message is for the
// log (see entry.server.tsx), not for a reader.

import { Link, isRouteErrorResponse } from "react-router";
import { useTranslation } from "react-i18next";
import { TriangleAlertIcon } from "lucide-react";
import PageBody from "@/components/layout/PageBody";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error }: { error: unknown }) {
  const { t } = useTranslation("common");
  let detail: string | undefined;
  if (isRouteErrorResponse(error)) {
    detail = `${error.status} ${error.statusText}`.trim();
  } else if (import.meta.env.DEV && error instanceof Error) {
    detail = error.message;
  }

  return (
    <PageBody width="reading">
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <TriangleAlertIcon
          className="size-10 text-muted-foreground"
          aria-hidden="true"
        />
        <h1 className="text-xl font-semibold">{t("errorPage.heading")}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          {t("errorPage.description")}
        </p>
        {detail && (
          <pre className="max-w-full overflow-x-auto rounded-md bg-muted p-3 text-left text-xs">
            {detail}
          </pre>
        )}
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to="/" className="no-underline">
              {t("notFound.goHome")}
            </Link>
          </Button>
        </div>
      </div>
    </PageBody>
  );
}
