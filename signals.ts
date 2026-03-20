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
 *   .peek()                 — read value without tracking
 *
 * Dependency tracking:
 *   Effects automatically track which signals are read during execution.
 *   On re-run, stale subscriptions are removed and new ones added.
 *   effect() returns a dispose function that unsubscribes from all deps.
 *
 * Dispose pattern:
 *   effect() can return a cleanup function, called before each re-run and on dispose.
 *   Components should collect dispose functions and return a combined Dispose.
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
      this.notify();
    }
  }

  update(fn: (current: T) => T): void {
    this.set(fn(this.value));
  }

  peek(): T {
    return this.value;
  }

  private notify(): void {
    if (batchDepth > 0) {
      for (const listener of this.listeners) pendingEffects.add(listener);
      return;
    }
    effectDepth++;
    try {
      if (effectDepth > MAX_EFFECT_DEPTH) {
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

  execute();

  return () => {
    if (cleanup) cleanup();
    for (const dep of deps) dep.unsubscribe(execute);
    deps.clear();
  };
}

// === computed() ===

export function computed<T>(fn: () => T): Signal<T> {
  const s = new Signal<T>(fn());
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

// === Dispose type ===

export type Dispose = () => void;
