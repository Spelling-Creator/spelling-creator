// A small external store: one snapshot, replaced rather than mutated, and
// listeners told each time it changes.
//
// This is the shape a session written in core takes when a page needs to show
// it, such as a socket (browser/practiceHost.ts, a letterboard session). The
// session owns its state and its timers; the view
// layer only reads the snapshot and calls the methods. It is also exactly what
// React's useSyncExternalStore reads (apps/web/src/lib/useStore.js is the one
// line that connects them), so a session needs no hook of its own to hold
// state, and nothing in it has to be rebuilt when the view layer changes.
//
// Two rules make that work. The snapshot is the same object until something
// changes, so a reader comparing by identity sees a change exactly when there
// is one. And a patch that changes nothing tells nobody, so a session can
// report the same status twice without causing a render.

/** What a reader gets: the snapshot, and a way to hear when it changes. */
export interface ReadableStore<S> {
  /** The current snapshot. The same object until the next change. */
  getSnapshot(): S;
  /** Hear about every change. Returns the function that stops listening. */
  subscribe(listener: () => void): () => void;
}

/** The store as its owner holds it. */
export interface Store<S extends object> extends ReadableStore<S> {
  /** Replace the snapshot. The same object again is not a change. */
  set(next: S): void;
  /**
   * Change some of its fields. Fields that already hold the given value (by
   * Object.is) are not a change, and a patch with none is not announced.
   */
  patch(fields: Partial<S>): void;
}

/**
 * A store of one value rather than a snapshot of fields: for something that
 * changes too often to sit in a session's snapshot, such as a download's
 * progress, which a page shows in one place and nowhere else.
 */
export interface ValueStore<T> extends ReadableStore<T> {
  /** Replace the value. The same value again (by Object.is) is not a change. */
  set(next: T): void;
}

export function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      // Over a copy, so a listener that unsubscribes (or subscribes another)
      // while being told doesn't disturb the round.
      for (const listener of [...listeners]) listener();
    },
  };
}

export function createStore<S extends object>(initial: S): Store<S> {
  const value = createValueStore(initial);

  return {
    getSnapshot: value.getSnapshot,
    subscribe: value.subscribe,
    set: value.set,
    patch(fields) {
      const snapshot = value.getSnapshot();
      let changed = false;
      for (const key of Object.keys(fields) as (keyof S)[]) {
        if (!Object.is(fields[key], snapshot[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      value.set({ ...snapshot, ...fields });
    },
  };
}
