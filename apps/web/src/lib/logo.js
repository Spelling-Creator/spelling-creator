// The logo's shapes, the one place they are written down: a stencil
// letterboard with the letters cut out of it and the speller's pencil poking
// through them. Logo.jsx draws them inline, and scripts/icons.mjs writes every
// logo file from them (the favicon, the PWA icons, the docs site's logo and
// favicon, the MCP bundle's icon). Change a shape here, then run
// `pnpm --filter @spelling-creator/web icons`.
//
// Each `board` path is the board with its letters as real holes, and the
// stencil bridges left in. `inner` is a rectangle inside the board's rounded
// corners that covers every hole, for files that put a fill behind them.

export const LOGO_COLORS = {
  board: "#292929",
  // The board on a dark surface, where charcoal would vanish: dark --primary.
  boardOnDark: "#f0efeb",
  pencil: "#ffca3d",
  eraser: "#ffacec",
};

/** The square mark: the "A" alone. */
export const MARK = {
  width: 207,
  height: 207,
  inner: { x: 30, y: 18, width: 147, height: 171 },
  board:
    "M14 207a14 14 0 0 1-14-14V14A14 14 0 0 1 14 0h179a14 14 0 0 1 14 14v179a14 14 0 0 1-14 14zm28.4-26.2 10-3.8 33.3-74.5h35.6l33.4 74.5 9.9 3.8 3.7-10-30.6-68.3h23.8L169 95l-7.5-7.5H131L103.5 26 84.2 69 98 75.3l5.6-12.5 11 24.8h-22l2.8-6.4-13.7-6L76 87.4H45.5L38 95l7.5 7.5h23.8l-30.6 68.4z",
  pencil: "M132.5 87.5h28L19.8 172.6l-7.5-12.4z",
  eraser: "m12.3 160.2 7.5 12.4-6 3.6-7.5-12.4z",
};

/** The full "ABC" board. */
export const BOARD = {
  width: 412.7,
  height: 207,
  inner: { x: 36, y: 18, width: 341, height: 171 },
  board:
    "M14 207a14 14 0 0 1-14-14V14A14 14 0 0 1 14 0h384.7a14 14 0 0 1 14 14v179a14 14 0 0 1-14 14zm34.3-26.2 10-3.8 33.3-74.5h35.6l33.4 74.5 9.9 3.8 3.7-10-30.6-68.3h23.8l7.5-7.5-7.5-7.5h-30.5L109.4 26 90.1 69l13.7 6.2 5.6-12.5 11 24.8h-22l2.8-6.4-13.7-6-5.6 12.4H51.4L43.9 95l7.5 7.5h23.8l-30.6 68.4zM241.5 26H191v37.5h15V41h29.4L246 51.6V82l-10.6 10.6H206V70h-15v63.5h15v-26h34.4l15.6 15.6v27.3L240.3 166h-34.4v-26h-15v41h55.6l24.4-24.4V117l-19.4-19.4 9.4-9.4V45.4zm127.3 6.3-8.6-6.2-32.6 5.4-36.7 40.6V135l36.7 40.6 32.6 5.4 8.6-6.2-6.2-8.6-27.4-4.6-29.3-32.4V78l29.3-32.4 27.4-4.6z",
  pencil: "M138.4 87.5h28L19.7 176.2l-7.5-12.4z",
  eraser: "m12.2 163.8 7.5 12.4-6 3.7-7.5-12.4z",
};
