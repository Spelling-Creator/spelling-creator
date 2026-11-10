import { describe, expect, it, vi } from "vitest";
import { createStore, createValueStore } from "./store.ts";

describe("createValueStore", () => {
  it("holds one value and tells listeners when it changes", () => {
    const store = createValueStore(0);
    const listener = vi.fn();
    store.subscribe(listener);

    store.set(0.5);
    store.set(0.5);
    expect(store.getSnapshot()).toBe(0.5);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("createStore", () => {
  it("hands out the same snapshot until something changes", () => {
    const store = createStore({ count: 0, label: "a" });
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);

    store.patch({ count: 1 });
    const second = store.getSnapshot();
    expect(second).not.toBe(first);
    expect(second).toEqual({ count: 1, label: "a" });
    expect(first).toEqual({ count: 0, label: "a" });
  });

  it("tells every listener about a change, once", () => {
    const store = createStore({ count: 0 });
    const one = vi.fn();
    const two = vi.fn();
    store.subscribe(one);
    store.subscribe(two);

    store.patch({ count: 1 });
    store.set({ count: 2 });
    expect(one).toHaveBeenCalledTimes(2);
    expect(two).toHaveBeenCalledTimes(2);
  });

  it("says nothing for a patch that changes nothing", () => {
    const store = createStore({ count: 0, who: null as string | null });
    const listener = vi.fn();
    store.subscribe(listener);

    store.patch({ count: 0 });
    store.patch({ who: null });
    store.patch({});
    store.set(store.getSnapshot());
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toEqual({ count: 0, who: null });
  });

  it("stops telling a listener that unsubscribed", () => {
    const store = createStore({ count: 0 });
    const listener = vi.fn();
    const stop = store.subscribe(listener);

    store.patch({ count: 1 });
    stop();
    store.patch({ count: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("finishes a round even if a listener unsubscribes during it", () => {
    const store = createStore({ count: 0 });
    const later = vi.fn();
    const stopEarly = store.subscribe(() => stopEarly());
    store.subscribe(later);

    store.patch({ count: 1 });
    expect(later).toHaveBeenCalledTimes(1);
  });
});
