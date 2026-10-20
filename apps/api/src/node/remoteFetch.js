// A fetch for addresses a visitor chose, which will only connect to the
// public internet.
//
// Checking an address and then fetching it resolves its name twice, and a
// domain whose DNS answers a public address the first time and 127.0.0.1 or
// 10.x the second (DNS rebinding) passes the check and reaches the private
// network anyway. So the check happens where the connection is made: undici
// takes a `lookup` for its sockets, and the one here refuses a name with any
// private address among its answers. Whatever the name said a moment ago,
// the socket connects only to what was checked.
//
// An address given as a literal IP never reaches a lookup, so callers still
// refuse private literals up front (assertFetchable in lib/federation/
// remote.js), and fetches made with this follow no redirects of their own.
//
// The Worker has no need of any of this: it cannot reach a private network at
// all, so it uses the ordinary fetch (see platform/cloudflare.js).

import { lookup } from 'node:dns';

import { isValidPublicIPv4Address, isValidPublicIPv6Address } from '@fedify/fedify';
import { Agent, fetch as undiciFetch } from 'undici';

const isPublic = ({ address, family }) => (family === 6 ? isValidPublicIPv6Address(address) : isValidPublicIPv4Address(address));

/**
 * A `lookup` for net and tls sockets that answers only with public addresses.
 * Exported for its test.
 */
export function publicOnlyLookup(hostname, options, callback) {
	lookup(hostname, { ...options, all: true }, (error, addresses) => {
		if (error) return callback(error);
		if (!addresses.length || !addresses.every(isPublic)) {
			const refused = new Error(`${hostname} resolves to a private address`);
			refused.code = 'EPRIVATE';
			return callback(refused);
		}
		if (options?.all) return callback(null, addresses);
		return callback(null, addresses[0].address, addresses[0].family);
	});
}

const publicOnly = new Agent({ connect: { lookup: publicOnlyLookup } });

/** fetch, connecting only to public addresses. */
export function publicFetch(input, init = {}) {
	return undiciFetch(input, { ...init, dispatcher: publicOnly });
}
