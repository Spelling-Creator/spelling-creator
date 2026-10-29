// Writes every logo file from the shapes in src/lib/logo.js, so a change to
// the logo is made once and can't leave one copy behind.
//
// The letters are real cut-outs, so each file decides what shows through them:
//
// - src/favicon.svg: nothing, so the browser tab shows through. The board is
//   charcoal, or light when the OS is in dark mode, where tabs are dark too.
// - public/icons/icon.svg and its PNGs: an app icon has no page behind it, so
//   a warm light sits behind the letters, the same light the home page hero
//   shines through its board.
// - public/icons/maskable.svg and its PNGs: the platform crops this one to its
//   own shape, so the light fills the whole square and the mark sits inside
//   the safe zone (the center 80% circle).
// - apps/docs/docs/public/img/logo.svg and logo-dark.svg: the docs site's
//   light and dark themes, each with nothing behind the letters.
// - apps/docs/docs/public/img/favicon.ico and apps/mcp/icon.png: rasterized
//   from the app icon.
//
// The ABC board isn't written to a file: only Logo.jsx draws it, inline.
//
// Usage: pnpm --filter @spelling-creator/web icons

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { LOGO_COLORS, MARK } from "../src/lib/logo.js";

const web = path.join(import.meta.dirname, "..");
const repo = path.join(web, "../..");
const icons = path.join(web, "public/icons");
const docsImg = path.join(repo, "apps/docs/docs/public/img");

// The light behind the letters, matching the hero's.
const LIGHT = `<radialGradient id="light"><stop offset="0" stop-color="#fffbef"/><stop offset="0.6" stop-color="#fff0c4"/><stop offset="1" stop-color="#ffe08a"/></radialGradient>`;

function shapes(shape, boardFill) {
  return [
    `<path fill="${boardFill}" d="${shape.board}"/>`,
    `<path fill="${LOGO_COLORS.pencil}" d="${shape.pencil}"/>`,
    `<path fill="${LOGO_COLORS.eraser}" d="${shape.eraser}"/>`,
  ].join("");
}

// `size` is the drawn width and height when it differs from the viewBox.
function svg(width, height, body, size) {
  const [w, h] = size ? [size, size] : [width, height];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${width} ${height}">${body}</svg>\n`;
}

function write(file, contents) {
  fs.writeFileSync(file, contents);
  console.log(path.relative(repo, file));
}

const favicon = svg(
  MARK.width,
  MARK.height,
  `<style>.board{fill:${LOGO_COLORS.board}}@media (prefers-color-scheme:dark){.board{fill:${LOGO_COLORS.boardOnDark}}}</style>` +
    shapes(MARK, LOGO_COLORS.board).replace(
      `fill="${LOGO_COLORS.board}"`,
      `class="board"`,
    ),
);

const { x, y, width, height } = MARK.inner;
const icon = svg(
  MARK.width,
  MARK.height,
  `<defs>${LIGHT}</defs><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="url(#light)"/>` +
    shapes(MARK, LOGO_COLORS.board),
  512,
);

// Scale 1.6 keeps the farthest point of the mark, the eraser, about 194px from
// the center of a 512px icon, inside the safe zone's 204.8px radius.
const maskable = svg(
  512,
  512,
  `<defs>${LIGHT}</defs><rect width="512" height="512" fill="url(#light)"/>` +
    `<g transform="translate(256 256) scale(1.6) translate(${-MARK.width / 2} ${-MARK.height / 2})">${shapes(MARK, LOGO_COLORS.board)}</g>`,
);

write(path.join(web, "src/favicon.svg"), favicon);
write(path.join(icons, "icon.svg"), icon);
write(path.join(icons, "maskable.svg"), maskable);
write(
  path.join(docsImg, "logo.svg"),
  svg(MARK.width, MARK.height, shapes(MARK, LOGO_COLORS.board)),
);
write(
  path.join(docsImg, "logo-dark.svg"),
  svg(MARK.width, MARK.height, shapes(MARK, LOGO_COLORS.boardOnDark)),
);

// Both sources are 512px; density 288 renders them at 2048px before scaling
// down, for clean edges at every size.
const png = (source, size) =>
  sharp(Buffer.from(source), { density: 288 })
    .resize(size, size)
    .png()
    .toBuffer();

for (const [file, source, size] of [
  [path.join(icons, "icon-192.png"), icon, 192],
  [path.join(icons, "icon-512.png"), icon, 512],
  [path.join(icons, "maskable-512.png"), maskable, 512],
  // iOS rounds its own corners and shows nothing through a transparent one,
  // so the apple-touch icon is the full-bleed maskable square.
  [path.join(icons, "apple-touch-icon.png"), maskable, 180],
  [path.join(repo, "apps/mcp/icon.png"), icon, 512],
]) {
  write(file, await png(source, size));
}

// An .ico is a directory of PNGs: a 6-byte header, a 16-byte entry per image
// (a size of 256 is written as 0), then the images.
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map((size) => png(icon, size)));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const entry = 6 + 16 * i;
  header.writeUInt8(size % 256, entry);
  header.writeUInt8(size % 256, entry + 1);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[i].length;
});
write(path.join(docsImg, "favicon.ico"), Buffer.concat([header, ...images]));
