// The app's logo: a stencil letterboard, with the speller's pencil poking
// through the letters.
//
// The letters are real cut-outs in the board, so they show whatever the logo
// sits on. The mark is a charcoal board, which would make its letters vanish
// against the dark header, so it carries a white backing behind them, like the
// paper under a stencil. The board is only ever shown on the home page's hero,
// which puts a warm light behind it, so it has no backing and that light shines
// through its letters, like a stencil held up to a lamp. The same square mark
// is the favicon and, rasterized, the PWA icons (see "The manifest and icons"
// in the PWA docs).
//
// Both are decorative (alt=""): the mark always sits beside the app's name, and
// the board sits above the hero's headline.

import markUrl from "../favicon.svg";
import boardUrl from "../logo-board.svg";
import { cn } from "../lib/utils.js";

/** The square "A" mark, for the header and anywhere an icon-sized logo goes. */
export function LogoMark({ className }) {
  return (
    <img
      src={markUrl}
      alt=""
      width={207}
      height={207}
      draggable={false}
      className={cn("shrink-0", className)}
    />
  );
}

/** The full "ABC" board, for the home page hero. */
export function LogoBoard({ className }) {
  return (
    <img
      src={boardUrl}
      alt=""
      width={413}
      height={207}
      draggable={false}
      className={cn("shrink-0", className)}
    />
  );
}
