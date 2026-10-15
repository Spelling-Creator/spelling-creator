// The link-preview cards, end to end on this runtime: the layout engine loads,
// the fonts resolve, the rasterizer draws what Satori writes, a WEBP lesson
// picture reaches the PNG, and the route turns a path into the right card
// without ever turning a missing lesson into a missing image.
//
// Node only. `#og-runtime` resolves to a different module per runtime, like
// `#image-codec-wasm`, and this project is the one that exercises the Node
// half (see vitest.node.config.js); the Workers half is checked by bundling
// the Worker in CI, since vitest-pool-workers cannot resolve a `.wasm` import
// out of node_modules. The rasterizer itself is plain JavaScript and the same
// on both.

import { beforeAll, describe, expect, it } from 'vitest';

import { convertImageToWebp } from '../imageConvert.js';
import { cardForPath, handleOgImage, previewPath } from '../routes/og.js';
import { CARD_HEIGHT, CARD_WIDTH, PICTURE_KEY, homeCard, hubCard, lessonCard, profileCard } from './card.js';
import { pngDecoder } from './codecs.js';
import { downscale, firstPictureHash, jpegDimensions, loadPicture, pngDimensions, webpDimensions } from './picture.js';
import { placeholderKey, placeholderPng } from './placeholder.js';
import { encodePngBytes } from './pngFixture.js';
import { coverageOf, flattenPath, parseColor, parseXml, rasterize } from './raster.js';
import { renderCard, renderSvg } from './render.js';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Width and height from a PNG's IHDR chunk. */
function pngSize(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** A solid-color RGBA image. */
function solid(width, height, [r, g, b, a = 255]) {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let i = 0; i < data.length; i += 4) {
		data[i] = r;
		data[i + 1] = g;
		data[i + 2] = b;
		data[i + 3] = a;
	}
	return { width, height, data };
}

/**
 * A solid red WEBP, made the way an upload is: a PNG through the converter.
 * Big enough that WEBP wins the "keep whichever is smaller" comparison.
 */
async function redWebp(size = 96) {
	const png = await encodePngBytes(solid(size, size, [220, 40, 40]));
	const result = await convertImageToWebp(png, 'image/png');
	expect(result.contentType).toBe('image/webp');
	return result.bytes;
}

/** The red WEBP, fetched and decoded the way the route does it. */
async function redPicture() {
	const picture = await loadPicture('https://spelling.test', 'abc', {
		fetch: async () => new Response(await redWebp(), { headers: { 'Content-Type': 'image/webp' } }),
	});
	expect(picture).toMatchObject({ width: 96, height: 96 });
	return picture;
}

async function decode(png) {
	return (await pngDecoder())(png);
}

function pixelAt(image, x, y) {
	const i = (y * image.width + x) * 4;
	return Array.from(image.data.slice(i, i + 4));
}

const env = { PLATFORM: null };
const url = new URL('https://spelling.test/og-image');
const host = 'spelling.test';

describe('raster', () => {
	it('parses the XML Satori writes', () => {
		const svg = parseXml('<?xml version="1.0"?><svg width="2" height="2"><!-- c --><g><path d="M0 0" fill="#fff"/></g></svg>');
		expect(svg.attrs).toEqual({ width: '2', height: '2' });
		expect(svg.children[0].name).toBe('g');
		expect(svg.children[0].children[0].attrs.fill).toBe('#fff');
		expect(() => parseXml('<svg><g></svg>')).toThrow(/Malformed/);
	});

	it('refuses a tag it cannot read rather than skipping it', () => {
		// An unquoted attribute is not a tag this parser knows. Skipping it would
		// drop the element silently, which for a glyph means a missing letter.
		expect(() => parseXml('<svg width="2" height="2"><path d=M0,0 fill="#fff"/></svg>')).toThrow(/could not parse the tag/);
		expect(() => parseXml('<svg width="2" height="2"></svg><')).toThrow(/could not parse the tag/);
	});

	it('reads colors the way the cards write them', () => {
		expect(parseColor('#4f5fd9')).toEqual({ r: 0x4f / 255, g: 0x5f / 255, b: 0xd9 / 255, a: 1 });
		expect(parseColor('#fff')).toEqual({ r: 1, g: 1, b: 1, a: 1 });
		expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
		expect(parseColor('none')).toBeNull();
		expect(() => parseColor('url(#g)')).toThrow(/Unsupported/);
	});

	it('flattens paths, arcs included, into closed polygons', () => {
		// A square, then a rounded square: the arcs must land on their end points.
		expect(flattenPath('M0 0 L10 0 L10 10 L0 10 Z')).toEqual([[0, 0, 10, 0, 10, 10, 0, 10]]);
		const [rounded] = flattenPath('M4,0 h12 a4,4 0 0 1 4,4 v12 a4,4 0 0 1 -4,4 h-12 a4,4 0 0 1 -4,-4 v-12 a4,4 0 0 1 4,-4');
		expect(rounded.length).toBeGreaterThan(16);
		for (let i = 0; i < rounded.length; i += 2) {
			expect(rounded[i]).toBeGreaterThanOrEqual(-1e-6);
			expect(rounded[i]).toBeLessThanOrEqual(20 + 1e-6);
		}
		// Quadratic and cubic curves, as glyph outlines use them.
		const [curve] = flattenPath('M0 0 Q5 10 10 0 C 12 5 14 5 16 0 z');
		expect(curve.length).toBeGreaterThan(8);
		// A closed subpath with fewer than three points encloses nothing.
		expect(flattenPath('M10 10 Z M0 0 L5 0 Z')).toEqual([]);
		expect(() => flattenPath('M0 0 X')).toThrow(/Unsupported path command/);
	});

	it('computes exact coverage for a half-pixel edge', () => {
		// A 4x4 square offset by half a pixel: its edge columns and rows are half
		// covered, its interior fully, and nothing lands outside.
		const cov = coverageOf([[0.5, 0.5, 4.5, 0.5, 4.5, 4.5, 0.5, 4.5]], 8, 8);
		const at = (x, y) => cov.cov[(y - cov.y0) * cov.w + (x - cov.x0)];
		expect(at(2, 2)).toBeCloseTo(1, 5);
		expect(at(0, 2)).toBeCloseTo(0.5, 5);
		expect(at(4, 2)).toBeCloseTo(0.5, 5);
		expect(at(0, 0)).toBeCloseTo(0.25, 5);
		expect(cov.x0 + cov.w).toBe(5);
		expect(cov.y0 + cov.h).toBe(5);
	});

	it('clips a shape that runs off the canvas', () => {
		const cov = coverageOf([[-10, -10, 3, -10, 3, 3, -10, 3]], 4, 4);
		expect(cov.x0).toBe(0);
		expect(cov.y0).toBe(0);
		expect(cov.cov[0]).toBeCloseTo(1, 5);
		expect(cov.cov[2 * cov.w + 2]).toBeCloseTo(1, 5);
	});

	it('draws fills, clips, masks and images', async () => {
		const red = await encodePngBytes(solid(4, 4, [255, 0, 0]));
		const b64 = btoa(String.fromCharCode(...red));
		const svg =
			'<svg width="10" height="10" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">' +
			'<mask id="m"><rect x="0" y="0" width="10" height="5" fill="#fff"/></mask>' +
			'<clipPath id="c"><rect x="0" y="0" width="5" height="10"/></clipPath>' +
			'<rect x="0" y="0" width="10" height="10" fill="#0000ff"/>' +
			`<image x="0" y="0" width="10" height="10" href="data:image/png;base64,${b64}" preserveAspectRatio="none" clip-path="url(#c)" mask="url(#m)"/>` +
			'<g><path d="M8 8 L10 8 L10 10 L8 10 Z" fill="#00ff00"/></g>' +
			'</svg>';
		const image = await rasterize(svg, { decodeImage: async (bytes) => (await pngDecoder())(bytes) });
		expect([image.width, image.height]).toEqual([10, 10]);
		expect(pixelAt(image, 2, 2)).toEqual([255, 0, 0, 255]); // image, inside clip and mask
		expect(pixelAt(image, 7, 2)).toEqual([0, 0, 255, 255]); // outside the clip
		expect(pixelAt(image, 2, 7)).toEqual([0, 0, 255, 255]); // outside the mask
		expect(pixelAt(image, 9, 9)).toEqual([0, 255, 0, 255]); // the path
	});

	it('draws an image that sits partly off the canvas without reading past its pixels', async () => {
		// A box larger than the canvas and offset so the sampled source box runs
		// past the image's last row and column: every pixel must still be a
		// number, never NaN from an empty sample.
		const svg =
			'<svg width="4" height="4" xmlns="http://www.w3.org/2000/svg">' +
			'<image x="-6" y="-6" width="12" height="12" href="data:image/png;base64,AA==" preserveAspectRatio="none"/>' +
			'</svg>';
		const image = await rasterize(svg, { decodeImage: async () => solid(2, 2, [10, 20, 30]) });
		for (let i = 0; i < image.data.length; i += 4) expect(pixelAt(image, (i / 4) % 4, Math.floor(i / 16))).toEqual([10, 20, 30, 255]);
	});

	it('refuses what it cannot draw rather than drawing it wrong', async () => {
		const decodeImage = async () => solid(1, 1, [0, 0, 0]);
		await expect(rasterize('<svg width="4" height="4"><path d="M0 0 L4 4" stroke="#000"/></svg>', { decodeImage })).rejects.toThrow(
			/stroke/,
		);
		await expect(rasterize('<svg width="4" height="4"><g transform="scale(2)"/></svg>', { decodeImage })).rejects.toThrow(/transform/);
		await expect(rasterize('<svg width="4" height="4"><text>hi</text></svg>', { decodeImage })).rejects.toThrow(/<text>/);
	});
});

describe('placeholder', () => {
	it('carries a size Satori can read and a key the rasterizer can find', () => {
		const bytes = new Uint8Array(placeholderPng(880, 440, 'picture'));
		expect(pngDimensions(bytes)).toEqual({ width: 880, height: 440 });
		expect(placeholderKey(bytes)).toBe('picture');
		expect(placeholderKey(new Uint8Array([1, 2, 3]))).toBeNull();
	});

	it('is not mistaken for a real PNG', async () => {
		expect(placeholderKey(await encodePngBytes(solid(2, 2, [0, 0, 0])))).toBeNull();
	});
});

describe('renderCard', () => {
	it('draws each card as a 1200x630 PNG', async () => {
		for (const card of [
			lessonCard({ title: 'Domestic Cats', author: 'Oliver', sectionCount: 6, createdAt: '2026-08-01T00:00:00Z', host }),
			profileCard({ displayName: 'Ada Lovelace', bio: 'Lessons about engines.', lessonCount: 3, followerCount: 1, host }),
			hubCard({ host }),
			homeCard({ host }),
		]) {
			const png = await renderCard(card);
			expect(Array.from(png.subarray(0, 8))).toEqual(PNG_MAGIC);
			expect(pngSize(png)).toEqual({ width: CARD_WIDTH, height: CARD_HEIGHT });
		}
	});

	it('puts text on the page, in the theme colors', async () => {
		const image = await decode(await renderCard(hubCard({ host })));
		// The background everywhere nothing is drawn, and dark ink across the band
		// the title sits in: a card whose glyph paths were lost would be all
		// background.
		expect(pixelAt(image, CARD_WIDTH - 10, CARD_HEIGHT - 10)).toEqual([0xf3, 0xf5, 0xfc, 255]);
		let ink = 0;
		for (let y = 300; y < 460; y += 4) {
			for (let x = 56; x < 600; x += 1) {
				const [r] = pixelAt(image, x, y);
				if (r < 0x80) ink += 1;
			}
		}
		expect(ink).toBeGreaterThan(500);
	});

	it('draws a WEBP lesson picture', async () => {
		// The picture box is on the right of the card: its center pixel is red
		// only if the WEBP was decoded, shrunk, stood in for by a placeholder in
		// the SVG, and drawn from the decoded pixels.
		const picture = await redPicture();
		const png = await renderCard(lessonCard({ title: 'With a picture', picture, host }), { picture });
		const image = await decode(png);
		const [r, g, b] = pixelAt(image, CARD_WIDTH - 56 - 200, CARD_HEIGHT / 2 + 20);
		expect(r).toBeGreaterThan(180);
		expect(g).toBeLessThan(90);
		expect(b).toBeLessThan(90);
	});

	it('will not draw a placeholder it was given no picture for', async () => {
		const picture = await redPicture();
		await expect(renderCard(lessonCard({ title: 'Orphan', picture, host }))).rejects.toThrow(/no picture was given/);
	});

	it('stays inside the SVG subset the rasterizer draws', async () => {
		// Satori writes a border as a stroked path and a border as a filled box;
		// the cards must keep producing the latter. Checked at the SVG, so a card
		// change that strays shows up as this rather than as a render failure.
		const picture = await redPicture();
		const svg = await renderSvg(lessonCard({ title: 'Bordered', picture, host }));
		expect(svg).not.toMatch(/stroke="(?!none)/);
		expect(svg).not.toMatch(/transform=/);
		expect(svg).not.toMatch(/<text/);
		// And the picture went in as its placeholder, not as a re-encoded PNG.
		const keys = [...svg.matchAll(/href="data:image\/png;base64,([^"]+)"/g)].map(([, b64]) =>
			placeholderKey(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))),
		);
		expect(keys).toContain(PICTURE_KEY);
	});
});

describe('picture', () => {
	it('reads sizes from headers without decoding', async () => {
		expect(webpDimensions(await redWebp(96))).toEqual({ width: 96, height: 96 });
		expect(webpDimensions(new Uint8Array(64))).toBeNull();
		expect(pngDimensions(await encodePngBytes(solid(7, 3, [0, 0, 0])))).toEqual({ width: 7, height: 3 });
		expect(pngDimensions(new Uint8Array(64))).toBeNull();
		// A minimal JPEG header: SOI, then an SOF0 frame marker with a 5x9 frame.
		const frame = [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x09, 0x00, 0x05, 0x01, 0x01, 0x11, 0x00];
		expect(jpegDimensions(new Uint8Array([0xff, 0xd8, ...frame, 0xff, 0xd9]))).toEqual({ width: 5, height: 9 });
		// The frame header may end exactly at the end of the buffer.
		expect(jpegDimensions(new Uint8Array([0xff, 0xd8, ...frame.slice(0, 9)]))).toEqual({ width: 5, height: 9 });
		expect(jpegDimensions(new Uint8Array(64))).toBeNull();
	});

	it('finds the first image block, wherever it is', () => {
		const doc = {
			sections: [
				{ blocks: [{ type: 'text', text: 'hello' }] },
				{
					blocks: [
						{ type: 'image', image: { hash: 'first' } },
						{ type: 'image', image: { hash: 'second' } },
					],
				},
			],
		};
		expect(firstPictureHash(doc)).toBe('first');
		expect(firstPictureHash({ sections: [{ blocks: [] }] })).toBeNull();
		expect(firstPictureHash(null)).toBeNull();
	});

	it('shrinks by averaging and leaves a small image alone', () => {
		const big = solid(200, 100, [100, 150, 200]);
		const small = downscale(big, 50);
		expect([small.width, small.height]).toEqual([50, 25]);
		expect(pixelAt(small, 10, 10)).toEqual([100, 150, 200, 255]);
		expect(downscale(big, 400)).toBe(big);
	});

	it('keeps transparent pixels from darkening the opaque ones beside them', () => {
		// Two white opaque pixels next to two transparent black ones, shrunk 2:1.
		// Averaging the colors straight would give mid gray; weighting by alpha
		// keeps the color white and halves only the alpha.
		const image = { width: 2, height: 2, data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0]) };
		const small = downscale(image, 1);
		expect(pixelAt(small, 0, 0)).toEqual([255, 255, 255, 128]);
	});

	it('normalizes a PNG too, and shrinks it to the card size', async () => {
		const png = await encodePngBytes(solid(1000, 500, [0, 200, 0]));
		const out = await loadPicture('https://spelling.test', 'png', {
			fetch: async () => new Response(png, { headers: { 'Content-Type': 'image/png' } }),
		});
		expect(out).toMatchObject({ width: 880, height: 440 });
		expect(pixelAt(out, 10, 10)).toEqual([0, 200, 0, 255]);
	});

	it('leaves out a picture it cannot load', async () => {
		expect(await loadPicture('https://spelling.test', 'gone', { fetch: async () => new Response('no', { status: 404 }) })).toBeNull();
		expect(
			await loadPicture('https://spelling.test', 'odd', {
				fetch: async () => new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }),
			}),
		).toBeNull();
		expect(
			await loadPicture('https://spelling.test', 'down', {
				fetch: async () => {
					throw new Error('network');
				},
			}),
		).toBeNull();
	});
});

describe('the route', () => {
	it('keeps the path on this site and drops its query', () => {
		const at = (path) => previewPath(new URL(`https://spelling.test/og-image?path=${encodeURIComponent(path)}`));
		expect(at('/hub/abc?x=1#top')).toBe('/hub/abc');
		expect(at('//evil.example/')).toBe('/');
		expect(at('https://evil.example/')).toBe('/');
		expect(previewPath(new URL('https://spelling.test/og-image'))).toBe('/');
	});

	describe('with the API answering', () => {
		const realFetch = globalThis.fetch;
		beforeAll(() => {
			globalThis.fetch = async (input) => {
				const target = new URL(typeof input === 'string' ? input : input.url);
				if (target.pathname === '/lessons/cats') {
					return Response.json({
						lesson: {
							id: 'cats',
							title: 'Domestic Cats',
							author: 'Oliver',
							sectionCount: 6,
							createdAt: '2026-08-01T00:00:00Z',
							doc: { sections: [{ blocks: [{ type: 'image', image: { hash: 'pic' } }] }] },
						},
					});
				}
				if (target.pathname === '/images/pic') {
					return new Response(await redWebp(), { headers: { 'Content-Type': 'image/webp' } });
				}
				if (target.pathname === '/profiles/ada') {
					return Response.json({
						user: { id: 'ada', displayName: 'Ada Lovelace', bio: '<p>Engines <b>and</b> looms.</p>', followerCount: 2 },
						lessons: [{ id: 'a' }, { id: 'b' }],
					});
				}
				return new Response('Not found', { status: 404 });
			};
			return () => {
				globalThis.fetch = realFetch;
			};
		});

		/** A response cache that records what was stored. */
		function recordingCache() {
			const stored = [];
			const cache = {
				async match() {
					return null;
				},
				async put(key) {
					stored.push(key);
				},
				async delete() {},
			};
			return { stored, env: { PLATFORM: { cache } } };
		}

		it('builds a lesson card from the lesson, picture included', async () => {
			const { card, picture, fallback } = await cardForPath('/hub/cats', env, url);
			const json = JSON.stringify(card);
			expect(json).toContain('Domestic Cats');
			expect(json).toContain('By Oliver');
			expect(json).toContain('6 sections');
			expect(json).toContain('August 2026');
			expect(json).toContain('"objectFit":"cover"');
			expect(picture).toMatchObject({ width: 96, height: 96 });
			expect(fallback).toBe(false);
		});

		it('builds a profile card with the bio as plain text', async () => {
			const { card } = await cardForPath('/users/ada', env, url);
			const json = JSON.stringify(card);
			expect(json).toContain('Ada Lovelace');
			expect(json).toContain('Engines and looms.');
			expect(json).not.toContain('<b>');
			expect(json).toContain('2 lessons');
			expect(json).toContain('2 followers');
		});

		it('gives a missing lesson the site card, not an error, and says so', async () => {
			const { card, fallback } = await cardForPath('/hub/nope', env, url);
			expect(JSON.stringify(card)).toContain('Spelling Lesson Maker');
			expect(JSON.stringify(card)).not.toContain('"LESSON"');
			expect(fallback).toBe(true);
		});

		it('answers with a cacheable PNG', async () => {
			const { stored, env: cachingEnv } = recordingCache();
			const res = await handleOgImage(
				new Request('https://spelling.test/og-image?path=/hub/cats'),
				cachingEnv,
				{ waitUntil: (p) => p },
				new URL('https://spelling.test/og-image?path=/hub/cats'),
			);
			expect(res.status).toBe(200);
			expect(res.headers.get('content-type')).toBe('image/png');
			expect(res.headers.get('cache-control')).toContain('max-age=3600');
			const png = new Uint8Array(await res.arrayBuffer());
			expect(pngSize(png)).toEqual({ width: CARD_WIDTH, height: CARD_HEIGHT });
			expect(stored).toHaveLength(1);
		});

		it('does not cache the site card standing in for a page it could not read', async () => {
			// An API hiccup at the moment a link is first shared must not pin the
			// generic card to that lesson for an hour.
			const { stored, env: cachingEnv } = recordingCache();
			const res = await handleOgImage(
				new Request('https://spelling.test/og-image?path=/hub/nope'),
				cachingEnv,
				{ waitUntil: (p) => p },
				new URL('https://spelling.test/og-image?path=/hub/nope'),
			);
			expect(res.status).toBe(200);
			expect(res.headers.get('content-type')).toBe('image/png');
			expect(res.headers.get('cache-control')).toBe('no-cache');
			expect(stored).toHaveLength(0);
		});
	});
});
