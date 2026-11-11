// Whether React has taken over the server-rendered page.
//
// false on the server and during the hydration render (so the markup
// matches), true from the first render after it. A control that only works
// once its handlers are attached (the hub's search box) can stay read-only
// until then, instead of taking keystrokes it will silently drop.

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
