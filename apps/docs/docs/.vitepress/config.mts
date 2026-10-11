import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import llmstxt from "vitepress-plugin-llms";
import { defineConfig } from "vitepress";

// The public origin the docs are published under. Used for the sitemap's
// absolute URLs and for the absolute links in llms.txt.
const SITE_ORIGIN = "https://spellingcreator.org";

const BASE = "/docs/";

/**
 * Pages that used to live somewhere else, mapped to where they are now.
 *
 * The docs were reorganized into a user guide and a developers section, and
 * the old URLs are linked from READMEs, issues and people's bookmarks. Each one
 * gets a small static page that forwards to the new one (see buildEnd below).
 * Static files rather than server rules, because the docs are served by two
 * different hosts (the Cloudflare Worker and the Node server) and both already
 * serve whatever is in the build. A page that was split into a guide page and
 * a developers page forwards to the guide page, which links to the other half.
 */
const REDIRECTS: Record<string, string> = {
  "web-app/overview": "guide/overview",
  "web-app/getting-started": "developers/web-app/getting-started",
  "web-app/pages-and-routing": "developers/web-app/pages-and-routing",
  "web-app/local-lessons": "guide/local-lessons",
  "web-app/document-import": "guide/import-from-text",
  "web-app/server-rendering": "developers/web-app/server-rendering",
  "web-app/question-blocks": "guide/question-blocks",
  "web-app/vakt-activities": "guide/vakt-activities",
  "web-app/formatting-and-footnotes": "guide/formatting-and-footnotes",
  "web-app/lesson-checks": "guide/lesson-checks",
  "web-app/ai-lesson-fixes": "guide/ai-lesson-fixes",
  "web-app/fact-checking": "guide/fact-checking",
  "web-app/ai-text-suggestions": "guide/ai-writing-help",
  "web-app/ai-question-suggestions": "guide/ai-writing-help",
  "web-app/ai-lesson-ideas": "guide/ai-writing-help",
  "web-app/lesson-summaries": "guide/lesson-summaries",
  "web-app/comment-translation": "guide/translation",
  "web-app/lesson-translation": "guide/translation",
  "web-app/interactive-mode": "guide/interactive-mode",
  "web-app/search-images": "guide/images",
  "web-app/image-credits": "guide/images",
  "web-app/save-to-google-docs": "guide/exporting",
  "web-app/live-collaboration": "guide/live-collaboration",
  "web-app/lesson-variations": "guide/variations",
  "web-app/pull-requests": "guide/pull-requests",
  "web-app/lesson-hub-and-accounts": "guide/hub-and-accounts",
  "web-app/rich-text": "guide/comments-and-bios",
  "web-app/profiles-and-display-names": "guide/profiles",
  "web-app/notifications": "guide/notifications",
  "web-app/moderation": "guide/moderation",
  "web-app/export-pipeline": "developers/web-app/export-pipeline",
  "web-app/project-structure": "developers/web-app/project-structure",
  "web-app/design-system": "developers/web-app/design-system",
  "web-app/mobile-layout": "developers/web-app/mobile-layout",
  "web-app/navigating-large-lessons": "guide/navigating-large-lessons",
  "web-app/pwa-and-offline": "guide/install-and-offline",
  "web-app/internationalization": "developers/web-app/internationalization",
  "monorepo/overview": "developers/overview",
  "monorepo/getting-started": "developers/getting-started",
  "monorepo/stub-api": "developers/stub-api",
  "monorepo/lesson-images": "developers/lesson-images",
  "monorepo/version-history": "developers/version-history",
  "monorepo/platform-seam": "developers/platform-seam",
  "monorepo/self-hosting": "developers/self-hosting",
  "monorepo/frontend-migration": "developers/frontend-migration",
  "monorepo/document-import-experiment":
    "developers/document-import-experiment",
  "mcp-server/overview": "guide/ai-assistants/overview",
  "mcp-server/tools": "developers/mcp-server/tools",
  "mcp-server/interactive-views": "developers/mcp-server/interactive-views",
  "mcp-server/lesson-validation": "developers/mcp-server/lesson-validation",
  "mcp-server/live-sessions": "guide/ai-assistants/live-sessions",
  "mcp-server/install-bundle": "guide/ai-assistants/connect",
  "mcp-server/setup": "guide/ai-assistants/connect",
  "mcp-server/configuration": "developers/mcp-server/configuration",
  "mcp-server/development": "developers/mcp-server/development",
  "mcp-server/packaging": "developers/mcp-server/packaging",
  "mcp-server/remote-mode": "developers/mcp-server/remote-mode",
};

/** A page that sends the visitor on to `to`, keeping any #anchor they had. */
function redirectPage(to: string): string {
  const path = `${BASE}${to}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>This page has moved</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="${SITE_ORIGIN}${path}">
<meta http-equiv="refresh" content="0; url=${path}">
<script>location.replace(${JSON.stringify(path)} + location.hash)</script>
</head>
<body><p>This page has moved to <a href="${path}">${path}</a>.</p></body>
</html>
`;
}

/**
 * Whether this build can ask git when each page last changed.
 *
 * `lastUpdated` runs `git log` per page, which is fine in a checkout and in CI
 * and fails the entire build anywhere else — inside a container without git
 * installed, or in a build from a source tarball that has no `.git` at all. Both
 * are ordinary ways to build this (see the Dockerfile), and a missing timestamp
 * is not worth failing over.
 *
 * Detected rather than configured, so it needs no flag to be passed and cannot
 * be got wrong. Checks for a repository too, not just the binary: git being
 * installed says nothing about whether there is any history to read.
 */
function gitHistoryAvailable(): boolean {
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const HAS_GIT_HISTORY = gitHistoryAvailable();

// This runs in Node.js during the build — no browser APIs here.
export default defineConfig({
  // Served as a sub-path of the main site. The Cloudflare Worker (apps/api)
  // hosts the web SPA and this docs site from one assets bundle: the `build`
  // script renders here, then copies the static output into apps/web/dist/docs
  // so `wrangler deploy` ships the docs alongside the SPA, reached at /docs/.
  // VitePress emits a purely static bundle (no server runtime). outDir is
  // resolved from this config's project root (apps/docs/docs), so ../doc_build
  // renders to apps/docs/doc_build — the directory the `build` script copies
  // into apps/web/dist/docs from.
  base: BASE,
  outDir: "../doc_build",

  // Writes the forwarding pages for moved URLs (see REDIRECTS). After the
  // build, so they land next to the real pages and stay out of the sitemap,
  // search and llms.txt, which only know about Markdown pages.
  buildEnd(siteConfig) {
    for (const [from, to] of Object.entries(REDIRECTS)) {
      const file = join(siteConfig.outDir, `${from}.html`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, redirectPage(to));
    }
  },

  // Extensionless URLs (/docs/intro, not /docs/intro.html) — the links the
  // READMEs already point at. Cloudflare's static-asset handling defaults to
  // `auto-trailing-slash`, so it resolves /docs/intro to intro.html for us.
  cleanUrls: true,

  title: "Spelling Creator",
  description:
    "How to write, share and run Spelling lessons with Spelling Creator, and how it is built",
  head: [["link", { rel: "icon", href: "/docs/img/favicon.ico" }]],

  // Every page ships a <lastmod> in the sitemap, taken from git — where there is
  // git to take it from. A build without it (a container, a source tarball)
  // simply omits the timestamps rather than failing; see gitHistoryAvailable.
  lastUpdated: HAS_GIT_HISTORY,

  // Built-in sitemap generation. The hostname includes `base`, as VitePress
  // requires, so the emitted URLs are the real published ones under /docs/.
  // Written to doc_build/sitemap.xml → served at /docs/sitemap.xml, which
  // robots.txt (apps/api/src/routes/seo.js) points crawlers at alongside the
  // Worker's own dynamic /sitemap.xml for the app pages.
  sitemap: {
    hostname: `${SITE_ORIGIN}/docs/`,
  },

  vite: {
    // Emits llms.txt, llms-full.txt and a Markdown twin of every page, so an
    // assistant can read the docs without scraping the rendered HTML.
    plugins: [llmstxt({ domain: SITE_ORIGIN })],
  },

  themeConfig: {
    logo: "/img/logo.svg",
    siteTitle: "Spelling Creator",
    search: { provider: "local" },
    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/Spelling-Creator/spelling-creator",
      },
    ],
    editLink: {
      pattern:
        "https://github.com/Spelling-Creator/spelling-creator/edit/main/apps/docs/docs/:path",
      text: "Edit this page on GitHub",
    },
    footer: {
      message: `Copyright © ${new Date().getFullYear()} Spelling Creator.`,
    },
    // Two audiences, two sidebars. Everything under /developers/ gets the
    // developers sidebar; everything else (the guide, and the intro both
    // sections start from) gets the user guide's. Links are relative to the
    // base, which VitePress prepends.
    nav: [
      {
        text: "User guide",
        link: "/guide/overview",
        activeMatch: "^/(guide/|intro)",
      },
      {
        text: "Developers",
        link: "/developers/overview",
        activeMatch: "^/developers/",
      },
    ],
    sidebar: {
      "/developers/": [
        {
          text: "Start here",
          items: [
            { text: "Overview", link: "/developers/overview" },
            { text: "Getting started", link: "/developers/getting-started" },
            {
              text: "Stub API (local backend)",
              link: "/developers/stub-api",
            },
            { text: "Self-hosting", link: "/developers/self-hosting" },
          ],
        },
        {
          text: "Architecture",
          items: [
            { text: "The platform seam", link: "/developers/platform-seam" },
            { text: "Lesson images", link: "/developers/lesson-images" },
            { text: "Version history", link: "/developers/version-history" },
          ],
        },
        {
          text: "Web app",
          items: [
            { text: "Overview", link: "/developers/web-app/overview" },
            {
              text: "Getting started",
              link: "/developers/web-app/getting-started",
            },
            {
              text: "Project structure",
              link: "/developers/web-app/project-structure",
            },
            {
              text: "Pages & routing",
              link: "/developers/web-app/pages-and-routing",
            },
            {
              text: "Server rendering",
              link: "/developers/web-app/server-rendering",
            },
            {
              text: "Design system",
              link: "/developers/web-app/design-system",
            },
            {
              text: "Mobile layout",
              link: "/developers/web-app/mobile-layout",
            },
            {
              text: "Internationalization",
              link: "/developers/web-app/internationalization",
            },
            {
              text: "Installable app & offline",
              link: "/developers/web-app/pwa-and-offline",
            },
            {
              text: "Export pipeline",
              link: "/developers/web-app/export-pipeline",
            },
          ],
        },
        {
          text: "Web app features",
          collapsed: false,
          items: [
            {
              text: "Lessons on this device",
              link: "/developers/web-app/local-lessons",
            },
            {
              text: "Import from text",
              link: "/developers/web-app/document-import",
            },
            {
              text: "Formatting & footnotes",
              link: "/developers/web-app/formatting-and-footnotes",
            },
            {
              text: "VAKT activities",
              link: "/developers/web-app/vakt-activities",
            },
            {
              text: "Navigating large lessons",
              link: "/developers/web-app/navigating-large-lessons",
            },
            { text: "Images", link: "/developers/web-app/images" },
            { text: "Rich text", link: "/developers/web-app/rich-text" },
            {
              text: "Lesson checks",
              link: "/developers/web-app/lesson-checks",
            },
            {
              text: "AI lesson fixes",
              link: "/developers/web-app/ai-lesson-fixes",
            },
            {
              text: "Fact checking",
              link: "/developers/web-app/fact-checking",
            },
            {
              text: "AI suggestions",
              link: "/developers/web-app/ai-suggestions",
            },
            {
              text: "Lesson summaries",
              link: "/developers/web-app/lesson-summaries",
            },
            {
              text: "Comment translation",
              link: "/developers/web-app/comment-translation",
            },
            {
              text: "Lesson translation",
              link: "/developers/web-app/lesson-translation",
            },
            {
              text: "Interactive mode",
              link: "/developers/web-app/interactive-mode",
            },
            {
              text: "Hub & accounts",
              link: "/developers/web-app/hub-and-accounts",
            },
            { text: "Profiles", link: "/developers/web-app/profiles" },
            {
              text: "Notifications",
              link: "/developers/web-app/notifications",
            },
            { text: "Moderation", link: "/developers/web-app/moderation" },
            {
              text: "Live collaboration",
              link: "/developers/web-app/live-collaboration",
            },
            { text: "Variations", link: "/developers/web-app/variations" },
            {
              text: "Pull requests",
              link: "/developers/web-app/pull-requests",
            },
          ],
        },
        {
          text: "MCP server",
          items: [
            { text: "Overview", link: "/developers/mcp-server/overview" },
            { text: "Tools", link: "/developers/mcp-server/tools" },
            {
              text: "Lesson validation",
              link: "/developers/mcp-server/lesson-validation",
            },
            {
              text: "Interactive views",
              link: "/developers/mcp-server/interactive-views",
            },
            {
              text: "Live sessions",
              link: "/developers/mcp-server/live-sessions",
            },
            { text: "Setup", link: "/developers/mcp-server/setup" },
            {
              text: "Configuration",
              link: "/developers/mcp-server/configuration",
            },
            {
              text: "Development",
              link: "/developers/mcp-server/development",
            },
            {
              text: "Packaging the bundle",
              link: "/developers/mcp-server/packaging",
            },
            {
              text: "Remote (hosted) mode",
              link: "/developers/mcp-server/remote-mode",
            },
          ],
        },
        {
          text: "Decision records",
          items: [
            {
              text: "Frontend migration",
              link: "/developers/frontend-migration",
            },
            {
              text: "Document import experiment",
              link: "/developers/document-import-experiment",
            },
          ],
        },
      ],
      "/": [
        {
          text: "Start here",
          items: [
            { text: "What is Spelling Creator?", link: "/intro" },
            { text: "Overview", link: "/guide/overview" },
            { text: "Your first lesson", link: "/guide/getting-started" },
          ],
        },
        {
          text: "Writing a lesson",
          items: [
            { text: "Question blocks", link: "/guide/question-blocks" },
            { text: "VAKT activities", link: "/guide/vakt-activities" },
            {
              text: "Formatting, footnotes & sources",
              link: "/guide/formatting-and-footnotes",
            },
            { text: "Pictures", link: "/guide/images" },
            {
              text: "Navigating long lessons",
              link: "/guide/navigating-large-lessons",
            },
            { text: "Lessons on this device", link: "/guide/local-lessons" },
            { text: "Import from text", link: "/guide/import-from-text" },
          ],
        },
        {
          text: "Checking and AI help",
          items: [
            { text: "Lesson checks", link: "/guide/lesson-checks" },
            { text: "AI lesson fixes", link: "/guide/ai-lesson-fixes" },
            { text: "Fact checking", link: "/guide/fact-checking" },
            { text: "AI writing help", link: "/guide/ai-writing-help" },
            { text: "Lesson summaries", link: "/guide/lesson-summaries" },
            { text: "Translation", link: "/guide/translation" },
          ],
        },
        {
          text: "Using a lesson",
          items: [
            { text: "Interactive mode", link: "/guide/interactive-mode" },
            { text: "Exporting & printing", link: "/guide/exporting" },
          ],
        },
        {
          text: "Sharing and working together",
          items: [
            { text: "Hub & accounts", link: "/guide/hub-and-accounts" },
            { text: "Profiles", link: "/guide/profiles" },
            { text: "Comments & bios", link: "/guide/comments-and-bios" },
            { text: "Notifications", link: "/guide/notifications" },
            { text: "Live collaboration", link: "/guide/live-collaboration" },
            { text: "Variations", link: "/guide/variations" },
            { text: "Proposing changes", link: "/guide/pull-requests" },
            { text: "Moderation", link: "/guide/moderation" },
          ],
        },
        {
          text: "The app",
          items: [
            {
              text: "Installing & offline use",
              link: "/guide/install-and-offline",
            },
          ],
        },
        {
          text: "AI assistants",
          items: [
            { text: "Overview", link: "/guide/ai-assistants/overview" },
            { text: "Connecting", link: "/guide/ai-assistants/connect" },
            {
              text: "What it can do",
              link: "/guide/ai-assistants/what-it-can-do",
            },
            {
              text: "Live sessions",
              link: "/guide/ai-assistants/live-sessions",
            },
          ],
        },
      ],
    },
  },
});
