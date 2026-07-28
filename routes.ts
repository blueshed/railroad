/**
 * Routes — Hash-based client router built on signals
 *
 * API:
 *   routes(target, table)   — declarative hash router, swaps target content
 *   route<T>(pattern)       — reactive route: Signal<T | null>, null when unmatched
 *   navigate(path)          — set location.hash programmatically
 *   matchRoute(pattern, path) — pure pattern matcher, returns params or null
 *
 * Patterns:
 *   "/users/:id"     — named params, exact segment match
 *   "/sites/*"       — wildcard, matches /sites and /sites/any/depth
 *   "/sites/:id/*"   — params + wildcard, rest captured as params["*"]
 *
 * Patterns are tested in declaration order; the first match wins. Declare
 * specific routes before parameterised ones (`/users/new` before `/users/:id`).
 *
 * Matching is purely segment-based — there is no query-string handling. A
 * hash of "#/users/42?tab=1" matches "/users/:id" with id === "42?tab=1"
 * (split on "?" yourself if you need it), and a trailing slash is a real
 * empty segment: "/users/42/" does NOT match "/users/:id".
 *
 * Handlers receive (params, params$) and return a Node (sync or async).
 *   params  — plain object for destructuring: ({ id }) => ...
 *   params$ — Signal that updates when params change within the same pattern
 *
 * The router manages cleanup automatically. When params change within the
 * same pattern (e.g. /users/1 → /users/2), params$ updates — no teardown.
 *
 * Nested routes — use wildcard to keep a layout mounted:
 *   routes(app, {
 *     "/":          () => <Home />,
 *     "/sites/*":   () => <SitesLayout />,
 *   });
 *   // Inside SitesLayout, use route() for sub-navigation:
 *   const detail = route("/sites/:id");
 *
 * Both routes() and route() auto-track in the parent dispose scope,
 * so nested routing cleans up when the parent scope tears down.
 *
 * route() at module level (outside any dispose scope) is SUPPORTED: the
 * signal and its share of the hashchange listener simply live for the app's
 * lifetime, which is what module scope means. That's why route() doesn't warn
 * when scopeless the way when()/list() do — for those, scopeless is almost
 * always a leak; for route() it's a legitimate app-lifetime binding.
 */

import { Signal, signal, computed, effect, pushDisposeScope, popDisposeScope, trackDispose } from "./signals";
import type { Dispose, ReadonlySignal } from "./signals";

let hashSignal: Signal<string> | null = null;
let hashListenerCount = 0;
let hashListener: (() => void) | null = null;

function getHash(): Signal<string> {
  if (!hashSignal) {
    hashSignal = new Signal(location.hash.slice(1) || "/");
    hashListener = () => {
      hashSignal!.set(location.hash.slice(1) || "/");
    };
    window.addEventListener("hashchange", hashListener);
  }
  hashListenerCount++;
  return hashSignal;
}

function releaseHash(): void {
  hashListenerCount--;
  if (hashListenerCount === 0 && hashListener) {
    window.removeEventListener("hashchange", hashListener);
    hashListener = null;
    hashSignal = null;
  }
}

export function matchRoute(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const pp = pattern.split("/");
  const hp = path.split("/");
  const isWild = pp.length > 0 && pp[pp.length - 1] === "*";

  if (isWild) {
    if (hp.length < pp.length - 1) return null;
  } else {
    if (pp.length !== hp.length) return null;
  }

  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i] === "*") {
      params["*"] = hp.slice(i).map(s => {
        try { return decodeURIComponent(s); } catch { return s; }
      }).join("/");
      return params;
    } else if (pp[i]!.startsWith(":")) {
      // A malformed percent-escape must not silently un-match the route.
      // Fall back to the raw segment, consistent with the wildcard branch.
      try {
        params[pp[i]!.slice(1)] = decodeURIComponent(hp[i]!);
      } catch {
        params[pp[i]!.slice(1)] = hp[i]!;
      }
    } else if (pp[i] !== hp[i]) return null;
  }
  return params;
}

export function route<
  T extends Record<string, string> = Record<string, string>,
>(pattern: string): ReadonlySignal<T | null> {
  const hash = getHash();
  // Idempotent release — disposing the scope more than once must not drive the
  // shared hashListenerCount negative and tear the listener out from under
  // other live routers.
  let released = false;
  trackDispose(() => {
    if (released) return;
    released = true;
    releaseHash();
  });
  return computed(() => matchRoute(pattern, hash.get()) as T | null);
}

export function navigate(path: string): void {
  location.hash = path;
}

type RouteHandler = (
  params: Record<string, string>,
  params$: Signal<Record<string, string>>,
) => Node | Promise<Node>;

export interface RouterOptions {
  onError?: (err: unknown) => Node | void;
}

export function routes(
  target: HTMLElement,
  table: Record<string, RouteHandler>,
  options?: RouterOptions,
): Dispose {
  const hash = getHash();
  let activePattern: string | null = null;
  let activeParams: Signal<Record<string, string>> | null = null;
  let activeDispose: Dispose | null = null;
  let runId = 0;
  let asyncPending = false;

  function teardown() {
    // Bumping runId invalidates any in-flight async render: when its promise
    // settles, the myRunId !== runId guard disposes that render's own scope.
    runId++;
    asyncPending = false;
    if (activeDispose) activeDispose();
    activeDispose = null;
    activePattern = null;
    activeParams = null;
    target.replaceChildren();
  }

  // Route the error through onError (if present) or console.error. Used by both
  // the sync-throw and async-reject paths so they behave identically — and so a
  // throwing onError can never escape as an unhandled rejection.
  function handleError(err: unknown): boolean {
    if (options?.onError) {
      try {
        const fallback = options.onError(err);
        if (fallback instanceof Node) {
          target.appendChild(fallback);
          return true;
        }
      } catch (boundaryErr) {
        console.error("[railroad/routes] onError boundary threw:", boundaryErr);
        return true;
      }
    }
    return false;
  }

  function run(handler: RouteHandler, params: Record<string, string>) {
    const myRunId = ++runId;
    activeParams = signal(params);

    // Always pop the scope synchronously before run() returns — never leave it
    // pushed across an await. Otherwise an async first render returns with the
    // global dispose stack imbalanced, so a parent scope pops the wrong scope
    // (leaking its own disposers) and the resolving .then() captures the parent
    // scope into activeDispose, recursing into a stack overflow on teardown.
    pushDisposeScope();
    let result: Node | Promise<Node>;
    try {
      result = handler(params, activeParams);
    } catch (err) {
      // Synchronous throw — pop+dispose the children created so far so the
      // stack stays balanced, then route through the error boundary.
      popDisposeScope()();
      activePattern = null;
      activeParams = null;
      if (handleError(err)) return;
      throw err;
    }
    // No synchronous throw: pop now (balanced) and capture the disposer.
    const scopeDispose = popDisposeScope();

    if (result instanceof Promise) {
      asyncPending = true;
      result.then(
        (node) => {
          if (myRunId !== runId) {
            scopeDispose(); // navigated away during await — drop orphaned children
            return;
          }
          asyncPending = false;
          activeDispose = scopeDispose;
          target.appendChild(node);
        },
        (err) => {
          if (myRunId !== runId) {
            scopeDispose();
            return;
          }
          asyncPending = false;
          scopeDispose();
          activePattern = null;
          activeParams = null;
          if (handleError(err)) return;
          console.error("[railroad/routes] async handler rejected:", err);
        },
      );
    } else {
      activeDispose = scopeDispose;
      target.appendChild(result);
    }
  }

  // Register the outer dispose into the caller's scope BEFORE creating the
  // effect, so dispose lands in the caller's scope (not the router's own
  // internal one). run() keeps the dispose stack balanced across async first
  // renders, so this is now purely about attributing dispose to the right scope.
  let disposeEffect: Dispose | null = null;
  let disposed = false;
  const dispose = () => {
    // Idempotent — calling dispose() more than once (or via both the returned
    // handle and a parent scope) must release the shared hash refcount exactly
    // once, or it goes negative and detaches the listener from other routers.
    if (disposed) return;
    disposed = true;
    if (disposeEffect) disposeEffect();
    teardown();
    releaseHash();
  };
  trackDispose(dispose);

  disposeEffect = effect(() => {
    const path = hash.get();
    for (const [pattern, handler] of Object.entries(table)) {
      const params = matchRoute(pattern, path);
      if (params) {
        if (pattern === activePattern) {
          // Same pattern, different params. If a render for the OLD params is
          // still in flight, updating the signal alone would let the stale
          // resolution paint outdated content (and a handler that captured the
          // initial `params` arg would never refresh) — so invalidate it with a
          // full teardown + re-run. Otherwise just push the new params.
          if (asyncPending) {
            teardown();
            activePattern = pattern;
            try {
              run(handler, params);
            } catch (err) {
              console.error("[railroad/routes] handler threw:", err);
            }
            return;
          }
          activeParams!.set(params);
          return;
        }
        teardown();
        activePattern = pattern;
        try {
          run(handler, params);
        } catch (err) {
          // Handler errors must not kill the router or leak the dep set on
          // the hash signal. run()'s try/catch already balanced the dispose
          // stack and reset state — surface the error so it's visible.
          console.error("[railroad/routes] handler threw:", err);
        }
        return;
      }
    }
    teardown();
  });

  return dispose;
}
