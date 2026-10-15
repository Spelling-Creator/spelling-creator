// The fonts a link-preview card is set in: the app's own two faces (see
// `--font-serif` and `--font-sans` in apps/web/src/styles/globals.css), from
// the same @fontsource packages the web app installs.
//
// Satori cannot use system fonts, so it has to be handed the bytes. The `.woff`
// files rather than the `.woff2` ones the browser gets: Satori reads TTF, OTF
// and WOFF, not WOFF2. Latin and Latin Extended together cover the accented
// letters of the European languages a lesson title is likely to be in; a glyph
// outside both (another script, an emoji) is drawn as nothing.
//
// Each host loads these its own way (see runtime.node.js and
// runtime.workerd.js); this list is what they agree on.

/**
 * @typedef {object} LoadedFont
 * @property {string} name
 * @property {400 | 600} weight
 * @property {'normal'} style
 * @property {ArrayBuffer} data
 */

export const FONT_FILES = [
	{ name: 'Fraunces', weight: 600, file: '@fontsource/fraunces/files/fraunces-latin-600-normal.woff' },
	{ name: 'Fraunces', weight: 600, file: '@fontsource/fraunces/files/fraunces-latin-ext-600-normal.woff' },
	{ name: 'Public Sans', weight: 400, file: '@fontsource/public-sans/files/public-sans-latin-400-normal.woff' },
	{ name: 'Public Sans', weight: 400, file: '@fontsource/public-sans/files/public-sans-latin-ext-400-normal.woff' },
	{ name: 'Public Sans', weight: 600, file: '@fontsource/public-sans/files/public-sans-latin-600-normal.woff' },
	{ name: 'Public Sans', weight: 600, file: '@fontsource/public-sans/files/public-sans-latin-ext-600-normal.woff' },
];
