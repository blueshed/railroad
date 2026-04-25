import { describe, test, expect } from "bun:test";
import { signal, computed, effect, batch, Signal, untrack, pushDisposeScope, popDisposeScope } from "./signals";

describe("signal", () => {
  test("get and set", () => {
    const s = signal(1);
    expect(s.get()).toBe(1);
    s.set(2);
    expect(s.get()).toBe(2);
  });

  test("update", () => {
    const s = signal(5);
    s.update((n) => n * 2);
    expect(s.get()).toBe(10);
  });

  test("peek does not track", () => {
    const s = signal(1);
    let runs = 0;
    effect(() => {
      s.peek();
      runs++;
    });
    expect(runs).toBe(1);
    s.set(2);
    expect(runs).toBe(1); // should not re-run
  });

  test("mutate clones and notifies", () => {
    const s = signal({ count: 0, items: [1, 2] });
    let runs = 0;
    effect(() => { s.get(); runs++; });
    expect(runs).toBe(1);
    s.mutate((v) => { v.count = 5; v.items.push(3); });
    expect(runs).toBe(2);
    expect(s.get()).toEqual({ count: 5, items: [1, 2, 3] });
  });

  test("mutate does not alias original", () => {
    const original = { x: 1 };
    const s = signal(original);
    s.mutate((v) => { v.x = 99; });
    expect(original.x).toBe(1); // original untouched
    expect(s.get().x).toBe(99);
  });

  test("patch merges shallow fields", () => {
    const s = signal({ name: "a", color: "red", size: 10 });
    s.patch({ color: "blue" });
    expect(s.get()).toEqual({ name: "a", color: "blue", size: 10 });
  });

  test("patch notifies subscribers", () => {
    const s = signal({ x: 1, y: 2 });
    let runs = 0;
    effect(() => { s.get(); runs++; });
    expect(runs).toBe(1);
    s.patch({ y: 99 });
    expect(runs).toBe(2);
    expect(s.get()).toEqual({ x: 1, y: 99 });
  });

  test("does not notify if value unchanged", () => {
    const s = signal(1);
    let runs = 0;
    effect(() => {
      s.get();
      runs++;
    });
    expect(runs).toBe(1);
    s.set(1); // same value
    expect(runs).toBe(1);
  });
});

describe("Signal.touch", () => {
  test("fires listeners without replacing the value", () => {
    const s = signal({ x: 0 });
    let runs = 0;
    let seen = 0;
    effect(() => { seen = s.get().x; runs++; });
    expect(runs).toBe(1);
    expect(seen).toBe(0);

    // Mutate in place — set(sameRef) would be a no-op, touch() forces re-run.
    s.peek().x = 1;
    s.touch();

    expect(runs).toBe(2);
    expect(seen).toBe(1);
  });

  test("preserves reference identity", () => {
    const s = signal({ items: [] as number[] });
    const before = s.peek();
    s.peek().items.push(1);
    s.touch();
    expect(s.peek()).toBe(before);
    expect(s.peek().items).toBe(before.items);
  });

  test("respects batch()", () => {
    const s = signal({ x: 0 });
    let runs = 0;
    effect(() => { s.get(); runs++; });
    expect(runs).toBe(1);

    batch(() => {
      s.touch();
      s.touch();
      s.touch();
    });

    expect(runs).toBe(2); // initial + one coalesced flush after batch exits
  });

  test("propagates through primitive-returning computeds", () => {
    const s = signal({ items: [1, 2] });
    const len = computed(() => s.get().items.length);
    const seen: number[] = [];
    effect(() => { seen.push(len.get()); });
    expect(seen).toEqual([2]);

    s.peek().items.push(3);
    s.touch();
    expect(seen).toEqual([2, 3]);
  });

  test("does NOT propagate through identity-returning computeds (by design)", () => {
    // Locks in the Object.is bail-out: a computed that returns the same ref
    // stops propagation. touch() is not a drop-in "wake everything up".
    const s = signal({ items: [1, 2] });
    const proxy = computed(() => s.get().items);
    let runs = 0;
    effect(() => { proxy.get(); runs++; });
    expect(runs).toBe(1);

    s.peek().items.push(3);
    s.touch();
    expect(runs).toBe(1);
  });
});

describe("computed", () => {
  test("derives value", () => {
    const a = signal(2);
    const b = signal(3);
    const sum = computed(() => a.get() + b.get());
    expect(sum.get()).toBe(5);
  });

  test("updates when dependencies change", () => {
    const a = signal(1);
    const doubled = computed(() => a.get() * 2);
    expect(doubled.get()).toBe(2);
    a.set(5);
    expect(doubled.get()).toBe(10);
  });

  test("chains", () => {
    const a = signal(1);
    const b = computed(() => a.get() + 1);
    const c = computed(() => b.get() * 10);
    expect(c.get()).toBe(20);
    a.set(3);
    expect(c.get()).toBe(40);
  });
});

describe("effect", () => {
  test("runs immediately", () => {
    let ran = false;
    effect(() => { ran = true; });
    expect(ran).toBe(true);
  });

  test("re-runs when dependency changes", () => {
    const s = signal(0);
    const values: number[] = [];
    effect(() => { values.push(s.get()); });
    expect(values).toEqual([0]);
    s.set(1);
    expect(values).toEqual([0, 1]);
    s.set(2);
    expect(values).toEqual([0, 1, 2]);
  });

  test("dispose stops updates", () => {
    const s = signal(0);
    let runs = 0;
    const dispose = effect(() => { s.get(); runs++; });
    expect(runs).toBe(1);
    dispose();
    s.set(1);
    expect(runs).toBe(1);
  });

  test("cleanup runs before re-execution", () => {
    const s = signal(0);
    const log: string[] = [];
    effect(() => {
      s.get();
      log.push("run");
      return () => { log.push("cleanup"); };
    });
    expect(log).toEqual(["run"]);
    s.set(1);
    expect(log).toEqual(["run", "cleanup", "run"]);
  });

  test("unsubscribes from stale dependencies", () => {
    const a = signal(true);
    const b = signal(1);
    const c = signal(2);
    let runs = 0;
    effect(() => {
      runs++;
      if (a.get()) b.get();
      else c.get();
    });
    expect(runs).toBe(1);
    b.set(10); // tracked
    expect(runs).toBe(2);
    a.set(false); // switch to c
    expect(runs).toBe(3);
    b.set(20); // no longer tracked
    expect(runs).toBe(3);
    c.set(30); // now tracked
    expect(runs).toBe(4);
  });
});

describe("batch", () => {
  test("defers effects", () => {
    const a = signal(1);
    const b = signal(2);
    let runs = 0;
    effect(() => { a.get(); b.get(); runs++; });
    expect(runs).toBe(1);
    batch(() => {
      a.set(10);
      b.set(20);
    });
    expect(runs).toBe(2); // one run, not two
  });

  test("nested batch", () => {
    const s = signal(0);
    let runs = 0;
    effect(() => { s.get(); runs++; });
    expect(runs).toBe(1);
    batch(() => {
      batch(() => {
        s.set(1);
        s.set(2);
      });
      s.set(3);
    });
    expect(runs).toBe(2);
  });
});

describe("Signal.map", () => {
  test("derives a new signal", () => {
    const s = signal({ name: "Alice", age: 30 });
    const name = s.map((v) => v.name);
    expect(name.get()).toBe("Alice");
  });

  test("updates when source changes", () => {
    const s = signal({ name: "Alice", age: 30 });
    const name = s.map((v) => v.name);
    s.patch({ name: "Bob" });
    expect(name.get()).toBe("Bob");
  });

  test("chains", () => {
    const s = signal(3);
    const doubled = s.map((n) => n * 2);
    const label = doubled.map((n) => `Value: ${n}`);
    expect(label.get()).toBe("Value: 6");
    s.set(5);
    expect(label.get()).toBe("Value: 10");
  });
});

describe("effect auto-tracking", () => {
  test("effects are auto-disposed with scope", () => {
    const s = signal(0);
    let runs = 0;

    pushDisposeScope();
    effect(() => { s.get(); runs++; });
    const dispose = popDisposeScope();

    expect(runs).toBe(1);
    s.set(1);
    expect(runs).toBe(2);

    dispose(); // should clean up the effect
    s.set(2);
    expect(runs).toBe(2); // no more runs
  });

  test("computed auto-disposes with scope", () => {
    const s = signal(1);

    pushDisposeScope();
    const doubled = computed(() => s.get() * 2);
    const dispose = popDisposeScope();

    expect(doubled.get()).toBe(2);
    s.set(5);
    expect(doubled.get()).toBe(10);

    dispose();
    s.set(10);
    // After dispose, computed's internal effect is stopped
    expect(doubled.get()).toBe(10);
  });
});

describe("equals option (RFC-flavoured)", () => {
  test("custom equals on signal() suppresses set when equal", () => {
    const s = signal({ x: 1, y: 2 }, {
      equals: (a, b) => a.x === b.x && a.y === b.y,
    });
    let runs = 0;
    effect(() => { s.get(); runs++; });
    expect(runs).toBe(1);

    // Different reference, equal contents — should NOT fire.
    s.set({ x: 1, y: 2 });
    expect(runs).toBe(1);

    // Different contents — should fire.
    s.set({ x: 1, y: 3 });
    expect(runs).toBe(2);
  });

  test("custom equals on computed() throttles propagation", () => {
    const s = signal({ items: [1, 2, 3] });
    // computed returns a new array every time; equals based on length.
    const len = computed(
      () => [...s.get().items],
      { equals: (a, b) => a.length === b.length },
    );
    let runs = 0;
    effect(() => { len.get(); runs++; });
    expect(runs).toBe(1);

    // Same length — listener should not fire even though the inner array
    // is a fresh reference.
    s.set({ items: [4, 5, 6] });
    expect(runs).toBe(1);

    // Different length — fires.
    s.set({ items: [7] });
    expect(runs).toBe(2);
  });

  test("default equals is Object.is — NaN is treated as equal", () => {
    const s = signal(NaN);
    let runs = 0;
    effect(() => { s.get(); runs++; });
    expect(runs).toBe(1);
    s.set(NaN);
    expect(runs).toBe(1); // Object.is(NaN, NaN) === true
  });
});

describe("untrack (RFC-flavoured)", () => {
  test("reads inside untrack() do not subscribe the outer effect", () => {
    const a = signal(1);
    const b = signal(10);
    let runs = 0;
    effect(() => {
      a.get();
      untrack(() => b.get());
      runs++;
    });
    expect(runs).toBe(1);

    // Changing b should NOT re-run.
    b.set(20);
    expect(runs).toBe(1);

    // Changing a SHOULD re-run.
    a.set(2);
    expect(runs).toBe(2);
  });

  test("untrack() returns the value of fn", () => {
    const s = signal(42);
    expect(untrack(() => s.get())).toBe(42);
  });

  test("untrack() restores tracking after it returns", () => {
    const a = signal(1);
    const b = signal(10);
    let runs = 0;
    effect(() => {
      untrack(() => a.get()); // not tracked
      b.get();                 // tracked
      runs++;
    });
    expect(runs).toBe(1);
    a.set(2); // not tracked
    expect(runs).toBe(1);
    b.set(20);
    expect(runs).toBe(2);
  });

  test("untrack() works inside computed()", () => {
    const a = signal(1);
    const b = signal(100);
    const sum = computed(() => a.get() + untrack(() => b.get()));
    expect(sum.get()).toBe(101);

    // b changes — sum does not update (b not tracked).
    b.set(200);
    expect(sum.get()).toBe(101);

    // a changes — sum re-evaluates and reads the latest b.
    a.set(2);
    expect(sum.get()).toBe(202);
  });
});

describe("computed() returns ReadonlySignal (RFC-flavoured)", () => {
  test("exposes get/peek/map", () => {
    const a = signal(3);
    const c = computed(() => a.get() * 2);
    expect(c.get()).toBe(6);
    expect(c.peek()).toBe(6);
    const mapped = c.map((n) => n + 1);
    expect(mapped.get()).toBe(7);
  });

  test(".set() on a computed is a TypeScript error", () => {
    const a = signal(1);
    const c = computed(() => a.get() * 2);
    // @ts-expect-error — computed returns ReadonlySignal; .set() is not allowed.
    c.set(99);
    // (The runtime object IS still a Signal, so the call doesn't throw —
    // the TS error is the contract.)
  });

  test("Signal.map() returns ReadonlySignal", () => {
    const s = signal({ name: "Alice" });
    const name = s.map((v) => v.name);
    expect(name.get()).toBe("Alice");
    // @ts-expect-error — map result is read-only.
    name.set("Bob");
  });
});

// Import matchRoute at top level for route tests
import { matchRoute } from "./routes";

describe("matchRoute", () => {

  test("exact match", () => {
    expect(matchRoute("/", "/")).toEqual({});
    expect(matchRoute("/about", "/about")).toEqual({});
  });

  test("no match", () => {
    expect(matchRoute("/about", "/")).toBeNull();
    expect(matchRoute("/", "/about")).toBeNull();
  });

  test("params", () => {
    expect(matchRoute("/users/:id", "/users/42")).toEqual({ id: "42" });
  });

  test("multiple params", () => {
    expect(matchRoute("/users/:id/posts/:pid", "/users/1/posts/99"))
      .toEqual({ id: "1", pid: "99" });
  });

  test("decodes URI components", () => {
    expect(matchRoute("/search/:q", "/search/hello%20world"))
      .toEqual({ q: "hello world" });
  });

  test("wildcard matches rest of path", () => {
    expect(matchRoute("/sites/*", "/sites/42/settings"))
      .toEqual({ "*": "42/settings" });
  });

  test("wildcard matches empty rest", () => {
    expect(matchRoute("/sites/*", "/sites"))
      .toEqual({ "*": "" });
  });

  test("wildcard matches single segment", () => {
    expect(matchRoute("/sites/*", "/sites/42"))
      .toEqual({ "*": "42" });
  });

  test("wildcard with params", () => {
    expect(matchRoute("/sites/:id/*", "/sites/42/settings/advanced"))
      .toEqual({ id: "42", "*": "settings/advanced" });
  });

  test("wildcard does not match wrong prefix", () => {
    expect(matchRoute("/sites/*", "/other/stuff")).toBeNull();
  });

  test("catch-all wildcard", () => {
    expect(matchRoute("/*", "/anything/here"))
      .toEqual({ "*": "anything/here" });
  });
});
