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
 * Presence is tracked by key, not by value, so provide(k, undefined) is a real
 * registration: inject(k) returns it and does not throw. tryInject(k) returns
 * undefined both when k was never provided and when undefined was provided —
 * use it for the "maybe present" case where that distinction doesn't matter.
 *
 * key() returns a fresh Symbol each call, so two key("store") calls are
 * DISTINCT keys — share the one Key value across modules (export it), don't
 * re-create it by name.
 *
 * Scope: the registry is a single process-global map. Ideal for client apps
 * and app-wide singletons; on the server it is shared across every request, so
 * do not use it for per-request state. Use clearProviders() to reset between
 * tests.
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
  if (!registry.has(k)) throw new Error(`No provider for ${k.description}`);
  return registry.get(k) as T;
}

export function tryInject<T>(k: Key<T>): T | undefined {
  return registry.get(k) as T | undefined;
}

/** Remove all provided values. Primarily for test isolation. */
export function clearProviders(): void {
  registry.clear();
}
