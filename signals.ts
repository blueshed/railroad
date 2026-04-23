/**
 * Signals — Lightweight reactive primitives
 *
 * A standalone reactive system with no framework or DOM dependencies.
 *
 * Core API:
 *   signal<T>(value)        — create a mutable reactive value
 *   computed<T>(fn)         — derive a read-only signal from other signals
 *   effect(fn)              — run a side-effect whenever its dependencies change
 *   batch(fn)               — group multiple updates into a single flush
 *
 * Signal<T> methods:
 *   .get()                  — read value (tracks dependency when inside effect/computed)
 *   .set(value)             — write value (notifies listeners if changed via Object.is)
 *   .update(fn)             — set via transform: s.update(v => v + 1)
 *   .mutate(fn)             — structuredClone, mutate in place, fire listeners: s.mutate(v => v.items.push(x))
 *   .patch(partial)         — shallow merge for object signals: s.patch({ name: "new" })
 *   .peek()                 — read value without tracking
 *   .map(fn)                — derive a new signal: s.map(v => v.name)
 *   .touch()                — fire listeners without replacing the ref (escape hatch for in-place mutation)
 *
 * Dependency tracking:
 *   Effects automatically track which signals are read during execution.
 *   On re-run, stale subscriptions are removed and new ones added.
 *   effect() returns a dispose function that unsubscribes from all deps.
 *
 * Dispose pattern:
 *   effect() can return a cleanup function, called before each re-run and on dispose.
 *   effect() and computed() auto-track in the current dispose scope —
 *   no manual trackDispose() needed inside components.
 */

type Listener = () => void;

// Global tracking for effect dependencies
let currentListener: Listener | null = null;
let currentDeps: Set<Signal<any>> | null = null;
let batchDepth = 0;
const pendingEffects = new Set<Listener>();

// Infinite loop guard
let effectDepth = 0;
const MAX_EFFECT_DEPTH = 100;

// === Signal<T> ===

export class Signal<T> {
  private value: T;
  private listeners = new Set<Listener>();

  constructor(initialValue: T) {
    this.value = initialValue;
  }

  get(): T {
    if (currentListener) this.listeners.add(currentListener);
    if (currentDeps) currentDeps.add(this);
    return this.value;
  }

  set(newValue: T): void {
    if (!Object.is(this.value, newValue)) {
      this.value = newValue;
      this.touch();
    }
  }

  update(fn: (current: T) => T): void {
    this.set(fn(this.value));
  }

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

  map<U>(fn: (value: T) => U): Signal<U> {
    return computed(() => fn(this.get()));
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
    effectDepth++;
    try {
      if (effectDepth >= MAX_EFFECT_DEPTH) {
        throw new Error(
          "Maximum effect depth exceeded — possible infinite loop",
        );
      }
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

  const execute = () => {
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
  const disposers = disposeStack.pop() || [];
  return () => disposers.forEach((d) => d());
}

export function trackDispose(d: Dispose): void {
  const scope = disposeStack[disposeStack.length - 1];
  if (scope) scope.push(d);
}

// === computed() ===

export function computed<T>(fn: () => T): Signal<T> {
  // Suspend outer tracking during initial evaluation so computed()
  // inside list() render functions doesn't leak subscriptions to the
  // list effect's listener — which causes infinite sync re-entry.
  const prevListener = currentListener;
  const prevDeps = currentDeps;
  currentListener = null;
  currentDeps = null;
  let initial: T;
  try { initial = fn(); } finally {
    currentListener = prevListener;
    currentDeps = prevDeps;
  }
  const s = new Signal<T>(initial);
  effect(() => s.set(fn()));
  return s;
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
      try {
        while (pendingEffects.size > 0) {
          const effects = [...pendingEffects];
          pendingEffects.clear();
          for (const e of effects) e();
        }
      } finally {
        flushing = false;
      }
    }
  }
}

// === Convenience factory ===

export function signal<T>(initialValue: T): Signal<T> {
  return new Signal(initialValue);
}
