import { describe, test, expect } from "bun:test";
import { signal, computed, effect, batch, Signal, pushDisposeScope, popDisposeScope } from "./signals";

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
