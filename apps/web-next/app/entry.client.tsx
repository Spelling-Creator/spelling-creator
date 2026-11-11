// The browser entry: configure core, then hydrate what the server sent.
//
// Core is configured before anything renders, from the build's values with
// what the host wrote into the page over them (lib/config.ts). The server
// configured itself the same way before it rendered (root.tsx), so the tree
// hydrates against markup made with the same settings.

import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { HydratedRouter } from "react-router/dom";
import { configureCore } from "@spelling-creator/core/config";
import { browserConfig } from "@/lib/config";
import { createBrowserI18n } from "@/lib/i18n";

configureCore(browserConfig());
const i18n = createBrowserI18n();

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <HydratedRouter />
      </I18nextProvider>
    </StrictMode>,
  );
});
