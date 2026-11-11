// Registry of languages the UI can be switched to. Today this only lists
// English because only app/locales/en/ exists; see the docs at
// apps/docs/docs/developers/web-app/internationalization.md for the steps to
// add a new language (locale JSON files, an entry here, and registering it in
// lib/i18n.ts's `resources` and `supportedLngs`).
export const LANGUAGES: ReadonlyArray<{ code: string; label: string }> = [
  { code: "en", label: "English" },
];

export const DEFAULT_LANGUAGE = "en";
