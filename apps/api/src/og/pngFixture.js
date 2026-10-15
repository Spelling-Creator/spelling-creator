// A PNG encoder for the tests, so a fixture is built rather than pasted as a
// base64 wall. Deflate comes from `CompressionStream`, which both runtimes have.

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n += 1) {
		let c = n;
		for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(bytes) {
	let c = 0xffffffff;
	for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

function concat(parts) {
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

/**
 * Encode RGBA pixels as a PNG.
 * @param {{width: number, height: number, data: Uint8ClampedArray}} image
 * @returns {Promise<Uint8Array>}
 */
export async function encodePngBytes({ width, height, data }) {
	const scanlines = new Uint8Array(height * (1 + width * 4));
	for (let y = 0; y < height; y += 1) {
		scanlines[y * (1 + width * 4)] = 0; // filter: none
		scanlines.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
	}
	const compressed = new Uint8Array(
		await new Response(new Blob([scanlines]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer(),
	);
	const ihdr = new Uint8Array(13);
	new DataView(ihdr.buffer).setUint32(0, width);
	new DataView(ihdr.buffer).setUint32(4, height);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // colour type: RGBA
	return concat([
		new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', compressed),
		chunk('IEND', new Uint8Array(0)),
	]);
}
