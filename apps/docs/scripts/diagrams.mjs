// Re-exports every docs/diagrams/*.drawio.svg through the draw.io desktop CLI.
//
// Each diagram is a single .drawio.svg: an SVG the docs show as an image, with
// the editable draw.io diagram embedded in it. Edit one in draw.io (or the
// Draw.io Integration extension for VS Code), then run this to export it again
// the same way as the rest: a 10px border, colors that follow the docs' light
// and dark themes, and no PNG fallbacks. draw.io draws every HTML label twice,
// once as HTML and once as a PNG for viewers without foreignObject. Every
// browser has foreignObject, the PNGs are most of the file, and they ignore
// dark mode, so they're stripped.
//
// Usage: pnpm --filter @spelling-creator/docs diagrams [name.drawio.svg ...]
// Set DRAWIO to the CLI's path if it isn't `drawio` on PATH or the macOS app.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = path.join(import.meta.dirname, "../docs/diagrams");
const MAC_APP = "/Applications/draw.io.app/Contents/MacOS/draw.io";

function findDrawio() {
  if (process.env.DRAWIO) return process.env.DRAWIO;
  try {
    execFileSync("drawio", ["--version"], { stdio: "ignore" });
    return "drawio";
  } catch {
    if (fs.existsSync(MAC_APP)) return MAC_APP;
  }
  throw new Error(
    "Couldn't find the draw.io desktop CLI. Install draw.io, or set DRAWIO to its path.",
  );
}

const drawio = findDrawio();
const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(dir).filter((name) => name.endsWith(".drawio.svg"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "docs-diagrams-"));

try {
  for (const name of names) {
    const file = path.join(dir, path.basename(name));
    const out = path.join(tmp, path.basename(name));
    execFileSync(
      drawio,
      ["-x", "-f", "svg", "-e", "-b", "10", "-o", out, file],
      {
        stdio: ["ignore", "ignore", "inherit"],
      },
    );
    const svg = fs
      .readFileSync(out, "utf8")
      .replace(/(<\/foreignObject>)<image\b[^>]*\/>/g, "$1");
    fs.writeFileSync(file, svg);
    console.log(`${path.basename(name)}: ${Math.round(svg.length / 1024)} KB`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
