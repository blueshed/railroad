/**
 * Signals — Push-based reactive primitives
 *
 * Same family as Vue's `ref` / Solid's `createSignal` / Preact's signals:
 * writes propagate eagerly to subscribers; computeds re-evaluate inside an
 * internal effect. Designed to be small enough to fit in your head and
 * predictable enough to write correctly without re-reading the source.
 *
 * Not glitch-free. Propagation is eager and untopological, so a diamond
 * (a -> b, a -> c, an effect reading both b and c) re-runs the effect once
 * per path and its first run can observe a half-updated state (b new, c
 * stale). batch() does NOT fix this for a single write to `a` — the two
 * paths still flush separately; batch() only coalesces MULTIPLE writes (a
 * multi-write transaction) so subscribers re-run once against a consistent
 * snapshot. For DOM binding the transient intermediate state is harmless.
 *
 * Core API:
 *   signal<T>(value, opts?)   — create a mutable reactive value
 *   computed<T>(fn, opts?)    — derive a read-only signal from other signals
 *   effect(fn)                — run a side-effect when its dependencies change
 *   batch(fn)                 — group writes into a single flush
 *   untrack(fn)               — read without registering a dependency
 *
 * Signal<T> methods:
 *   .get()                    — read (tracks dependency when inside effect/computed)
 *   .set(value)               — write (notifies if changed; configurable via `equals`)
 *   .update(fn)               — set via transform: s.update(v => v + 1)
 *   .mutate(fn)               — structuredClone, mutate in place, fire listeners
 *   .patch(partial)           — shallow merge for object signals
 *   .peek()                   — read without tracking
 *   .map(fn)                  — derive a ReadonlySignal: s.map(v => v.name)
 *   .touch()                  — fire listeners without replacing the ref
 *                               (escape hatch for in-place mutation of large
 *                               documents — used by realtime patch streams)
 *
 * ReadonlySignal<T>: { get, peek, map } — what computed() and .map() return.
 *
 * Dependency tracking:
 *   Effects auto-track which signals are read during execution. Stale
 *   subscriptions are unsubscribed on re-run; effect() returns a dispose
 *   function. effect() can return a cleanup, called before each re-run.
 *
 * Dispose pattern:
 *   effect() and computed() auto-track in the current dispose scope, so
 *   nested effects inside components / route handlers / when() / list()
 *   tear down with their parent. No manual trackDispose needed in app code.
 */

type Listener = () => void;

// Global tracking for effect dependencies
let currentListener: Listener | null = null;
let currentDeps: Set<Signal<any>> | null = null;
let batchDepth = 0;
const pendingEffects = new Set<Listener>();

// Infinite loop guard. A genuine cycle climbs this counter extremely fast, so
// the ceiling is set high enough that a legitimate but deep dependency graph
// (e.g. a long chain of derived computeds) won't trip it. The check runs before
// the increment so the limit is exact: depth N is allowed, N+1 throws.
let effectDepth = 0;
const MAX_EFFECT_DEPTH = 1000;

// === Signal options ===

export interface SignalOptions<T> {
  /**
   * Equality function — controls when set() fires listeners.
   * Default: Object.is. Borrowed from the TC39 Signals proposal.
   */
  equals?: (a: T, b: T) => boolean;
}

// === ReadonlySignal<T> ===

/**
 * Read-only view of a Signal. Returned by `computed()` and `Signal.map()`.
 * Has no `.set()` — attempting to call it is a TS error. The runtime
 * value is still a full Signal instance (so `instanceof Signal` works).
 */
export interface ReadonlySignal<T> {
  get(): T;
  peek(): T;
  map<U>(fn: (value: T) => U, options?: SignalOptions<U>): ReadonlySignal<U>;
}

// === Signal<T> ===

export class Signal<T> implements ReadonlySignal<T> {
  private value: T;
  private listeners = new Set<Listener>();
  // Stored as (a, b) => boolean (T-erased) to keep Signal<T> covariant —
  // otherwise Signal<NonNullable<T>> couldn't widen to Signal<T>.
  private equalsFn: (a: unknown, b: unknown) => boolean;

  constructor(initialValue: T, options?: SignalOptions<T>) {
    this.value = initialValue;
    this.equalsFn = (options?.equals ?? Object.is) as (a: unknown, b: unknown) => boolean;
  }

  get(): T {
    if (currentListener) this.listeners.add(currentListener);
    if (currentDeps) currentDeps.add(this);
    return this.value;
  }

  set(newValue: T): void {
    if (!this.equalsFn(this.value, newValue)) {
      this.value = newValue;
      this.touch();
    }
  }

  update(fn: (current: T) => T): void {
    this.set(fn(this.value));
  }

  // Note: .mutate() is for plain-data signals only. structuredClone THROWS on
  // functions, DOM nodes, and other non-cloneable values, and SILENTLY strips
  // the prototype of class instances (you get a plain object back, losing
  // methods/getters). Use .set()/.update() for signals holding class instances.
  mutate(fn: (current: T) => void): void {
    const copy = structuredClone(this.value);
    fn(copy);
    this.value = copy;
    this.touch();
  }

  patch(partial: Partial<T & Record<string, unknown>>): void {
    this.set({ ...this.value, ...partial } as T);
  }

  peek(): T {
    return this.value;
  }

  map<U>(fn: (value: T) => U, options?: SignalOptions<U>): ReadonlySignal<U> {
    return computed(() => fn(this.get()), options);
  }

  /**
   * Fire subscribers without replacing the value reference.
   *
   * Pair with in-place mutation when you want to skip the `structuredClone`
   * cost of `.mutate(fn)` — for example, applying JSON-Patch ops to a large
   * document. `.set(sameRef)` is a no-op under `Object.is`; `.touch()` is
   * the escape hatch.
   *
   * Caveat — `Object.is` still gates computed propagation. Only effects
   * and primitive-returning computeds downstream will re-run. A computed
   * that returns the same reference (e.g. `computed(() => s.get().items)`)
   * bails out under its own internal `set(sameRef)` guard, so `.touch()`
   * will not propagate past it. That is by design, not a drop-in "wake
   * everything up" button.
   *
   * Use `.peek()` (not `.get()`) for the in-place mutation step so you
   * don't register an unintended dependency when called from an effect.
   *
   * Respects `batch()` — listeners are deferred until the batch exits.
   */
  touch(): void {
    if (batchDepth > 0) {
      for (const listener of this.listeners) pendingEffects.add(listener);
      return;
    }
    if (effectDepth >= MAX_EFFECT_DEPTH) {
      throw new Error(
        "Maximum effect depth exceeded — possible infinite loop",
      );
    }
    effectDepth++;
    try {
      for (const listener of this.listeners) listener();
    } finally {
      effectDepth--;
    }
  }

  unsubscribe(listener: Listener): void {
    this.listeners.delete(listener);
  }
}

// === effect() ===

export function effect(fn: () => void | (() => void)): () => void {
  let cleanup: (() => void) | void;
  let deps = new Set<Signal<any>>();
  let disposed = false;

  const execute = () => {
    // A disposed effect must never run its body again. It can still be reached
    // after dispose() via a batch() flush that snapshotted pendingEffects into
    // a local array before the effect was disposed, so guard here rather than
    // relying on the listener Set having been mutated. Keeps the batch and
    // non-batch paths consistent.
    if (disposed) return;
    if (cleanup) cleanup();

    const prevListener = currentListener;
    const prevDeps = currentDeps;
    const nextDeps = new Set<Signal<any>>();
    currentListener = execute;
    currentDeps = nextDeps;

    try {
      cleanup = fn();
    } finally {
      currentListener = prevListener;
      currentDeps = prevDeps;
    }

    // Unsubscribe from signals no longer read
    for (const dep of deps) {
      if (!nextDeps.has(dep)) dep.unsubscribe(execute);
    }
    deps = nextDeps;
  };

  const dispose = () => {
    if (disposed) return; // idempotent — safe to call more than once
    disposed = true;
    if (cleanup) cleanup();
    for (const dep of deps) dep.unsubscribe(execute);
    deps.clear();
  };

  trackDispose(dispose);
  execute();

  return dispose;
}

// === Dispose type & scope management ===

export type Dispose = () => void;

const disposeStack: Dispose[][] = [];

export function pushDisposeScope(): void {
  disposeStack.push([]);
}

export function popDisposeScope(): Dispose {
  const disposers = disposeStack.pop();
  if (!disposers) {
    throw new Error(
      "popDisposeScope called with no active scope — push/pop imbalance",
    );
  }
  return () => disposers.forEach((d) => d());
}

export function trackDispose(d: Dispose): void {
  const scope = disposeStack[disposeStack.length - 1];
  if (scope) scope.push(d);
}

// === computed() ===

export function computed<T>(
  fn: () => T,
  options?: SignalOptions<T>,
): ReadonlySignal<T> {
  // The effect's first run replaces currentListener/currentDeps with its own,
  // so fn() tracks for the inner effect, not any outer listener — no leak,
  // and fn() is evaluated exactly once on creation.
  let s!: Signal<T>;
  effect(() => {
    const v = fn();
    if (s) s.set(v);
    else s = new Signal<T>(v, options);
  });
  return s;
}

// === untrack() ===

/**
 * Run `fn` with dependency tracking disabled. Reads inside `fn` will not
 * register the calling effect/computed as a subscriber. Borrowed from the
 * TC39 Signals proposal (`Signal.subtle.untrack`).
 */
export function untrack<T>(fn: () => T): T {
  const prevListener = currentListener;
  const prevDeps = currentDeps;
  currentListener = null;
  currentDeps = null;
  try {
    return fn();
  } finally {
    currentListener = prevListener;
    currentDeps = prevDeps;
  }
}

// === batch() ===

let flushing = false;

export function batch(fn: () => void): void {
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0 && !flushing) {
      flushing = true;
      // A throwing effect must not strand the effects already queued behind it
      // (pendingEffects was cleared before running). Run them all, remember the
      // first error, and rethrow it once the flush has drained.
      let firstError: unknown;
      let hasError = false;
      try {
        while (pendingEffects.size > 0) {
          const effects = [...pendingEffects];
          pendingEffects.clear();
          for (const e of effects) {
            try {
              e();
            } catch (err) {
              if (!hasError) {
                hasError = true;
                firstError = err;
              }
            }
          }
        }
      } finally {
        flushing = false;
      }
      if (hasError) throw firstError;
    }
  }
}

// === Convenience factory ===

export function signal<T>(initialValue: T, options?: SignalOptions<T>): Signal<T> {
  return new Signal(initialValue, options);
}
