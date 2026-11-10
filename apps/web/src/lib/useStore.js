// The one line between a core store and a React component.
//
// A session in core (live collaboration, a letterboard session, version
// history, read-aloud) keeps its own state in a store (packages/core/src/store.ts)
// rather than in a hook, so it works the same behind any view layer. This reads
// such a store as React state: the component renders again when the snapshot
// changes, and not otherwise.
//
// The snapshot doubles as the server snapshot. A session starts idle on the
// server and in the browser alike, so a server-rendered page and the client
// that hydrates it agree, and useSyncExternalStore has what it needs on both.

import { useSyncExternalStore } from "react";

/**
 * @template S
 * @param {import("@spelling-creator/core/store").ReadableStore<S>} store
 * @returns {S}
 */
export function useStore(store) {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}
