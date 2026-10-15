// An SVG rasterizer for the SVG that Satori writes, and nothing more.
//
// Satori turns a card into an SVG made of very few things: filled paths (every
// glyph is one, and so is every rounded box), plain rects, images from data
// URIs, clip paths and rect masks that implement overflow and border radius,
// and groups. No strokes, no text, no gradients, no filters, no transforms.
// Drawing that subset is a few hundred lines; drawing SVG in general is a
// 2.5 MB WebAssembly build of resvg, which is more than a free Workers plan
// has room for next to the rest of this API. So this file draws the subset,
// and refuses anything outside it with a clear error rather than drawing it
// wrong. The cards in ./card.js are written to stay inside it (the one place
// that mattered was the picture's border, which is a filled box behind the
// picture rather than a stroke).
//
// Shapes are filled with the signed-area accumulation rasterizer that font
// renderers use (font-rs, and the glyph rasterizers descended from it): each
// edge deposits the area it sweeps into an accumulation buffer, a prefix sum
// per row turns that into exact per-pixel coverage, and the result is
// anti-aliased text that looks like text. Curves are flattened to short lines
// first. Images are drawn with box sampling, which is the right filter when a
// picture is being shrunk, and bilinear when it is not.
//
// The output is straight-alpha RGBA, which the caller encodes as PNG.

/**
 * @typedef {object} Rgba
 * @property {number} r 0..1
 * @property {number} g 0..1
 * @property {number} b 0..1
 * @property {number} a 0..1
 */

/**
 * @typedef {object} Image
 * @property {number} width
 * @property {number} height
 * @property {Uint8ClampedArray} data Straight-alpha RGBA.
 */

/**
 * @typedef {object} Node
 * @property {string} name
 * @property {Record<string, string>} attrs
 * @property {Node[]} children
 */

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

const TAG_RE =
	/<\/?([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>/g;
const ATTR_RE = /([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;

function unescapeXml(value) {
	return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (whole, name) => {
		switch (name) {
			case 'amp':
				return '&';
			case 'lt':
				return '<';
			case 'gt':
				return '>';
			case 'quot':
				return '"';
			case 'apos':
				return "'";
			default:
				return String.fromCodePoint(name[1] === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10));
		}
	});
}

/**
 * Parse an XML document into a tree. Text content is dropped: nothing Satori
 * emits carries meaning in text, and this is not a general XML parser.
 * @param {string} xml
 * @returns {Node}
 */
export function parseXml(xml) {
	const root = { name: '#document', attrs: {}, children: [] };
	const stack = [root];
	for (const match of xml.matchAll(TAG_RE)) {
		const [whole, name, rawAttrs, selfClosing] = match;
		if (!name) continue; // a comment, a processing instruction, CDATA
		if (whole[1] === '/') {
			const open = stack.pop();
			if (!open || open.name !== name) throw new Error(`Malformed SVG: unexpected </${name}>.`);
			continue;
		}
		const attrs = {};
		for (const attr of rawAttrs.matchAll(ATTR_RE)) {
			attrs[attr[1]] = unescapeXml(attr[2] ?? attr[3] ?? '');
		}
		const node = { name, attrs, children: [] };
		stack[stack.length - 1].children.push(node);
		if (!selfClosing) stack.push(node);
	}
	if (stack.length !== 1) throw new Error(`Malformed SVG: <${stack[stack.length - 1].name}> is never closed.`);
	const svg = root.children.find((child) => child.name === 'svg');
	if (!svg) throw new Error('Not an SVG document.');
	return svg;
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const NAMED = { white: '#ffffff', black: '#000000', red: '#ff0000', transparent: 'rgba(0,0,0,0)' };

/**
 * @param {string | undefined} value
 * @returns {Rgba | null} Null for `none` or nothing.
 */
export function parseColor(value) {
	let text = (value || '').trim().toLowerCase();
	if (!text || text === 'none') return null;
	if (NAMED[text]) text = NAMED[text];
	if (text[0] === '#') {
		const hex = text.slice(1);
		const wide = hex.length === 3 || hex.length === 4 ? [...hex].map((c) => c + c).join('') : hex;
		if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(wide)) throw new Error(`Unsupported color: ${value}`);
		const n = parseInt(wide.slice(0, 6), 16);
		const a = wide.length === 8 ? parseInt(wide.slice(6), 16) / 255 : 1;
		return { r: (n >> 16) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a };
	}
	const rgb = text.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
	if (rgb) {
		return { r: Number(rgb[1]) / 255, g: Number(rgb[2]) / 255, b: Number(rgb[3]) / 255, a: rgb[4] === undefined ? 1 : Number(rgb[4]) };
	}
	throw new Error(`Unsupported color: ${value}`);
}

// ---------------------------------------------------------------------------
// Paths: parse and flatten to polygons
// ---------------------------------------------------------------------------

const PATH_TOKEN_RE = /[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/** How many line segments a curve of this chord length becomes. */
function steps(length) {
	return Math.max(4, Math.min(64, Math.ceil(Math.sqrt(length * 3))));
}

/**
 * Append the points of an elliptical arc (SVG endpoint parameterization, spec
 * section F.6.5) from (x1, y1) to (x2, y2) onto `out`, excluding the start.
 */
function flattenArc(out, x1, y1, rx, ry, rotation, large, sweep, x2, y2) {
	if (x1 === x2 && y1 === y2) return;
	rx = Math.abs(rx);
	ry = Math.abs(ry);
	if (rx === 0 || ry === 0) {
		out.push(x2, y2);
		return;
	}
	const phi = (rotation * Math.PI) / 180;
	const cos = Math.cos(phi);
	const sin = Math.sin(phi);
	const dx = (x1 - x2) / 2;
	const dy = (y1 - y2) / 2;
	const x1p = cos * dx + sin * dy;
	const y1p = -sin * dx + cos * dy;
	// Scale the radii up if the arc cannot reach the end point.
	const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
	if (lambda > 1) {
		rx *= Math.sqrt(lambda);
		ry *= Math.sqrt(lambda);
	}
	const rx2 = rx * rx;
	const ry2 = ry * ry;
	const num = Math.max(0, rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p);
	const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
	let coef = den === 0 ? 0 : Math.sqrt(num / den);
	if (large === sweep) coef = -coef;
	const cxp = (coef * rx * y1p) / ry;
	const cyp = (-coef * ry * x1p) / rx;
	const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
	const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
	const angle = (ux, uy, vx, vy) => {
		const dot = ux * vx + uy * vy;
		const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
		let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
		if (ux * vy - uy * vx < 0) a = -a;
		return a;
	};
	const theta = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
	let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
	if (!sweep && delta > 0) delta -= 2 * Math.PI;
	if (sweep && delta < 0) delta += 2 * Math.PI;
	const n = steps(Math.abs(delta) * Math.max(rx, ry));
	for (let i = 1; i <= n; i += 1) {
		const t = theta + (delta * i) / n;
		const ex = rx * Math.cos(t);
		const ey = ry * Math.sin(t);
		out.push(cos * ex - sin * ey + cx, sin * ex + cos * ey + cy);
	}
	// Land exactly on the end point rather than a rounding error away from it.
	out[out.length - 2] = x2;
	out[out.length - 1] = y2;
}

/**
 * Parse an SVG path and flatten it into closed polygons, each a flat array of
 * x, y pairs. Open subpaths are closed, which is what filling does anyway.
 *
 * @param {string} d
 * @returns {number[][]}
 */
export function flattenPath(d) {
	const tokens = d.match(PATH_TOKEN_RE) || [];
	const polys = [];
	let poly = null;
	let cmd = '';
	let x = 0;
	let y = 0;
	let startX = 0;
	let startY = 0;
	// The previous control point, for the S and T shorthands.
	let cx = 0;
	let cy = 0;
	let prev = '';
	let i = 0;
	const num = () => {
		const token = tokens[i];
		i += 1;
		if (token === undefined || Number.isNaN(Number(token))) throw new Error(`Malformed path data near "${tokens[i - 2]}".`);
		return Number(token);
	};
	const begin = (nx, ny) => {
		if (poly && poly.length >= 6) polys.push(poly);
		poly = [nx, ny];
		x = startX = nx;
		y = startY = ny;
	};
	const lineTo = (nx, ny) => {
		if (!poly) begin(x, y);
		poly.push(nx, ny);
		x = nx;
		y = ny;
	};
	const quadTo = (qx, qy, nx, ny) => {
		if (!poly) begin(x, y);
		const n = steps(Math.hypot(qx - x, qy - y) + Math.hypot(nx - qx, ny - qy));
		const x0 = x;
		const y0 = y;
		for (let k = 1; k <= n; k += 1) {
			const t = k / n;
			const u = 1 - t;
			poly.push(u * u * x0 + 2 * u * t * qx + t * t * nx, u * u * y0 + 2 * u * t * qy + t * t * ny);
		}
		cx = qx;
		cy = qy;
		x = nx;
		y = ny;
	};
	const cubicTo = (ax, ay, bx, by, nx, ny) => {
		if (!poly) begin(x, y);
		const n = steps(Math.hypot(ax - x, ay - y) + Math.hypot(bx - ax, by - ay) + Math.hypot(nx - bx, ny - by));
		const x0 = x;
		const y0 = y;
		for (let k = 1; k <= n; k += 1) {
			const t = k / n;
			const u = 1 - t;
			poly.push(
				u * u * u * x0 + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * nx,
				u * u * u * y0 + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * ny,
			);
		}
		cx = bx;
		cy = by;
		x = nx;
		y = ny;
	};

	while (i < tokens.length) {
		const token = tokens[i];
		if (/^[A-Za-z]$/.test(token)) {
			cmd = token;
			i += 1;
		} else if (cmd === 'M') {
			cmd = 'L'; // further pairs after a moveto are implicit linetos
		} else if (cmd === 'm') {
			cmd = 'l';
		} else if (!cmd) {
			throw new Error('Malformed path data: a number before any command.');
		}
		const rel = cmd === cmd.toLowerCase();
		const ox = rel ? x : 0;
		const oy = rel ? y : 0;
		switch (cmd.toUpperCase()) {
			case 'M': {
				const nx = num() + ox;
				const ny = num() + oy;
				begin(nx, ny);
				break;
			}
			case 'Z':
				if (poly) {
					polys.push(poly);
					poly = null;
				}
				x = startX;
				y = startY;
				break;
			case 'L':
				lineTo(num() + ox, num() + oy);
				break;
			case 'H':
				lineTo(num() + ox, y);
				break;
			case 'V':
				lineTo(x, num() + oy);
				break;
			case 'Q': {
				const qx = num() + ox;
				const qy = num() + oy;
				quadTo(qx, qy, num() + ox, num() + oy);
				break;
			}
			case 'T': {
				const reflect = prev === 'Q' || prev === 'T';
				const qx = reflect ? 2 * x - cx : x;
				const qy = reflect ? 2 * y - cy : y;
				quadTo(qx, qy, num() + ox, num() + oy);
				break;
			}
			case 'C': {
				const ax = num() + ox;
				const ay = num() + oy;
				const bx = num() + ox;
				const by = num() + oy;
				cubicTo(ax, ay, bx, by, num() + ox, num() + oy);
				break;
			}
			case 'S': {
				const reflect = prev === 'C' || prev === 'S';
				const ax = reflect ? 2 * x - cx : x;
				const ay = reflect ? 2 * y - cy : y;
				const bx = num() + ox;
				const by = num() + oy;
				cubicTo(ax, ay, bx, by, num() + ox, num() + oy);
				break;
			}
			case 'A': {
				const rx = num();
				const ry = num();
				const rotation = num();
				const large = num() !== 0;
				const sweep = num() !== 0;
				const nx = num() + ox;
				const ny = num() + oy;
				if (!poly) begin(x, y);
				flattenArc(poly, x, y, rx, ry, rotation, large, sweep, nx, ny);
				x = nx;
				y = ny;
				break;
			}
			default:
				throw new Error(`Unsupported path command "${cmd}".`);
		}
		prev = cmd.toUpperCase();
	}
	if (poly && poly.length >= 6) polys.push(poly);
	return polys;
}

/** A rectangle, with optional rounded corners, as a polygon. */
function rectPolys(x, y, w, h, rx = 0, ry = rx) {
	if (!(w > 0 && h > 0)) return [];
	rx = Math.min(Math.abs(rx), w / 2);
	ry = Math.min(Math.abs(ry), h / 2);
	if (rx === 0 || ry === 0) return [[x, y, x + w, y, x + w, y + h, x, y + h]];
	return flattenPath(
		`M${x + rx},${y} h${w - 2 * rx} a${rx},${ry} 0 0 1 ${rx},${ry} v${h - 2 * ry} a${rx},${ry} 0 0 1 ${-rx},${ry} h${-(w - 2 * rx)} a${rx},${ry} 0 0 1 ${-rx},${-ry} v${-(h - 2 * ry)} a${rx},${ry} 0 0 1 ${rx},${-ry} z`,
	);
}

// ---------------------------------------------------------------------------
// Coverage: signed-area accumulation
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Coverage
 * @property {number} x0 Canvas x of the first column.
 * @property {number} y0 Canvas y of the first row.
 * @property {number} w
 * @property {number} h
 * @property {Float32Array} cov Row-major, w by h, each 0..1.
 */

/**
 * Deposit one edge into the accumulation buffer. `acc` has a stride of
 * `stride` (at least w + 2) so the spill past the last column has somewhere
 * to go. Coordinates are local to the buffer and already clipped to it.
 */
function accumulateEdge(acc, stride, h, px0, py0, px1, py1) {
	if (Math.abs(py0 - py1) <= 1e-9) return;
	let dir = 1;
	if (py0 > py1) {
		dir = -1;
		[px0, py0, px1, py1] = [px1, py1, px0, py0];
	}
	const dxdy = (px1 - px0) / (py1 - py0);
	let x = px0;
	const yStart = Math.max(0, Math.floor(py0));
	const yEnd = Math.min(h, Math.ceil(py1));
	if (py0 < yStart) x += (yStart - py0) * dxdy;
	for (let yi = yStart; yi < yEnd; yi += 1) {
		const row = yi * stride;
		const dy = Math.min(yi + 1, py1) - Math.max(yi, py0);
		const xnext = x + dxdy * dy;
		const d = dy * dir;
		let xa = x;
		let xb = xnext;
		if (xa > xb) [xa, xb] = [xb, xa];
		const xaFloor = Math.floor(xa);
		const xai = xaFloor;
		const xbCeil = Math.ceil(xb);
		const xbi = xbCeil;
		if (xbi <= xai + 1) {
			// The edge stays within one column this row.
			const xmf = 0.5 * (x + xnext) - xaFloor;
			acc[row + xai] += d - d * xmf;
			acc[row + xai + 1] += d * xmf;
		} else {
			const s = 1 / (xb - xa);
			const xaf = xa - xaFloor;
			const a0 = 0.5 * s * (1 - xaf) * (1 - xaf);
			const xbf = xb - xbCeil + 1;
			const am = 0.5 * s * xbf * xbf;
			acc[row + xai] += d * a0;
			if (xbi === xai + 2) {
				acc[row + xai + 1] += d * (1 - a0 - am);
			} else {
				const a1 = s * (1.5 - xaf);
				acc[row + xai + 1] += d * (a1 - a0);
				for (let xi = xai + 2; xi < xbi - 1; xi += 1) acc[row + xi] += d * s;
				const a2 = a1 + (xbi - xai - 3) * s;
				acc[row + xbi - 1] += d * (1 - a2 - am);
			}
			acc[row + xbi] += d * am;
		}
		x = xnext;
	}
}

/**
 * Clip one edge to the buffer and deposit it. The part of an edge left of the
 * buffer is projected onto its left side (it still bounds the fill to its
 * right), the part beyond the right side onto that side, and the parts above
 * or below are dropped, since they touch no row.
 */
function clippedEdge(acc, stride, w, h, x0, y0, x1, y1) {
	// Vertical clip: keep the portion with y in [0, h].
	if (Math.max(y0, y1) <= 0 || Math.min(y0, y1) >= h) return;
	if (y0 < 0 || y1 < 0 || y0 > h || y1 > h) {
		const t0 = y0 < 0 ? -y0 / (y1 - y0) : y0 > h ? (h - y0) / (y1 - y0) : 0;
		const t1 = y1 < 0 ? -y0 / (y1 - y0) : y1 > h ? (h - y0) / (y1 - y0) : 1;
		const nx0 = x0 + (x1 - x0) * t0;
		const ny0 = Math.min(h, Math.max(0, y0 + (y1 - y0) * t0));
		const nx1 = x0 + (x1 - x0) * t1;
		const ny1 = Math.min(h, Math.max(0, y0 + (y1 - y0) * t1));
		x0 = nx0;
		y0 = ny0;
		x1 = nx1;
		y1 = ny1;
	}
	// Horizontal clip: split at the sides and flatten the outside parts onto them.
	for (const side of [0, w]) {
		if ((x0 - side) * (x1 - side) < 0) {
			const t = (side - x0) / (x1 - x0);
			const mx = side;
			const my = y0 + (y1 - y0) * t;
			clippedEdge(acc, stride, w, h, x0, y0, mx, my);
			clippedEdge(acc, stride, w, h, mx, my, x1, y1);
			return;
		}
	}
	const cx0 = Math.min(w, Math.max(0, x0));
	const cx1 = Math.min(w, Math.max(0, x1));
	accumulateEdge(acc, stride, h, cx0, y0, cx1, y1);
}

/**
 * Per-pixel coverage of a set of polygons, over the part of the canvas their
 * bounding box touches. Nonzero winding, approximately: overlapping contours
 * wound the same way saturate at 1, as a glyph expects.
 *
 * @param {number[][]} polys
 * @param {number} canvasW
 * @param {number} canvasH
 * @returns {Coverage | null} Null when nothing lands on the canvas.
 */
export function coverageOf(polys, canvasW, canvasH) {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const poly of polys) {
		for (let i = 0; i < poly.length; i += 2) {
			if (poly[i] < minX) minX = poly[i];
			if (poly[i] > maxX) maxX = poly[i];
			if (poly[i + 1] < minY) minY = poly[i + 1];
			if (poly[i + 1] > maxY) maxY = poly[i + 1];
		}
	}
	if (!(maxX > minX && maxY > minY)) return null;
	const x0 = Math.max(0, Math.floor(minX));
	const y0 = Math.max(0, Math.floor(minY));
	const x1 = Math.min(canvasW, Math.ceil(maxX));
	const y1 = Math.min(canvasH, Math.ceil(maxY));
	const w = x1 - x0;
	const h = y1 - y0;
	if (w <= 0 || h <= 0) return null;
	const stride = w + 2;
	const acc = new Float32Array(stride * h + 2);
	for (const poly of polys) {
		const n = poly.length / 2;
		for (let i = 0; i < n; i += 1) {
			const j = (i + 1) % n;
			clippedEdge(acc, stride, w, h, poly[i * 2] - x0, poly[i * 2 + 1] - y0, poly[j * 2] - x0, poly[j * 2 + 1] - y0);
		}
	}
	const cov = new Float32Array(w * h);
	for (let y = 0; y < h; y += 1) {
		let sum = 0;
		const row = y * stride;
		for (let x = 0; x < w; x += 1) {
			sum += acc[row + x];
			const c = Math.abs(sum);
			cov[y * w + x] = c > 1 ? 1 : c;
		}
	}
	return { x0, y0, w, h, cov };
}

// ---------------------------------------------------------------------------
// The canvas
// ---------------------------------------------------------------------------

class Canvas {
	constructor(width, height) {
		this.width = width;
		this.height = height;
		// Premultiplied RGBA, so "over" is one multiply-add per channel.
		this.px = new Float32Array(width * height * 4);
	}

	/** Composite a color over the pixels a coverage covers, under a mask. */
	fill(coverage, color, opacity, mask) {
		if (!coverage) return;
		const { x0, y0, w, h, cov } = coverage;
		const { px, width } = this;
		const r = color.r;
		const g = color.g;
		const b = color.b;
		const base = color.a * opacity;
		for (let y = 0; y < h; y += 1) {
			for (let x = 0; x < w; x += 1) {
				let a = cov[y * w + x] * base;
				if (a <= 0) continue;
				const index = (y0 + y) * width + (x0 + x);
				if (mask) a *= mask[index];
				if (a <= 0) continue;
				const o = index * 4;
				const keep = 1 - a;
				px[o] = r * a + px[o] * keep;
				px[o + 1] = g * a + px[o + 1] * keep;
				px[o + 2] = b * a + px[o + 2] * keep;
				px[o + 3] = a + px[o + 3] * keep;
			}
		}
	}

	/** Composite one premultiplied sample at a pixel index. */
	blend(index, r, g, b, a) {
		if (a <= 0) return;
		const o = index * 4;
		const keep = 1 - a;
		const { px } = this;
		px[o] = r + px[o] * keep;
		px[o + 1] = g + px[o + 1] * keep;
		px[o + 2] = b + px[o + 2] * keep;
		px[o + 3] = a + px[o + 3] * keep;
	}

	/** Straight-alpha 8-bit RGBA. */
	toImage() {
		const { width, height, px } = this;
		const data = new Uint8ClampedArray(width * height * 4);
		for (let i = 0; i < width * height; i += 1) {
			const o = i * 4;
			const a = px[o + 3];
			// A clamped array rounds on assignment.
			if (a > 0) {
				data[o] = (px[o] / a) * 255;
				data[o + 1] = (px[o + 1] / a) * 255;
				data[o + 2] = (px[o + 2] / a) * 255;
				data[o + 3] = a * 255;
			}
		}
		return { width, height, data };
	}
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/**
 * Average the source pixels in a box centred on (sx, sy) of the given size,
 * or sample bilinearly when the box is smaller than a pixel. Returns
 * premultiplied RGBA in 0..1.
 */
function sample(image, sx, sy, boxW, boxH, out) {
	const { width, height, data } = image;
	if (boxW <= 1 && boxH <= 1) {
		const fx = Math.min(width - 1, Math.max(0, sx - 0.5));
		const fy = Math.min(height - 1, Math.max(0, sy - 0.5));
		const x0 = Math.floor(fx);
		const y0 = Math.floor(fy);
		const x1 = Math.min(width - 1, x0 + 1);
		const y1 = Math.min(height - 1, y0 + 1);
		const tx = fx - x0;
		const ty = fy - y0;
		let r = 0;
		let g = 0;
		let b = 0;
		let a = 0;
		const corners = [
			[x0, y0, (1 - tx) * (1 - ty)],
			[x1, y0, tx * (1 - ty)],
			[x0, y1, (1 - tx) * ty],
			[x1, y1, tx * ty],
		];
		for (const [cx, cy, wgt] of corners) {
			const o = (cy * width + cx) * 4;
			const pa = (data[o + 3] / 255) * wgt;
			r += (data[o] / 255) * pa;
			g += (data[o + 1] / 255) * pa;
			b += (data[o + 2] / 255) * pa;
			a += pa;
		}
		out[0] = r;
		out[1] = g;
		out[2] = b;
		out[3] = a;
		return;
	}
	const x0 = Math.max(0, Math.floor(sx - boxW / 2));
	const x1 = Math.min(width, Math.max(x0 + 1, Math.ceil(sx + boxW / 2)));
	const y0 = Math.max(0, Math.floor(sy - boxH / 2));
	const y1 = Math.min(height, Math.max(y0 + 1, Math.ceil(sy + boxH / 2)));
	let r = 0;
	let g = 0;
	let b = 0;
	let a = 0;
	let n = 0;
	for (let y = y0; y < y1; y += 1) {
		let o = (y * width + x0) * 4;
		for (let x = x0; x < x1; x += 1) {
			const pa = data[o + 3] / 255;
			r += (data[o] / 255) * pa;
			g += (data[o + 1] / 255) * pa;
			b += (data[o + 2] / 255) * pa;
			a += pa;
			o += 4;
			n += 1;
		}
	}
	out[0] = r / n;
	out[1] = g / n;
	out[2] = b / n;
	out[3] = a / n;
}

/**
 * Draw an image into the box (x, y, w, h), under a mask. `par` is the
 * element's preserveAspectRatio: `none` stretches, `xMidYMid slice` covers
 * and `xMidYMid meet` fits; those are the three Satori writes.
 */
function drawImage(canvas, image, x, y, w, h, par, opacity, mask) {
	if (!(w > 0 && h > 0) || image.width === 0 || image.height === 0) return;
	// The part of the source that maps onto the box.
	let sx = 0;
	let sy = 0;
	let sw = image.width;
	let sh = image.height;
	let dx = x;
	let dy = y;
	let dw = w;
	let dh = h;
	if (par !== 'none') {
		const slice = par.endsWith('slice');
		const scale = slice ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh);
		if (slice) {
			sw = w / scale;
			sh = h / scale;
			sx = (image.width - sw) / 2;
			sy = (image.height - sh) / 2;
		} else {
			dw = sw * scale;
			dh = sh * scale;
			dx = x + (w - dw) / 2;
			dy = y + (h - dh) / 2;
		}
	}
	const boxW = sw / dw;
	const boxH = sh / dh;
	const px0 = Math.max(0, Math.floor(dx));
	const py0 = Math.max(0, Math.floor(dy));
	const px1 = Math.min(canvas.width, Math.ceil(dx + dw));
	const py1 = Math.min(canvas.height, Math.ceil(dy + dh));
	const out = new Float32Array(4);
	for (let py = py0; py < py1; py += 1) {
		// How much of this pixel row the box covers, for the fractional edges.
		const rowCover = Math.min(py + 1, dy + dh) - Math.max(py, dy);
		if (rowCover <= 0) continue;
		const srcY = sy + ((py + 0.5 - dy) / dh) * sh;
		for (let px = px0; px < px1; px += 1) {
			const colCover = Math.min(px + 1, dx + dw) - Math.max(px, dx);
			if (colCover <= 0) continue;
			const index = py * canvas.width + px;
			let weight = rowCover * colCover * opacity;
			if (mask) weight *= mask[index];
			if (weight <= 0) continue;
			const srcX = sx + ((px + 0.5 - dx) / dw) * sw;
			sample(image, srcX, srcY, boxW, boxH, out);
			canvas.blend(index, out[0] * weight, out[1] * weight, out[2] * weight, out[3] * weight);
		}
	}
}

function dataUri(href) {
	const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(href || '');
	if (!match) throw new Error('Only data: URIs are supported for <image>.');
	const [, type, base64, payload] = match;
	if (!base64) throw new Error(`Only base64 data: URIs are supported for <image> (got ${type}).`);
	const binary = atob(payload);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return { type, bytes };
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

const UNSUPPORTED_ATTRS = ['transform', 'filter', 'stroke', 'stroke-width', 'style'];

function num(attrs, name, fallback = 0) {
	const value = attrs[name];
	if (value === undefined || value === '') return fallback;
	const n = Number(value);
	if (Number.isNaN(n)) throw new Error(`Unsupported ${name}="${value}".`);
	return n;
}

function refId(value) {
	const match = /^url\(#([^)]+)\)$/.exec((value || '').trim());
	if (!match) throw new Error(`Unsupported reference "${value}".`);
	return match[1];
}

function checkSupported(node) {
	for (const name of UNSUPPORTED_ATTRS) {
		const value = node.attrs[name];
		if (value !== undefined && value !== 'none' && !(name === 'stroke-width' && node.attrs.stroke === undefined)) {
			throw new Error(`Unsupported SVG: <${node.name} ${name}="${value}">.`);
		}
	}
}

/** The polygons of a shape element, or null if it is not one. */
function shapePolys(node) {
	if (node.name === 'rect') {
		return rectPolys(
			num(node.attrs, 'x'),
			num(node.attrs, 'y'),
			num(node.attrs, 'width'),
			num(node.attrs, 'height'),
			num(node.attrs, 'rx'),
			num(node.attrs, 'ry', num(node.attrs, 'rx')),
		);
	}
	if (node.name === 'path') return flattenPath(node.attrs.d || '');
	return null;
}

class Renderer {
	constructor(root, width, height, decodeImage) {
		this.root = root;
		this.canvas = new Canvas(width, height);
		this.decodeImage = decodeImage;
		/** @type {Map<string, Node>} */
		this.defs = new Map();
		/** @type {Map<string, Float32Array>} */
		this.masks = new Map();
		this.collect(root);
	}

	collect(node) {
		if (node.attrs.id && (node.name === 'clipPath' || node.name === 'mask')) this.defs.set(node.attrs.id, node);
		for (const child of node.children) this.collect(child);
	}

	/**
	 * The full-canvas coverage a clipPath or mask contributes: a clipPath is
	 * the union of its shapes, a mask the luminance of what it draws (white
	 * keeps, black removes), which for rect masks comes to the same thing.
	 */
	maskFor(id) {
		let mask = this.masks.get(id);
		if (mask) return mask;
		const node = this.defs.get(id);
		if (!node) throw new Error(`Unsupported SVG: reference to missing #${id}.`);
		const { width, height } = this.canvas;
		mask = new Float32Array(width * height);
		for (const child of node.children) {
			checkSupported(child);
			const polys = shapePolys(child);
			if (!polys) throw new Error(`Unsupported SVG: <${child.name}> inside <${node.name}>.`);
			let lum = 1;
			if (node.name === 'mask') {
				const color = parseColor(child.attrs.fill === undefined ? 'black' : child.attrs.fill);
				if (!color) continue;
				lum = (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) * color.a;
			}
			const coverage = coverageOf(polys, width, height);
			if (!coverage) continue;
			const { x0, y0, w, h, cov } = coverage;
			for (let y = 0; y < h; y += 1) {
				for (let x = 0; x < w; x += 1) {
					const index = (y0 + y) * width + (x0 + x);
					const v = mask[index] + cov[y * w + x] * lum;
					mask[index] = v > 1 ? 1 : v;
				}
			}
		}
		this.masks.set(id, mask);
		return mask;
	}

	/** The mask in force for a node: its parent's, times its own clip and mask. */
	maskOf(node, inherited) {
		let mask = inherited;
		for (const name of ['clip-path', 'mask']) {
			if (node.attrs[name] === undefined || node.attrs[name] === 'none') continue;
			const own = this.maskFor(refId(node.attrs[name]));
			if (!mask) {
				mask = own;
			} else {
				const product = new Float32Array(mask.length);
				for (let i = 0; i < mask.length; i += 1) product[i] = mask[i] * own[i];
				mask = product;
			}
		}
		return mask;
	}

	async draw(node, inherited, opacity) {
		switch (node.name) {
			case 'defs':
			case 'clipPath':
			case 'mask':
			case 'title':
			case 'desc':
				return;
			default:
				break;
		}
		checkSupported(node);
		const mask = this.maskOf(node, inherited);
		const own = opacity * num(node.attrs, 'opacity', 1);
		switch (node.name) {
			case 'svg':
			case 'g':
				for (const child of node.children) await this.draw(child, mask, own);
				return;
			case 'rect':
			case 'path': {
				const color = parseColor(node.attrs.fill === undefined ? 'black' : node.attrs.fill);
				if (!color) return;
				const polys = shapePolys(node);
				this.canvas.fill(coverageOf(polys, this.canvas.width, this.canvas.height), color, own * num(node.attrs, 'fill-opacity', 1), mask);
				return;
			}
			case 'image': {
				const { type, bytes } = dataUri(node.attrs.href ?? node.attrs['xlink:href']);
				const image = await this.decodeImage(bytes, type);
				drawImage(
					this.canvas,
					image,
					num(node.attrs, 'x'),
					num(node.attrs, 'y'),
					num(node.attrs, 'width'),
					num(node.attrs, 'height'),
					(node.attrs.preserveAspectRatio || 'xMidYMid meet').trim(),
					own,
					mask,
				);
				return;
			}
			default:
				throw new Error(`Unsupported SVG element <${node.name}>.`);
		}
	}
}

/**
 * Draw an SVG document.
 *
 * @param {string} svg
 * @param {object} opts
 * @param {(bytes: Uint8Array, type: string) => Promise<Image>} opts.decodeImage
 *   Decodes an embedded image's bytes (PNG, in practice) to RGBA.
 * @returns {Promise<Image>} The drawing, in the document's own width and height.
 */
export async function rasterize(svg, { decodeImage }) {
	const root = parseXml(svg);
	const width = Math.round(num(root.attrs, 'width'));
	const height = Math.round(num(root.attrs, 'height'));
	if (!(width > 0 && height > 0)) throw new Error('The SVG has no width and height.');
	const viewBox = (root.attrs.viewBox || '')
		.trim()
		.split(/[\s,]+/)
		.map(Number);
	if (
		root.attrs.viewBox &&
		(viewBox.length !== 4 || viewBox[0] !== 0 || viewBox[1] !== 0 || viewBox[2] !== width || viewBox[3] !== height)
	) {
		throw new Error('Unsupported SVG: a viewBox that differs from the width and height.');
	}
	const renderer = new Renderer(root, width, height, decodeImage);
	await renderer.draw(root, null, 1);
	return renderer.canvas.toImage();
}
