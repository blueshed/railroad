import { describe, test, expect, spyOn } from "bun:test";
import { signal, computed, effect, batch, untrack, pushDisposeScope, popDisposeScope } from "./signals";
import type { ReadonlySignal } from "./signals";
import { createElement, when, mount } from "./jsx";

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

describe("Signal.patch(): object signals only, typed keys", () => {
  test("patch on an array throws instead of corrupting to an index-keyed object", () => {
    const rows = signal([{ id: 1 }, { id: 2 }]);
    expect(() => (rows as any).patch({ id: 3 })).toThrow(/array/i);
    expect(Array.isArray(rows.peek())).toBe(true); // value untouched
  });

  test("patch on an object signal still shallow-merges", () => {
    const filter = signal({ color: "all", done: false });
    filter.patch({ color: "blue" });
    expect(filter.peek()).toEqual({ color: "blue", done: false });
  });

  // Checked by `bun run check` (tsc over this file): the @ts-expect-error must find its error.
  test(".patch() takes only the signal's own keys", () => {
    const filter = signal({ color: "all", done: false });
    // @ts-expect-error -- "colr" is not a key of the value (it compiled before)
    filter.patch({ colr: "blue" });
    filter.patch({ color: "blue" });
    expect(filter.peek().color).toBe("blue");
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

describe("effect() and batch(): dispose, the depth guard, a masked error", () => {
  test("an effect disposed mid-batch does not run (batch == non-batch)", () => {
    const s = signal(0);
    let bRuns = 0;
    let disposeB: (() => void) | undefined;
    // A is registered first, so it runs first in the flush and disposes B.
    effect(() => { s.get(); if (disposeB) disposeB(); });
    disposeB = effect(() => { s.get(); bRuns++; });

    bRuns = 0;
    batch(() => { s.set(1); });
    expect(bRuns).toBe(0); // B was disposed by A before its queued run
  });

  test("MAX_EFFECT_DEPTH throws on a self-feeding effect", () => {
    const s = signal(0);
    expect(() => {
      effect(() => { const v = s.get(); if (v < 100000) s.set(v + 1); });
    }).toThrow(/Maximum effect depth/);
  });

  test("a deep-but-finite computed chain (300) completes — guard isn't 100", () => {
    const base = signal(0);
    let prev: ReadonlySignal<number> = base;
    for (let i = 0; i < 300; i++) {
      const p = prev;
      prev = computed(() => p.get() + 1);
    }
    expect(prev.get()).toBe(300);
    expect(() => base.set(1)).not.toThrow();
    expect(prev.get()).toBe(301);
  });

  test("dispose() shrinks the listener Set and is idempotent", () => {
    const s = signal(0);
    const d = effect(() => { s.get(); });
    expect((s as any).listeners.size).toBe(1);
    d();
    d(); // second call must be a safe no-op
    expect((s as any).listeners.size).toBe(0);
  });

  test("a throwing effect run does not strand subscriptions past dispose()", () => {
    const a = signal(0);
    const b = signal(0);
    // First run reads only a; the second run reads b and then throws, so the
    // dep-set swap must still happen or dispose() can never unsubscribe from b.
    const d = effect(() => {
      if (a.get() === 1) { b.get(); throw new Error("boom"); }
    });
    expect(() => a.set(1)).toThrow("boom");
    d();
    expect((a as any).listeners.size).toBe(0);
    expect((b as any).listeners.size).toBe(0);
  });

  test("batch(): an error thrown by fn() is not masked by a flush error", () => {
    const s = signal(0);
    // This effect throws during the flush; fn()'s own error must still win.
    effect(() => { if (s.get() > 0) throw new Error("flush boom"); });
    expect(() => {
      batch(() => {
        s.set(1);
        throw new Error("fn boom");
      });
    }).toThrow("fn boom");
  });
});

describe("effect(): each run owns what it creates", () => {
  test("a computed created inside an effect is disposed on the next run", () => {
    const a = signal(0);
    let innerRuns = 0;
    const dispose = effect(() => {
      a.get();
      computed(() => { innerRuns++; return a.get(); });
    });
    innerRuns = 0;
    for (let i = 1; i <= 5; i++) a.set(i);
    // One fresh inner computed per run; the previous run's is gone, so it
    // doesn't also re-evaluate (before the fix: 1+2+3+4+5 + 5 = 20).
    expect(innerRuns).toBe(5);
    dispose();
    a.set(99);
    expect(innerRuns).toBe(5);
  });

  test("a nested effect is disposed before re-run and on dispose", () => {
    const outer = signal(0);
    const inner = signal(0);
    let innerRuns = 0;
    const dispose = effect(() => {
      outer.get();
      effect(() => { inner.get(); innerRuns++; });
    });
    outer.set(1);
    outer.set(2);
    innerRuns = 0;
    inner.set(1);
    expect(innerRuns).toBe(1); // only the live nested effect responds
    dispose();
    inner.set(2);
    expect(innerRuns).toBe(1);
  });

  test("a throwing effect body still balances the dispose stack and owns its children", () => {
    const a = signal(0);
    let innerRuns = 0;
    pushDisposeScope();
    expect(() =>
      effect(() => {
        computed(() => { innerRuns++; return a.get(); });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    const outerDispose = popDisposeScope(); // would throw on imbalance
    outerDispose();
    innerRuns = 0;
    a.set(1);
    expect(innerRuns).toBe(0);
  });

  test("a function child's effects from earlier runs are cleaned up, not accumulated", () => {
    const n = signal(0);
    let builds = 0;
    let live = 0;
    const root = document.createElement("div");
    const dispose = mount(root, () => (
      <div>{() => {
        n.get();
        const probe = signal(0);
        effect(() => { probe.get(); live++; return () => { live--; }; });
        builds++;
        return "";
      }}</div>
    ));
    for (let i = 1; i <= 4; i++) n.set(i);
    expect(builds).toBe(5);
    expect(live).toBe(1); // earlier runs' effects were cleaned up
    dispose();
    expect(live).toBe(0);
  });
});

describe("effect(): a first run that writes its own dependency", () => {
  // The first run used to start a flush of its own when it wrote a signal it had read, so the
  // effect ran again INSIDE itself; the outer run then overwrote the inner run's cleanup and
  // children, which were never disposed. The first run now defers its writes like batch().
  test("re-runs after its body, and loses no cleanup or child", () => {
    const a = signal(0);
    const b = signal(0);
    let bodies = 0, cleanups = 0, innerRuns = 0, depth = 0, maxDepth = 0;
    const dispose = effect(() => {
      maxDepth = Math.max(maxDepth, ++depth);
      const v = a.get();
      if (v < 2) a.set(v + 1); // e.g. clamp or default a selection
      bodies++;
      effect(() => { b.get(); innerRuns++; });
      depth--;
      return () => { cleanups++; };
    });
    expect(maxDepth).toBe(1); // never re-entered
    expect(bodies).toBe(3);
    expect(cleanups).toBe(2); // every earlier run cleaned up
    innerRuns = 0;
    b.set(1);
    expect(innerRuns).toBe(1); // one live child, not one per run
    dispose();
    expect(cleanups).toBe(3);
    innerRuns = 0;
    b.set(2);
    expect(innerRuns).toBe(0);
  });

  test("a clamping effect in a component leaves no timer behind after unmount", () => {
    const page = signal(5);
    const pageCount = signal(3);
    let live = 0;
    function Pager() {
      effect(() => {
        if (page.get() > pageCount.get()) page.set(pageCount.get());
        live++;
        return () => { live--; };
      });
      return <p>{page}</p>;
    }
    const root = document.createElement("div");
    const dispose = mount(root, () => <Pager />);
    expect(root.textContent).toBe("3");
    expect(live).toBe(1);
    dispose();
    expect(live).toBe(0);
  });

  test("reads its own writes the same way on every run: stale, then re-run", () => {
    const a = signal(1);
    const b = computed(() => a.get() * 10);
    const trigger = signal(0);
    const log: string[] = [];
    effect(() => { const t = trigger.get(); a.set(t + 100); log.push(`t=${t} b=${b.get()}`); });
    trigger.set(1);
    // before: the first run saw b fresh (1000) and later runs saw it stale
    expect(log).toEqual(["t=0 b=10", "t=0 b=1000", "t=1 b=1000", "t=1 b=1010"]);
  });

  test("writes made before a first run throws still propagate, and the error surfaces", () => {
    const other = signal(0);
    let seen = -1;
    effect(() => { seen = other.get(); });
    expect(() => effect(() => { other.set(7); throw new Error("first run failed"); })).toThrow("first run failed");
    expect(seen).toBe(7);
  });
});

describe("effect(): only a returned function is a cleanup", () => {
  // Whatever the body returned was stored as the cleanup and called before the next run, so the
  // next write threw "cleanup is not a function" out of the writer's .set().
  test("an async effect is reported where it is created, and the writer doesn't throw", () => {
    const s = signal(0);
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      // @ts-expect-error -- an async callback is what the check is for
      const dispose = effect(async () => { s.get(); });
      expect(errorSpy.mock.calls.some((c) => String(c[0]).includes("must be synchronous"))).toBe(true);
      expect(() => s.set(1)).not.toThrow(); // before: "cleanup is not a function (… Promise)"
      dispose();
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("an expression body's value is not a cleanup", () => {
    const s = signal(0);
    const box = { text: "" };
    // @ts-expect-error -- tsc rejects it; bun runs it anyway
    const dispose = effect(() => (box.text = String(s.get())));
    expect(() => s.set(1)).not.toThrow(); // before: "cleanup is not a function"
    expect(box.text).toBe("1");
    dispose();
  });

  test("a cleanup runs once even when the next run throws", () => {
    const t = signal(0);
    let calls = 0;
    const dispose = effect(() => {
      if (t.get() === 1) throw new Error("second run");
      return () => { calls++; };
    });
    expect(() => t.set(1)).toThrow("second run");
    dispose();
    expect(calls).toBe(1); // before: 2, the thrown run left the old cleanup in place
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

  test("a throwing effect does not strand others queued behind it", () => {
    const a = signal(0);
    let goodRuns = 0;
    // Throws only on re-run (a > 0), so creation succeeds and it subscribes.
    effect(() => { if (a.get() > 0) throw new Error("boom"); });
    effect(() => { a.get(); goodRuns++; });
    goodRuns = 0;

    // Both effects are queued by the write; the thrower must not prevent the
    // second from running, and the first error is rethrown out of batch().
    expect(() => {
      batch(() => { a.set(1); });
    }).toThrow("boom");
    expect(goodRuns).toBe(1);
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

describe("topological scheduling (glitch-free)", () => {
  test("diamond: one write re-runs the effect once, with consistent values", () => {
    const a = signal(1);
    const b = computed(() => a.get() * 10);
    const c = computed(() => a.get() + 1);
    const seen: Array<[number, number]> = [];
    effect(() => { seen.push([b.get(), c.get()]); });
    expect(seen).toEqual([[10, 2]]);

    a.set(2);
    // Pre-0.10 this produced [[10,2],[20,2],[20,3]] — a torn middle state.
    expect(seen).toEqual([[10, 2], [20, 3]]);
  });

  test("diamond under batch() behaves identically", () => {
    const a = signal(1);
    const b = computed(() => a.get() * 10);
    const c = computed(() => a.get() + 1);
    const seen: Array<[number, number]> = [];
    effect(() => { seen.push([b.get(), c.get()]); });

    batch(() => { a.set(2); a.set(3); });
    expect(seen).toEqual([[10, 2], [30, 4]]);
  });

  test("unequal-depth branches still settle before the reader", () => {
    // a -> long chain -> d, and a -> e directly; reader sees both consistent.
    const a = signal(1);
    const b = computed(() => a.get() + 1);
    const ch = computed(() => b.get() + 1);
    const d = computed(() => ch.get() + 1);
    const e = computed(() => a.get() * 100);
    const seen: Array<[number, number]> = [];
    effect(() => { seen.push([d.get(), e.get()]); });
    expect(seen).toEqual([[4, 100]]);

    a.set(2);
    expect(seen).toEqual([[4, 100], [5, 200]]);
  });

  test("an effect that writes a signal re-queues its consumers in the same pass", () => {
    const source = signal(0);
    const derived = signal(0);
    effect(() => { derived.set(source.get() * 2); });
    const seen: number[] = [];
    effect(() => { seen.push(derived.get()); });
    expect(seen).toEqual([0]);

    source.set(3);
    expect(seen).toEqual([0, 6]);
  });
});

describe("scheduling: a computed that switches what it reads", () => {
  // Levels were fixed when a reader subscribed, so a computed that moved to a deeper source
  // (flag.get() ? b.get() : …) could be read, on a later write, before it settled: one effect run
  // on half-updated values, then another on the settled ones.
  test("an effect doesn't see it half-updated after it deepens", () => {
    const a = signal(1);
    const flag = signal(false);
    const b = computed(() => a.get() * 2);
    const c = computed(() => (flag.get() ? b.get() : a.get() * 2));
    const seen: string[] = [];
    effect(() => { seen.push(`a=${a.get()} c=${c.get()}`); });
    flag.set(true);
    a.set(2);
    expect(seen).toEqual(["a=1 c=2", "a=2 c=4"]);
  });

  test("an effect that starts reading a computed in the same pass sees it settled", () => {
    const a = signal(1);
    const flag = signal(false);
    const b = computed(() => a.get() * 2);
    const seen: string[] = [];
    effect(() => { seen.push(flag.get() ? `a=${a.get()} b=${b.get()}` : `a=${a.get()}`); });
    batch(() => { flag.set(true); a.set(2); });
    expect(seen).toEqual(["a=1", "a=2 b=4"]);
  });

  test("an effect that writes lets what reads its write settle before the next effect runs", () => {
    // Two effects at one level: the first copies c into a, the second reads a and b = a * 2.
    const s = signal(1);
    const a = signal(0);
    const c = computed(() => s.get());
    effect(() => { a.set(c.get()); });
    const b = computed(() => a.get() * 2);
    const seen: string[] = [];
    effect(() => { seen.push(`a=${a.get()} b=${b.get()} c=${c.get()}`); });
    s.set(2);
    expect(seen).toEqual(["a=1 b=2 c=1", "a=2 b=4 c=2"]);
  });

  test("an effect that reads inside its own batch() sees settled values", () => {
    const a = signal(1);
    const flag = signal(false);
    const b = computed(() => a.get() * 2);
    const c = computed(() => b.get() + 1);
    const seen: string[] = [];
    effect(() => {
      a.get();
      flag.get();
      batch(() => { if (flag.get()) seen.push(`a=${a.get()} c=${c.get()}`); });
    });
    batch(() => { flag.set(true); a.set(2); });
    expect(seen).toEqual(["a=2 c=5"]);
  });

  test("an effect created in the middle of a pass (a when() branch's binding) sees settled values", () => {
    const a = signal(1);
    const show = signal(false);
    const b = computed(() => a.get() * 2);
    const c = computed(() => b.get() + 1);
    const seen: number[] = [];
    const root = document.createElement("div");
    const dispose = mount(root, () => when(show, () => <p>{() => { seen.push(c.get()); return c.get(); }}</p>));
    batch(() => { show.set(true); a.set(2); });
    expect(seen).toEqual([5]);
    expect(root.textContent).toBe("5");
    dispose();
  });

  test("an effect created mid-pass that writes a, then first reads a computed of a, sees it settled", () => {
    // Outside a pass it sees the old value and runs again (the effect() tests above); during
    // one, the computed is brought up to date as it is read, so it runs once.
    const a = signal(0);
    const c = computed(() => a.get() * 10);
    const go = signal(false);
    const seen: number[] = [];
    effect(() => {
      if (go.get()) effect(() => { if (a.peek() < 1) a.set(1); seen.push(c.get()); });
    });
    go.set(true);
    expect(seen).toEqual([10]);
  });
});

describe("scheduling: the randomized glitch checker", () => {
  // The checker the ledger asked for: random graphs of computeds that pick their inputs by the
  // parity of another, read by effects that do the same. Each effect checks every value it reads
  // against the value computed from the sources afresh, so a half-updated read is counted; after
  // each write every computed and effect must be settled, and no effect may run twice. An effect
  // reads plainly, inside a batch() of its own, or is built afresh by a parent effect on each of
  // the parent's runs, so it is created, and first reads, in the middle of a pass.
  function check(seed: number, dynamic: boolean) {
    let t = seed;
    const rand = (n: number) => {
      t = (t + 0x6d2b79f5) | 0;
      let x = Math.imul(t ^ (t >>> 15), 1 | t);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return Math.floor((((x ^ (x >>> 14)) >>> 0) / 4294967296) * n);
    };
    type Spec = { sel: number; even: number[]; odd: number[] };
    const spec = (below: number): Spec => {
      const some = () => Array.from({ length: 1 + rand(2) }, () => rand(below));
      const even = some();
      return { sel: rand(below), even, odd: dynamic ? some() : even };
    };
    const f = ({ sel, even, odd }: Spec, read: (j: number) => number) => {
      const v = read(sel);
      let sum = v;
      for (const j of v % 2 === 0 ? even : odd) sum += read(j);
      return sum % 5; // small, so computeds often recompute to an unchanged value
    };
    const nSources = 3 + rand(3);
    const specs = Array.from({ length: 6 + rand(10) }, (_, i) => spec(nSources + i));
    const sources = Array.from({ length: nSources }, () => signal(rand(5)));
    const nodes: ReadonlySignal<number>[] = [...sources];
    for (const sp of specs) nodes.push(computed(() => f(sp, (j) => nodes[j]!.get())));
    // What every node should hold, from the sources as they are now.
    const settled = () => {
      const v: number[] = sources.map((s) => s.peek());
      specs.forEach((sp, i) => v.push(f(sp, (j) => v[j]!)));
      return v;
    };
    const counts = { glitches: 0, stale: 0, reruns: 0 };
    const effects = Array.from({ length: 2 + rand(4) }, () => {
      const e = { spec: spec(nodes.length), last: -1, runs: 0, child: false };
      const body = () => {
        e.runs++;
        const want = settled();
        e.last = f(e.spec, (j) => {
          const got = nodes[j]!.get();
          if (got !== want[j]) counts.glitches++;
          return got;
        });
      };
      const kind = rand(3);
      if (kind === 0) effect(body);
      else if (kind === 1) effect(() => batch(body));
      else {
        // A child can run once just before its parent's re-run replaces it: not counted as twice.
        e.child = true;
        const by = sources[rand(nSources)]!;
        effect(() => { by.get(); effect(body); });
      }
      return e;
    });
    for (let step = 0; step < 40; step++) {
      for (const e of effects) e.runs = 0;
      const writes = Array.from({ length: 1 + rand(3) }, () => [rand(nSources), rand(5)] as const);
      if (writes.length === 1) sources[writes[0]![0]]!.set(writes[0]![1]);
      else batch(() => { for (const [i, v] of writes) sources[i]!.set(v); });
      const want = settled();
      nodes.forEach((n, j) => { if (n.peek() !== want[j]) counts.stale++; });
      for (const e of effects) {
        if (e.last !== f(e.spec, (j) => want[j]!)) counts.stale++;
        if (e.runs > 1 && !e.child) counts.reruns++;
      }
    }
    return counts;
  }
  test("random graphs: no effect reads a half-updated value, runs twice, or is left stale", () => {
    const total = { glitches: 0, stale: 0, reruns: 0 };
    for (let seed = 1; seed <= 400; seed++) {
      pushDisposeScope();
      try {
        // 100 graphs whose computeds always read the same inputs, 300 that switch
        for (const [k, v] of Object.entries(check(seed, seed > 100))) total[k as keyof typeof total] += v;
      } finally {
        popDisposeScope()();
      }
    }
    expect(total).toEqual({ glitches: 0, stale: 0, reruns: 0 });
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

describe("an app's production build drops the development warnings", () => {
  // The development flag was set inside a try, which no minifier folds, so a production bundle
  // still carried every warning about a programming mistake (244 B gzipped on a page, for the
  // render-body warning and the second-copy check alone).
  const WARNINGS = [
    "reads once and never updates", // a .get() in a render body
    "A second copy of @blueshed/railroad",
    "effect callbacks must be synchronous",
    "expects a function but got", // an on* prop
    "fallback must be a thunk",
    "A reactive child held a DOM Node",
    "created outside a dispose scope",
    "duplicate keys detected",
  ];

  test("their text is in a development bundle and not in a production one", async () => {
    const entry = new URL("./index.ts", import.meta.url).pathname;
    const bundle = async (NODE_ENV: string) => {
      const built = await Bun.build({
        entrypoints: [entry], minify: true, target: "browser",
        define: { "process.env.NODE_ENV": JSON.stringify(NODE_ENV) },
      });
      return built.outputs[0]!.text();
    };
    const said = (text: string) => WARNINGS.filter((warning) => text.includes(warning));
    expect(said(await bundle("development"))).toEqual(WARNINGS);
    expect(said(await bundle("production"))).toEqual([]);
  });
});

describe("a second copy of railroad says so when it loads", () => {
  // Two copies (a linked checkout bringing its own node_modules/@blueshed/railroad) can't see each
  // other's signals, scopes or providers: the UI just stops updating, with nothing on the console.
  test("console.error names both copies and the fix", async () => {
    const { mkdtempSync, copyFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "railroad-copy-"));
    const first = new URL("./signals.ts", import.meta.url);
    copyFileSync(first, join(dir, "signals.ts"));
    // In a child process, so the copy stays out of this one (and its coverage).
    const run = Bun.spawnSync([process.execPath, "-e",
      `await import(${JSON.stringify(first.pathname)}); await import(${JSON.stringify(join(dir, "signals.ts"))});`]);
    const msg = run.stderr.toString();
    expect(msg).toContain("second copy of @blueshed/railroad");
    expect(msg).toContain(dir); // the new copy
    expect(msg).toContain(first.href); // the first
    expect(msg).toContain("Local development across repos");
  });
});
