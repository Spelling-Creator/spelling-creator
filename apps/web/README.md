# Spelling Creator (web app)

A web app for building, sharing and printing lessons for **Spelling**, the
umbrella term for ways nonspeaking people communicate by pointing to letters.
Spelling is not one method: it covers [S2C](https://i-asc.org), RPM,
[Spellers Method](https://www.spellers.com) and many practices with no label,
none of them standardized (see
[What is Spelling Creator?](https://spellingcreator.org/docs/intro)). Create a
document, add named sections, and fill each section with text and images. Export
the finished lesson as a Word document (`.docx`) or print it to PDF.

Built with **React + Vite + shadcn/ui + Tailwind**, using [`docx`](https://docx.js.org) for Word
export and [`html2pdf.js`](https://github.com/eKoopmans/html2pdf.js) (via
[`mammoth`](https://github.com/mwilliamson/mammoth.js) docx→HTML conversion) for
PDF printing.

## Documentation

The docs site has two halves:

- **[User guide](https://spellingcreator.org/docs/guide/overview)**: what the
  app does and how to use each feature.
- **[Developers: web app](https://spellingcreator.org/docs/developers/web-app/overview)**:
  how it is built, with a page per feature's internals. Good places to start:
  - [Getting started & environment variables](https://spellingcreator.org/docs/developers/web-app/getting-started)
  - [Project structure](https://spellingcreator.org/docs/developers/web-app/project-structure)
  - [Pages & routing](https://spellingcreator.org/docs/developers/web-app/pages-and-routing)
  - [How the export pipeline works](https://spellingcreator.org/docs/developers/web-app/export-pipeline)
  - [Design system](https://spellingcreator.org/docs/developers/web-app/design-system)
  - [Installable app & offline use](https://spellingcreator.org/docs/developers/web-app/pwa-and-offline)

The docs source is in `apps/docs/docs/guide` and
`apps/docs/docs/developers/web-app`.

## Quick start

```bash
pnpm install
pnpm dev      # start the dev server (https://spelling-creator.localhost, through portless)
pnpm build    # production build into dist/
pnpm preview  # preview the production build (https://preview.spelling-creator.localhost)
```

See **[Getting started](https://spellingcreator.org/docs/developers/web-app/getting-started)**
for the environment variables each feature needs.
