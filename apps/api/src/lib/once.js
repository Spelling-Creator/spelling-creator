// Run an async start-up step once per isolate, and again only if it failed.
//
// Codec inits, wasm compiles and font reads all want the same thing: the
// first caller starts the work, every caller shares the one promise (so two
// concurrent requests never initialize a module twice), and a rejection
// clears the slot so the next call retries instead of failing forever on a
// transient error. A fulfilled promise stays for the life of the isolate.

/**
 * @template T
 * @param {() => Promise<T>} start
 * @returns {() => Promise<T>}
 */
export function once(start) {
	/** @type {Promise<T> | null} */
	let pending = null;
	return () => {
		if (!pending) {
			pending = start().catch((e) => {
				pending = null;
				throw e;
			});
		}
		return pending;
	};
}
