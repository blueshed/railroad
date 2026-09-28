/**
 * Signals — Push-based reactive primitives
 *
 * Same family as Vue's `ref` / Solid's `createSignal` / Preact's signals:
 * writes propagate eagerly to subscribers; computeds re-evaluate inside an
 * internal effect. Designed to be small enough to fit in your head and
 * predictable enough to write correctly without re-reading the source.
 *
 * Topological scheduling. A write (or a batch of writes) enqueues the
 * affected computeds and effects and runs them ordered by derivation depth,
 * each at most once per settled pass — in a diamond (a -> b, a -> c, an
 * effect reading both b and c) the effect re-runs once and never observes
 * half-updated state. Depth follows the reads: a computed that switches what
 * it reads (`flag.get() ? b.get() : a.get()`) moves itself and its readers
 * deeper, and a computed read before it has settled in the pass is brought up
 * to date first, so no listener reads a half-updated value. Two bounds:
 * siblings at the same depth run in subscription order, and an effect that
 * writes signals re-queues their consumers within the same pass, settling
 * them before the next effect runs (a true cycle throws after the same
 * listener re-runs ~100 times). batch() coalesces MULTIPLE writes (a
 * multi-write transaction) so subscribers see one consistent snapshot.
 *
 * Writes made inside an effect body, its first run included, reach other
 * listeners after the body returns. So an effect that writes `a` and then
 * reads a computed of `a` sees the old value, and re-runs once it settles;
 * an effect that writes its own dependency runs again after, never inside,
 * its current run.
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
 *   function. effect() can return a cleanup function, called once, before
 *   the next run or on dispose; any other return value is ignored. The
 *   callback must be synchronous: an async one is reported on the console.
 *
 * Dispose pattern:
 *   effect() and computed() auto-track in the current dispose scope, so
 *   nested effects inside components / route handlers / when() / list() /
 *   mount() tear down with their parent. No manual trackDispose needed in
 *   app code — mount UI through routes() or jsx's mount() so a root scope
 *   exists. Each effect/computed run is itself an owner scope: anything its
 *   body creates is disposed before the next run and when it is disposed.
 *
 * Render bodies: components, when() branches, list() rows and route handlers
 * run untracked (see jsx.ts), so a .get() there is a one-shot read. In
 * development it warns, once per signal; .peek() is the silent one-shot read,
 * and untrack() says the same on purpose.
 *
 * One copy per page: signals, scopes and providers don't cross copies of
 * railroad, so a second copy logs a console.error naming both when it loads,
 * and a Signal made by one copy throws where the other's JSX, when() or
 * list() is given it. They are not made to cooperate: that would freeze this
 * file's internals as a contract between versions.
 */

// === One copy per page ===
//
// Every copy of railroad has its own Signal class, tracking state, scopes and
// providers, so two copies can't see each other: an effect in one never
// re-runs on a signal from the other, and inject() in one can't find what the
// other provided. The usual cause is a linked checkout (a `file:` or `bun
// link` dependency) that brings its own node_modules/@blueshed/railroad.
// Nothing else would say so, so say it here. The same file evaluated again
// under the Bun runtime is `bun --hot`, not a copy; in a browser nothing
// re-evaluates a module, and copies bundled together share one URL.
const COPY = Symbol.for("@blueshed/railroad");
const copyUrl = (import.meta as { url?: string }).url ?? "(unknown)";
const firstCopy = (globalThis as { [COPY]?: string })[COPY];
if (firstCopy !== undefined && (firstCopy !== copyUrl || !("Bun" in globalThis))) {
  console.error(
    `[railroad] A second copy of @blueshed/railroad has loaded (${copyUrl}; the first: ${firstCopy}). ` +
      "Signals, scopes and provide()/inject() don't cross copies, so the UI will not update. " +
      "Make it one copy: see the railroad skill, \"Local development across repos\".",
  );
}
(globalThis as { [COPY]?: string })[COPY] ??= copyUrl;

// Every Signal carries the URL of the copy that made it, under a key all
// copies share, so a copy handed another's signal can say so where it is used
// rather than render "[object Object]" or a when() that never switches.
const MADE_BY = Symbol.for("@blueshed/railroad.Signal");

/** @internal -- jsx.ts: throws if `value` is a Signal made by another copy of railroad. */
export function assertOwnSignal(value: unknown): void {
  if (typeof value !== "object" || value === null || value instanceof Signal) return;
  const other = (value as { [MADE_BY]?: unknown })[MADE_BY];
  if (typeof other !== "string") return;
  throw new Error(
    `[railroad] This Signal was made by another copy of @blueshed/railroad (${other}), ` +
      `and this copy (${copyUrl}) can't track it: it would render once and never update. ` +
      "Make it one copy: see the railroad skill, \"Local development across repos\".",
  );
}

// Listeners carry their topological level (derivation depth) so the flush
// scheduler can settle upstream computeds before downstream consumers. A
// computed's listener also carries the signal it writes (`output`), what its
// last run read (`deps`), and when it was last known fresh (freshen()).
type Listener = (() => void) & {
  level?: number;
  // It waits in a flush while queuedIn is that flush, at the level queuedAt.
  // raise() can move it to a higher bucket, and freshen() can run it early;
  // the entry left behind no longer matches, and is skipped. Fields, not a
  // Map, because the drain checks them for every listener it runs.
  queuedIn?: Flush | null;
  queuedAt?: number;
  output?: Signal<any>;
  deps?: Set<Signal<any>>;
  fresh?: number;
};

// Global tracking for effect dependencies
let currentListener: Listener | null = null;
let currentDeps: Set<Signal<any>> | null = null;

// === A .get() in a render body ===
//
// Development is anything but a production build. Bun's bundler replaces the
// literal `process.env.NODE_ENV` (not `typeof process`, not `process?.env`),
// so it is read bare; the declaration is local, so no ambient type is needed,
// and the try covers a page served unbundled, with no `process` at all.
declare const process: { env: { NODE_ENV?: string } };
let DEV = true;
try {
  DEV = process.env.NODE_ENV !== "production";
} catch {
  // no process: not a production build
}

// True while a render body runs (in development only): a .get() with no
// listener then is a one-shot read that looks like a binding.
let rendering = false;
const warnedOneShot = new WeakSet<Signal<any>>();

function warnOneShot(s: Signal<any>): void {
  if (warnedOneShot.has(s)) return;
  warnedOneShot.add(s);
  console.warn(
    "[railroad] .get() in a render body (a component, a when() branch, a list() row, a route " +
      "handler) reads once and never updates: nothing re-runs a render. Bind the signal where " +
      "the value should stay live ({s}, class={() => s.get()}, s.map(…)), or read it with " +
      ".peek() if once is what you mean. (Once per signal, in development.)",
  );
}
let batchDepth = 0;
const pendingEffects = new Set<Listener>();

// === Flush scheduler ===
//
// A write outside batch() starts a flush: affected listeners are queued in
// level buckets and drained lowest-level-first, each at most once per queueing.
// Writes made BY a running listener fold into the active flush instead of
// recursing, which is what makes diamonds settle in one consistent pass (and
// keeps deep computed chains off the call stack).
//
// Levels change as dependencies do. A computed that starts reading something
// deeper raises itself and whatever reads it (raise()), so its readers still
// run after it. And a read, during a flush, of a computed at or above the level
// being drained, which may not have settled yet, pulls it up to date first
// (freshen()). Everything below that level has settled: a listener that
// queues something lower (an effect that writes) hands the pass back to it
// before the next one runs. So a listener never reads a half-updated computed,
// even one that switches what it reads.

// Infinite loop guard. A legitimate pass runs each listener a handful of times
// (an effect re-queued by a later same-pass write); a genuine cycle re-runs the
// same listener unboundedly, so the ceiling is per-listener per-flush.
const MAX_RUNS_PER_LISTENER = 100;

interface Flush {
  buckets: (Listener[] | undefined)[];
  // Where the drain stopped in each bucket it left part-read. A bucket is
  // read in place, so an effect that hands the pass to a lower level and gets
  // it back resumes there (re-slicing the rest was quadratic in siblings).
  // Made only when a bucket is first left part-read.
  heads?: number[];
  // The lowest bucket that may hold a listener, so finding the next one
  // doesn't rescan from 0 (quadratic in a deep chain).
  low: number;
  // The level being drained. Every computed below it has settled.
  floor: number;
  runs: Map<Listener, number>;
  // A throwing listener must not strand the ones queued behind it: run them
  // all, remember the first error, and rethrow it once the pass has settled.
  error?: { thrown: unknown };
}

let activeFlush: Flush | null = null;

// Writes to source signals, counted: a computed pulled fresh stays fresh
// until the next one (a computed's own write can't unsettle what it reads).
let sourceWrites = 0;

function place(flush: Flush, l: Listener, lv: number): void {
  l.queuedIn = flush;
  l.queuedAt = lv;
  (flush.buckets[lv] ??= []).push(l);
  if (lv < flush.low) flush.low = lv;
}

function enqueue(flush: Flush, listeners: Iterable<Listener>): void {
  for (const l of listeners) {
    if (l.queuedIn !== flush) place(flush, l, l.level ?? 0);
  }
}

function run(flush: Flush, l: Listener): void {
  // Dequeue before running so a listener that re-dirties its own inputs is
  // re-queued (and the runs guard catches a true cycle).
  l.queuedIn = null;
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
    flush.error ??= { thrown: err };
  }
}

function drain(flush: Flush): void {
  const { buckets } = flush;
  for (;;) {
    let lv = flush.low;
    while (lv < buckets.length && !buckets[lv]) lv++;
    if (lv >= buckets.length) break;
    const bucket = buckets[lv]!;
    flush.low = flush.floor = lv;
    // Listeners queued at this level while it drains join the end of it.
    let head = flush.heads?.[lv] ?? 0;
    while (head < bucket.length) {
      const l = bucket[head++]!;
      if (l.queuedIn !== flush || l.queuedAt !== lv) continue; // moved higher, or already run
      run(flush, l);
      // It wrote a signal that something lower reads: settle that before the
      // rest of this level runs (this bucket keeps its place).
      if (flush.low < lv) break;
    }
    if (head < bucket.length) (flush.heads ??= [])[lv] = head;
    else {
      buckets[lv] = undefined;
      if (flush.heads) flush.heads[lv] = 0;
    }
  }
  if (flush.error) throw flush.error.thrown;
}

function scheduleListeners(listeners: Iterable<Listener>): void {
  if (activeFlush) {
    enqueue(activeFlush, listeners);
    return;
  }
  const flush: Flush = { buckets: [], heads: undefined, low: 0, floor: 0, runs: new Map() };
  enqueue(flush, listeners);
  activeFlush = flush;
  try {
    drain(flush);
  } finally {
    activeFlush = null;
  }
}

// Bring a computed's signal up to date before it is read, when it sits at or
// above the level being drained and so may not have settled: walk what its
// computed read at that height, and run every one queued there, upstream
// first, so each finds its own inputs settled. Only a computed whose inputs
// changed depth, or a sibling of the reader not yet run, gets here; a fixed
// graph never does. An explicit stack, not recursion, so a deep chain stays
// off the call stack.
function freshen(flush: Flush, s: Signal<any>): void {
  const root = s.producer;
  if (!root || root.fresh === sourceWrites) return;
  root.fresh = sourceWrites; // marked on the way in, so a cycle stops here
  const stack: [Listener, Iterator<Signal<any>>][] = [[root, root.deps!.values()]];
  while (stack.length) {
    const [p, deps] = stack[stack.length - 1]!;
    const next = deps.next();
    if (next.done) {
      stack.pop();
      if (p.queuedIn === flush) run(flush, p);
      continue;
    }
    const q = next.value.level >= flush.floor ? next.value.producer : undefined;
    if (q && q.fresh !== sourceWrites) {
      q.fresh = sourceWrites;
      stack.push([q, q.deps!.values()]);
    }
  }
}

// A computed that starts reading something deeper moves deeper itself, and so
// must whatever reads it: otherwise, on a later write, a reader could be run
// before the computed had settled. Raise their levels as far as the rise
// reaches, moving any that wait in the active flush. A cycle can't be
// ordered, so the rise stops where it comes round, and the runs guard is left
// to catch one that doesn't converge. Depth-first, on an explicit stack.
function raise(s: Signal<any>, lv: number, from: Listener): void {
  const readers = (sig: Signal<any>) => (sig as unknown as { listeners: Set<Listener> }).listeners.values();
  s.level = lv;
  const path: Listener[] = [from];
  const onPath = new Set(path);
  const stack: [Signal<any>, Iterator<Listener>][] = [[s, readers(s)]];
  while (stack.length) {
    const [sig, it] = stack[stack.length - 1]!;
    const next = it.next();
    if (next.done) {
      stack.pop();
      onPath.delete(path.pop()!);
      continue;
    }
    const l = next.value;
    const at = sig.level + 1;
    if ((l.level ?? 0) >= at || onPath.has(l)) continue;
    l.level = at;
    if (activeFlush && l.queuedIn === activeFlush) place(activeFlush, l, at);
    if (l.output) {
      l.output.level = at;
      path.push(l);
      onPath.add(l);
      stack.push([l.output, readers(l.output)]);
    }
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
   * consumers re-run after it settles, and is raised with them if that
   * computed starts reading something deeper. @internal
   */
  level = 0;
  /** The listener of the computed that writes this signal, if one does. @internal */
  producer: Listener | undefined = undefined;

  constructor(initialValue: T, options?: SignalOptions<T>) {
    this.value = initialValue;
    this.equalsFn = (options?.equals ?? Object.is) as (a: unknown, b: unknown) => boolean;
  }

  get(): T {
    if (activeFlush && this.level >= activeFlush.floor) freshen(activeFlush, this);
    if (currentListener) this.listeners.add(currentListener);
    else if (rendering) warnOneShot(this);
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

  patch(partial: Partial<T>): void {
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
    if (activeFlush && this.level >= activeFlush.floor) freshen(activeFlush, this);
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
    if (this.level === 0) sourceWrites++; // a source: a computed's signal is deeper
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
(Signal.prototype as unknown as { [MADE_BY]: string })[MADE_BY] = copyUrl;

// === effect() ===

const ASYNC_EFFECT =
  "[railroad/signals] effect callbacks must be synchronous: an async function returns a " +
  "Promise, not a cleanup, and nothing after its first await is tracked or owned. Do the " +
  "async work in an async component or route handler (resolve to a thunk), or start it from " +
  "the effect and write the result into a signal.";

export function effect(fn: () => void | (() => void)): () => void {
  let cleanup: (() => void) | undefined;
  // Owner scope for whatever this run creates (effects, computeds, when/list,
  // components). Disposed before the next run and on dispose — otherwise each
  // re-run would stack a fresh set of children into the enclosing scope.
  let children: Dispose | null = null;
  let deps = new Set<Signal<any>>();
  let disposed = false;

  // Dispose the last run's children and call its cleanup, each exactly once
  // (cleared first, so a run that throws can't leave them to be called again).
  const release = () => {
    const c = children;
    const k = cleanup;
    children = null;
    cleanup = undefined;
    if (c) c();
    if (k) k();
  };

  const execute: Listener = () => {
    // A disposed effect must never run its body again. It can still be reached
    // after dispose() via a batch() flush that snapshotted pendingEffects into
    // a local array before the effect was disposed, so guard here rather than
    // relying on the listener Set having been mutated. Keeps the batch and
    // non-batch paths consistent.
    if (disposed) return;
    release();

    const prevListener = currentListener;
    const prevDeps = currentDeps;
    const nextDeps = new Set<Signal<any>>();
    currentListener = execute;
    currentDeps = nextDeps;

    pushDisposeScope();
    try {
      // Only a function is a cleanup: an expression body's value isn't, and
      // an async body's Promise would make the next run throw from the writer.
      const r: unknown = fn();
      if (typeof r === "function") cleanup = r as () => void;
      else if (r instanceof Promise) console.error(ASYNC_EFFECT);
    } finally {
      children = popDisposeScope();
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
    release();
    for (const dep of deps) dep.unsubscribe(execute);
    deps.clear();
  };

  trackDispose(dispose);
  // The first run defers its writes like a batch, as later runs (inside a
  // flush) already do. Otherwise a write to one of its own dependencies would
  // run the effect again inside itself, and this run would then overwrite the
  // inner run's cleanup and children, which would never be disposed.
  batch(execute);

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
    const self = currentListener!;
    self.deps = currentDeps!; // what this run reads, for freshen()
    const v = fn();
    // currentDeps is this effect's live dep set (fn has finished reading).
    // The output signal sits one level above the deepest source so consumers
    // reading it are scheduled after this computed settles.
    let lv = 0;
    for (const dep of currentDeps!) if (dep.level >= lv) lv = dep.level + 1;
    if (s) {
      // Raised before the write below queues the readers, so they queue at
      // their new levels.
      if (lv > s.level) raise(s, lv, self);
      else s.level = lv;
      s.set(v);
    } else {
      s = new Signal<T>(v, options);
      s.level = lv;
      s.producer = self;
      self.output = s;
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
  return runUntracked(fn, false);
}

/** @internal -- jsx.ts, routes.ts: run a render body untracked, where a .get() warns in development. */
export function untrackRender<T>(fn: () => T): T {
  return runUntracked(fn, DEV);
}

function runUntracked<T>(fn: () => T, render: boolean): T {
  const prevListener = currentListener;
  const prevDeps = currentDeps;
  const prevRendering = rendering;
  currentListener = null;
  currentDeps = null;
  rendering = render; // an untrack() inside a render is a one-shot read on purpose
  try {
    return fn();
  } finally {
    currentListener = prevListener;
    currentDeps = prevDeps;
    rendering = prevRendering;
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
      // Inside a running flush (batch() called from an effect) this folds the
      // queued listeners into the pass already draining.
      try {
        scheduleListeners(pending);
      } catch (err) {
        flushThrew = true;
        flushError = err;
      }
    }
  }
  if (flushThrew) throw flushError;
}

// === Convenience factory ===

export function signal<T>(initialValue: T, options?: SignalOptions<T>): Signal<T> {
  return new Signal(initialValue, options);
}
