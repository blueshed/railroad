/**
 * Shared — typed provide / inject for dependency sharing.
 *
 * Any module can provide a value under a typed key.
 * Any other module can inject it without prop-threading.
 *
 *   const STORE = key<Store>("store");
 *   provide(STORE, createStore());   // in home.ts
 *   const store = inject(STORE);     // anywhere
 *
 * Scope: the registry is a single process-global map. Ideal for client apps
 * and app-wide singletons; on the server it is shared across every request, so
 * do not use it for per-request state. (undefined is the "missing" sentinel —
 * you cannot provide() undefined; use null if you need an explicit empty.)
 */

const registry = new Map<symbol, unknown>();

export type Key<T> = symbol & { __brand: T };

export function key<T>(name: string): Key<T> {
  return Symbol(name) as Key<T>;
}

export function provide<T>(k: Key<T>, value: T): void {
  registry.set(k, value);
}

export function inject<T>(k: Key<T>): T {
  const v = registry.get(k);
  if (v === undefined) throw new Error(`No provider for ${k.description}`);
  return v as T;
}

export function tryInject<T>(k: Key<T>): T | undefined {
  return registry.get(k) as T | undefined;
}
