// i18next setup. Only English ships today, but every user-facing string in
// the app is routed through this so a new language is just: add its locale
// directory under app/locales/<lng>/, list it in `resources` and
// `supportedLngs` below, and add an entry to LANGUAGES in lib/languages.ts
// for the language switcher.
//
// Nothing here is a shared mutable instance for rendering. The server runs
// many requests in one isolate, so each render gets an instance of its own
// (createServerI18n, from entry.server.tsx), and the browser gets one with
// the language detector (createBrowserI18n, from entry.client.tsx). Both
// reach components through <I18nextProvider>.

import { createInstance, type InitOptions, type i18n as I18n } from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import enAiDialogs from "@/locales/en/aiDialogs.json";
import enChecks from "@/locales/en/checks.json";
import enCollab from "@/locales/en/collab.json";
import enCommon from "@/locales/en/common.json";
import enEditor from "@/locales/en/editor.json";
import enEditorSections from "@/locales/en/editorSections.json";
import enEditorTools from "@/locales/en/editorTools.json";
import enHome from "@/locales/en/home.json";
import enHub from "@/locales/en/hub.json";
import enInteractive from "@/locales/en/interactive.json";
import enLesson from "@/locales/en/lesson.json";
import enLibrary from "@/locales/en/library.json";
import enLogin from "@/locales/en/login.json";
import enModeration from "@/locales/en/moderation.json";
import enOauth from "@/locales/en/oauth.json";
import enProfile from "@/locales/en/profile.json";
import enRichText from "@/locales/en/richText.json";
import enSettings from "@/locales/en/settings.json";

export const defaultNS = "common";

// Every namespace the app uses. Adding a new one? Register it here too, or
// useTranslation("yourNs") will silently render missing-key fallbacks.
export const namespaces = [
  "common",
  "home",
  "hub",
  "interactive",
  "lesson",
  "library",
  "login",
  "moderation",
  "oauth",
  "profile",
  "settings",
  "editor",
  "editorSections",
  "editorTools",
  "richText",
  "collab",
  "aiDialogs",
  "checks",
];

export const resources = {
  en: {
    common: enCommon,
    home: enHome,
    hub: enHub,
    interactive: enInteractive,
    lesson: enLesson,
    library: enLibrary,
    login: enLogin,
    moderation: enModeration,
    oauth: enOauth,
    profile: enProfile,
    settings: enSettings,
    editor: enEditor,
    editorSections: enEditorSections,
    editorTools: enEditorTools,
    richText: enRichText,
    collab: enCollab,
    aiDialogs: enAiDialogs,
    checks: enChecks,
  },
};

// Everything except which language to start in and how to work that out.
// `initAsync: false` pins down that init is synchronous: every namespace is
// compiled into the bundle, so with inline resources and no backend an
// instance is ready when init returns. Adding a backend later fails loudly
// here rather than quietly rendering missing-key fallbacks into the HTML.
export const baseConfig: InitOptions = {
  resources,
  ns: namespaces,
  defaultNS,
  fallbackLng: "en",
  supportedLngs: ["en"],
  initAsync: false,
  interpolation: {
    // React already escapes values when rendering, so double-escaping here
    // would mangle apostrophes and ampersands in interpolated strings.
    escapeValue: false,
  },
};

/**
 * An instance for one server render: English, and nothing shared, because
 * module scope on the server is shared by concurrent requests.
 */
export function createServerI18n(): I18n {
  const instance = createInstance();
  instance.init({ ...baseConfig, lng: "en" });
  return instance;
}

/**
 * The browser's instance: the visitor's language from localStorage, then the
 * browser, falling back to English. initReactI18next also makes it the
 * default for anything that renders outside the provider.
 */
export function createBrowserI18n(): I18n {
  const instance = createInstance();
  instance
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      ...baseConfig,
      detection: {
        order: ["localStorage", "navigator"],
        caches: ["localStorage"],
      },
    });
  return instance;
}

/**
 * English strings for code that runs outside a component and so has no
 * provider to read from: a route's `meta`, which React Router calls as a
 * plain function. Read-only, which is what makes sharing it safe on the
 * server.
 */
export const i18n = createServerI18n();
