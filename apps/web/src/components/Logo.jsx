// The app's logo: a stencil letterboard, with the speller's pencil poking
// through the letters. The shapes live in lib/logo.js, which also feeds the
// favicon and the PWA icons (see "The logo" in the design system docs).
//
// Drawn inline rather than as an <img> so the mark can follow the theme. The
// letters are real cut-outs with nothing behind them, so they show whatever
// the logo sits on. The mark's board is --primary: charcoal on the light
// header, and light on the dark one, where charcoal would vanish. The ABC
// board is only shown in the home page's hero, which puts a warm light behind
// it, so it stays charcoal and that light shines through its letters.
//
// Both are decorative (aria-hidden): the mark sits in links and headings that
// carry the app's name themselves, and the board sits above the hero's
// headline.

import { BOARD, LOGO_COLORS, MARK } from "../lib/logo.js";
import { cn } from "../lib/utils.js";

function LogoShape({ shape, boardFill, className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${shape.width} ${shape.height}`}
      width={shape.width}
      height={shape.height}
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
    >
      <path fill={boardFill} d={shape.board} />
      <path fill={LOGO_COLORS.pencil} d={shape.pencil} />
      <path fill={LOGO_COLORS.eraser} d={shape.eraser} />
    </svg>
  );
}

/** The square "A" mark, for the header and anywhere an icon-sized logo goes. */
export function LogoMark({ className }) {
  return (
    <LogoShape shape={MARK} boardFill="var(--primary)" className={className} />
  );
}

/** The full "ABC" board, for the home page hero. */
export function LogoBoard({ className }) {
  return (
    <LogoShape
      shape={BOARD}
      boardFill={LOGO_COLORS.board}
      className={className}
    />
  );
}
