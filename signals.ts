/**
 * Signals — Push-based reactive primitives
 *
 * Same family as Vue's `ref` / Solid's `createSignal` / Preact's signals:
 * writes propagate eagerly to subscribers; computeds re-evaluate inside an
 * internal effect. Designed to be small enough to fit in your head and
 * predictable enough to write correctly without re-reading the source.
 *
 * Glitch-free by topological scheduling. A write (or a batch of writes)
 * enqueues the affected computeds and effects and runs them ordered by
 * derivation depth, each at most once per settled pass — in a diamond
 * (a -> b, a -> c, an effect reading both b and c) the effect re-runs once
 * and never observes half-updated state. Two bounds to know: siblings at the
 * same depth run in subscription order, and an effect that writes signals
 * re-queues their consumers within the same pass (a true cycle throws after
 * the same effect re-runs ~100 times). batch() coalesces MULTIPLE writes (a
 * multi-write transaction) so subscribers see one consistent snapshot.
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
 *   nested effects inside components / route handlers / when() / list() /
 *   mount() tear down with their parent. No manual trackDispose needed in
 *   app code — mount UI through routes() or jsx's mount() so a root scope
 *   exists.
 */

// Listeners carry their topological level (derivation depth) so the flush
// scheduler can settle upstream computeds before downstream consumers.
type Listener = (() => void) & { level?: number };

// Global tracking for effect dependencies
let currentListener: Listener | null = null;
let currentDeps: Set<Signal<any>> | null = null;
let batchDepth = 0;
const pendingEffects = new Set<Listener>();

// === Flush scheduler ===
//
// A write outside batch() starts a flush: affected listeners are queued in
// level buckets and drained lowest-level-first, each at most once per queueing.
// Writes made BY a running listener fold into the active flush instead of
// recursing, which is what makes diamonds settle in one consistent pass (and
// keeps deep computed chains off the call stack).

// Infinite loop guard. A legitimate pass runs each listener a handful of times
// (an effect re-queued by a later same-pass write); a genuine cycle re-runs the
// same listener unboundedly, so the ceiling is per-listener per-flush.
const MAX_RUNS_PER_LISTENER = 100;

interface Flush {
  buckets: (Listener[] | undefined)[];
  queued: Set<Listener>;
  runs: Map<Listener, number>;
}

let activeFlush: Flush | null = null;

function enqueue(flush: Flush, listeners: Iterable<Listener>): void {
  for (const l of listeners) {
    if (flush.queued.has(l)) continue;
    flush.queued.add(l);
    const lv = l.level ?? 0;
    (flush.buckets[lv] ??= []).push(l);
  }
}

function drain(flush: Flush): void {
  // A throwing listener must not strand the ones queued behind it — run them
  // all, remember the first error, and rethrow it once the pass has settled.
  let firstError: unknown;
  let hasError = false;
  for (;;) {
    let lv = -1;
    for (let i = 0; i < flush.buckets.length; i++) {
      if (flush.buckets[i]?.length) { lv = i; break; }
    }
    if (lv === -1) break;
    const bucket = flush.buckets[lv]!;
    flush.buckets[lv] = undefined;
    for (const l of bucket) {
      // Remove from `queued` before running so a listener that re-dirties its
      // own inputs is re-queued (and the runs guard catches a true cycle).
      flush.queued.delete(l);
      const n = (flush.runs.get(l) ?? 0) + 1;
      if (n > MAX_RUNS_PER_LISTENER) {
        throw new Error(
          "Maximum effect depth exceeded — possible infinite loop",
        );
      }
      flush.runs.set(l, n);
      try {
        l();
      } catch (err) {
        if (!hasError) {
          hasError = true;
          firstError = err;
        }
      }
    }
  }
  if (hasError) throw firstError;
}

function scheduleListeners(listeners: Iterable<Listener>): void {
  if (activeFlush) {
    enqueue(activeFlush, listeners);
    return;
  }
  const flush: Flush = { buckets: [], queued: new Set(), runs: new Map() };
  enqueue(flush, listeners);
  activeFlush = flush;
  try {
    drain(flush);
  } finally {
    activeFlush = null;
  }
}

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
  /**
   * Topological depth for the flush scheduler: 0 for source signals; a
   * computed's output signal carries 1 + the depth of its deepest source so
   * consumers re-run after it settles. @internal
   */
  level = 0;

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
    // Spreading an array into `{ ... }` yields a plain object keyed by index —
    // silently corrupt data that surfaces far from the call site. Refuse loudly
    // instead; arrays update via .set() / .update() / .mutate().
    if (Array.isArray(this.value)) {
      throw new Error(
        "[railroad/signals] .patch() shallow-merges OBJECT signals — on an " +
          "array it would spread indices into a plain object. Use .set(), " +
          ".update(), or .mutate() for array signals.",
      );
    }
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
    if (this.listeners.size === 0) return;
    if (batchDepth > 0) {
      for (const listener of this.listeners) pendingEffects.add(listener);
      return;
    }
    scheduleListeners(this.listeners);
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

  const execute: Listener = () => {
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
      // Swap dep sets even when fn() throws: signals read before the throw
      // have already registered this effect, so skipping the swap would leave
      // dispose() iterating the stale set and leak those subscriptions.
      for (const dep of deps) {
        if (!nextDeps.has(dep)) dep.unsubscribe(execute);
      }
      deps = nextDeps;
      // Topological level: one deeper than the deepest dependency, so the
      // scheduler settles upstream computeds before re-running this effect.
      let lv = 0;
      for (const dep of deps) if (dep.level >= lv) lv = dep.level + 1;
      execute.level = lv;
    }
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

/**
 * True while a dispose scope is active (inside a component, a routes()
 * handler, a when()/list() render, or mount()). when() and list() warn when
 * created without one, because their internal disposers are unreachable.
 */
export function hasActiveDisposeScope(): boolean {
  return disposeStack.length > 0;
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
    // currentDeps is this effect's live dep set (fn has finished reading).
    // The output signal sits one level above the deepest source so consumers
    // reading it are scheduled after this computed settles.
    let lv = 0;
    for (const dep of currentDeps!) if (dep.level >= lv) lv = dep.level + 1;
    if (s) {
      s.level = lv;
      s.set(v);
    } else {
      s = new Signal<T>(v, options);
      s.level = lv;
    }
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

export function batch(fn: () => void): void {
  // If fn() itself threw, its error takes priority over a flush error — the
  // flush still runs (writes made before the throw must propagate), but must
  // not mask the original exception. drain() already guarantees a throwing
  // listener can't strand the ones queued behind it.
  let flushError: unknown;
  let flushThrew = false;
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0 && pendingEffects.size > 0) {
      const pending = [...pendingEffects];
      pendingEffects.clear();
      if (activeFlush) {
        // batch() exited inside a running flush (called from an effect) —
        // fold the queued listeners into the pass already draining.
        enqueue(activeFlush, pending);
      } else {
        try {
          scheduleListeners(pending);
        } catch (err) {
          flushThrew = true;
          flushError = err;
        }
      }
    }
  }
  if (flushThrew) throw flushError;
}

// === Convenience factory ===

export function signal<T>(initialValue: T, options?: SignalOptions<T>): Signal<T> {
  return new Signal(initialValue, options);
}
