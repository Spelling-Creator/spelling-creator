// The link-preview cards: what a lesson, a profile, the hub and the home page
// look like when a link to them is pasted into a chat or a social feed.
//
// Each function returns an element tree for Satori, which lays it out like a
// browser would and draws it as SVG (see ./render.js). The trees are plain
// objects rather than JSX because this is the API package, which has no JSX
// transform, and because Satori wants nothing React-specific: `type`, `props`,
// `children` and inline `style`. Three of Satori's rules shape the code below.
// A container with more than one child has to say `display: 'flex'`, text has
// to sit inside an element of its own, and a box is content-box unless it says
// otherwise, so the padded frame has to ask for border-box or its padding
// pushes the content past the edge of the canvas.
//
// Colors, radii and type are the web app's light theme, copied from
// apps/web/src/styles/globals.css rather than imported: a card is a picture of
// the app, not an instance of it, and the preview a scraper caches has no
// theme toggle. Light is the one that reads on every platform's chrome.

import { LOGO_PNG } from './logo.js';
import { placeholderPng } from './placeholder.js';

const SITE_NAME = 'Spelling Lesson Maker';
const HUB_TITLE = 'Lesson hub';
const HUB_DESCRIPTION = 'Browse and copy community-made spelling lessons, then print or export them.';
const HOME_DESCRIPTION = 'Create, share and print Spelling lessons with a focused editor, AI help, images and live collaboration.';

const BACKGROUND = '#f3f5fc';
const FOREGROUND = '#1e2138';
const MUTED = '#585d80';
const PRIMARY = '#4f5fd9';
const PRIMARY_FOREGROUND = '#f2f3ff';
const BORDER = '#d5daed';

const SERIF = 'Fraunces';
const SANS = 'Public Sans';

/** The key the lesson picture's placeholder carries (see ./placeholder.js and ./render.js). */
export const PICTURE_KEY = 'picture';

/** The card's size: the standard Open Graph and Twitter large-image shape. */
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

const PADDING = 56;
// What is left for the body once the brand row and the gap below it are drawn.
const BODY_HEIGHT = CARD_HEIGHT - PADDING * 2 - 44 - 36;

/** A Satori element. */
function h(type, props, ...children) {
	return { type, props: { ...props, children: children.length === 1 ? children[0] : children } };
}

function text(content, style) {
	return h('div', { style }, content);
}

/** The outer frame every card shares. */
function frame(...children) {
	return h(
		'div',
		{
			style: {
				display: 'flex',
				flexDirection: 'column',
				boxSizing: 'border-box',
				width: '100%',
				height: '100%',
				padding: PADDING,
				backgroundColor: BACKGROUND,
				color: FOREGROUND,
				fontFamily: SANS,
			},
		},
		...children,
	);
}

// The app icon: the PNG one (see ./logo.js) rather than the SVG, because the
// SVG draws its letter with strokes and the rasterizer only fills; see
// ./raster.js.
function logoImage(size) {
	return h('img', { src: LOGO_PNG, width: size, height: size, style: { width: size, height: size } });
}

/** The logo and site name on the left, the host on the right. */
function brandRow(host) {
	return h(
		'div',
		{ style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 44 } },
		h(
			'div',
			{ style: { display: 'flex', alignItems: 'center' } },
			logoImage(44),
			text(SITE_NAME, { marginLeft: 16, fontSize: 26, fontWeight: 600 }),
		),
		text(host, { fontSize: 24, color: MUTED }),
	);
}

function eyebrow(label) {
	return text(label.toUpperCase(), { fontSize: 22, fontWeight: 600, letterSpacing: 3, color: PRIMARY });
}

// A title is set smaller the longer it is, so a long one still fits its three
// lines rather than ending in an ellipsis at the first opportunity.
function titleSize(title, { max = 64, min = 44 } = {}) {
	const length = title.length;
	if (length <= 40) return max;
	if (length >= 110) return min;
	return Math.round(max - ((length - 40) / 70) * (max - min));
}

// `lineClamp` only applies to a text element that is `display: 'block'`.
function heading(title, size) {
	return text(title, {
		display: 'block',
		marginTop: 16,
		fontFamily: SERIF,
		fontWeight: 600,
		fontSize: size,
		lineHeight: 1.12,
		letterSpacing: -0.5,
		lineClamp: 3,
	});
}

function metaLine(parts, extra = {}) {
	return text(parts.filter(Boolean).join('  ·  '), {
		display: 'block',
		marginTop: 24,
		fontSize: 28,
		color: MUTED,
		lineClamp: 2,
		...extra,
	});
}

function monthAndYear(value) {
	if (!value) return '';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	// In UTC, so the card says the same month on every host: the lesson's
	// created_at is a UTC timestamp and the server's own zone is an accident.
	return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function plural(count, noun) {
	if (typeof count !== 'number' || !Number.isFinite(count)) return '';
	return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * A lesson: its title, who made it, how big it is, and its first picture when
 * it has one.
 *
 * @param {object} lesson
 * @param {string} [lesson.title]
 * @param {string} [lesson.author]
 * @param {number} [lesson.sectionCount]
 * @param {string} [lesson.createdAt]
 * @param {import('./picture.js').Picture | null} [lesson.picture] The decoded
 *   picture. The tree carries a placeholder for it (see ./placeholder.js); the
 *   same picture goes to `renderCard`, which draws the pixels in its place.
 * @param {string} lesson.host The site's host name, for the brand row.
 */
export function lessonCard({ title, author, sectionCount, createdAt, picture, host }) {
	const name = (title || '').trim() || 'Untitled Lesson';
	const by = (author || '').trim();
	const column = h(
		'div',
		{ style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1, minWidth: 0 } },
		eyebrow('Lesson'),
		heading(name, titleSize(name)),
		metaLine([by && `By ${by}`, plural(sectionCount, 'section'), monthAndYear(createdAt)]),
	);
	const children = [column];
	if (picture) {
		// The border is a filled box behind the picture, not a CSS border: a
		// border becomes a stroked path in the SVG, and the rasterizer only fills.
		const side = BODY_HEIGHT;
		const edge = 2;
		const inner = side - edge * 2;
		children.push(
			h(
				'div',
				{ style: { display: 'flex', marginLeft: 48, padding: edge, borderRadius: 24 + edge, backgroundColor: BORDER } },
				h('img', {
					src: placeholderPng(picture.width, picture.height, PICTURE_KEY),
					width: inner,
					height: inner,
					style: { width: inner, height: inner, borderRadius: 24, objectFit: 'cover' },
				}),
			),
		);
	}
	return frame(brandRow(host), h('div', { style: { display: 'flex', alignItems: 'center', flex: 1, marginTop: 36 } }, ...children));
}

// Up to two initials, from the first letters of the first two words.
function initials(name) {
	const words = name.split(/\s+/).filter(Boolean);
	const letters = words.slice(0, 2).map((word) => [...word][0].toUpperCase());
	return letters.join('') || '?';
}

/**
 * A profile: the same initials avatar the profile page draws, the display name,
 * a line of the bio, and the counts.
 *
 * @param {object} profile
 * @param {string} [profile.displayName]
 * @param {string} [profile.bio] Plain text, not the stored rich text.
 * @param {number} [profile.lessonCount]
 * @param {number} [profile.followerCount]
 * @param {string} profile.host
 */
export function profileCard({ displayName, bio, lessonCount, followerCount, host }) {
	const name = (displayName || '').trim() || 'Anonymous';
	const line = (bio || '').replace(/\s+/g, ' ').trim() || `Lessons by ${name} on ${SITE_NAME}.`;
	const avatar = h(
		'div',
		{
			style: {
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				width: 180,
				height: 180,
				borderRadius: 999,
				backgroundColor: PRIMARY,
				color: PRIMARY_FOREGROUND,
				fontFamily: SERIF,
				fontWeight: 600,
				fontSize: 80,
			},
		},
		text(initials(name), {}),
	);
	const column = h(
		'div',
		{ style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1, minWidth: 0, marginLeft: 48 } },
		eyebrow('Profile'),
		heading(name, titleSize(name, { max: 64, min: 48 })),
		metaLine([line], { lineClamp: 2 }),
		metaLine([plural(lessonCount, 'lesson'), plural(followerCount, 'follower')], { marginTop: 12, fontWeight: 600 }),
	);
	return frame(brandRow(host), h('div', { style: { display: 'flex', alignItems: 'center', flex: 1, marginTop: 36 } }, avatar, column));
}

/**
 * The hub listing: a title and the page's description.
 * @param {{host: string}} opts
 */
export function hubCard({ host }) {
	return frame(
		brandRow(host),
		h(
			'div',
			{ style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1, marginTop: 36 } },
			heading(HUB_TITLE, 72),
			metaLine([HUB_DESCRIPTION], { fontSize: 32, lineClamp: 3 }),
		),
	);
}

/**
 * The home page, and any path that is not a page with a card of its own: the
 * site itself. The brand row would repeat the title here, so the logo moves
 * beside it instead.
 * @param {{host: string}} opts
 */
export function homeCard({ host }) {
	return frame(
		h(
			'div',
			{ style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1 } },
			logoImage(96),
			heading(SITE_NAME, 72),
			metaLine([HOME_DESCRIPTION], { fontSize: 32, lineClamp: 3 }),
		),
		text(host, { fontSize: 24, color: MUTED }),
	);
}
