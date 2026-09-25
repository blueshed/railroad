/**
 * Routes — Hash-based client router built on signals
 *
 * API:
 *   routes(target, table)   — declarative hash router, swaps target content
 *   route<T>(pattern)       — reactive route: Signal<T | null>, null when unmatched
 *   navigate(path)          — set location.hash; route() and routes() are
 *                             current when it returns (no tick to wait for)
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
 * Handlers receive (params, params$) and return a Node, or a Promise of a
 * THUNK (() => Node): railroad runs the thunk under a scope it owns, so
 * reactive bindings built after the first await are disposed on navigation.
 *   "/users/:id": async ({ id }) => { const u = await load(id); return () => <User u={u} />; }
 * DEPRECATED: a handler resolving to a bare Promise<Node> still renders, but
 * its post-await bindings have no owner scope (browser JS has no
 * AsyncContext) and outlive the route. routes() given such a handler is
 * marked @deprecated (an editor strikes it through); a later release drops
 * the form from the type.
 *   params  — the params at the time the pattern was entered. The handler
 *             runs once per pattern, so `({ id }) => <h1>{id}</h1>` still
 *             shows the first id after /users/1 → /users/2.
 *   params$ — ReadonlySignal that updates when params change within the same
 *             pattern: `(_, p$) => <h1>{p$.map(p => p.id)}</h1>`
 * A handler, like a component, runs untracked: a .get() in it is a one-shot
 * read that doesn't subscribe the router.
 *
 * The router manages cleanup automatically. When params change within the
 * same pattern (e.g. /users/1 → /users/2), params$ updates — no teardown.
 *
 * navigate(path) updates the route signal synchronously, so route() and the
 * router show the new path as navigate() returns, and the hashchange that
 * follows re-runs nothing. Setting location.hash yourself, or following an
 * <a href="#/…">, still lands on the next hashchange (a macrotask later).
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

import { Signal, signal, computed, effect, untrack, pushDisposeScope, popDisposeScope, trackDispose } from "./signals";
import type { Dispose, ReadonlySignal } from "./signals";
import { adoptIntoSvg } from "./jsx";

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
  // Set the route signal now rather than a tick later on hashchange, so route()
  // and routes() are current when navigate() returns. Read the hash back rather
  // than using `path`: the browser percent-encodes it ("a b" → "a%20b"), and
  // the hashchange that follows sets this same string, so it re-runs nothing.
  hashSignal?.set(location.hash.slice(1) || "/");
}

/** A route handler: returns a Node, or a Promise that resolves to a thunk
 *  (`() => Node`) railroad runs under a scope it owns. */
type RouteHandler = (
  params: Record<string, string>,
  params$: ReadonlySignal<Record<string, string>>,
) => Node | Promise<() => Node>;

/**
 * @deprecated A handler whose Promise resolves to a bare Node. What it builds
 * after its first await has no owner scope and outlives the route. Resolve to
 * a thunk instead: `async () => { const u = await load(); return () => <User u={u} />; }`.
 * It still renders; a later release drops it from the type.
 */
type DeprecatedRouteHandler = (
  params: Record<string, string>,
  params$: ReadonlySignal<Record<string, string>>,
) => Node | Promise<Node | (() => Node)>;

export interface RouterOptions {
  onError?: (err: unknown) => Node | void;
}

export function routes(
  target: Element,
  table: Record<string, RouteHandler>,
  options?: RouterOptions,
): Dispose;
/**
 * @deprecated A handler in this table resolves to a bare `Promise<Node>`, whose
 * post-await bindings outlive the route. Resolve to a thunk instead:
 * `async () => { const u = await load(); return () => <User u={u} />; }`.
 */
export function routes(
  target: Element,
  table: Record<string, DeprecatedRouteHandler>,
  options?: RouterOptions,
): Dispose;
export function routes(
  target: Element,
  table: Record<string, DeprecatedRouteHandler>,
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
          target.appendChild(adoptIntoSvg(fallback, target));
          return true;
        }
      } catch (boundaryErr) {
        console.error("[railroad/routes] onError boundary threw:", boundaryErr);
        return true;
      }
    }
    return false;
  }

  function run(handler: DeprecatedRouteHandler, params: Record<string, string>) {
    const myRunId = ++runId;
    activeParams = signal(params);

    // Always pop the scope synchronously before run() returns — never leave it
    // pushed across an await. Otherwise an async first render returns with the
    // global dispose stack imbalanced, so a parent scope pops the wrong scope
    // (leaking its own disposers) and the resolving .then() captures the parent
    // scope into activeDispose, recursing into a stack overflow on teardown.
    pushDisposeScope();
    let result: Node | Promise<Node | (() => Node)>;
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
        (resolved) => {
          if (myRunId !== runId) {
            scopeDispose(); // navigated away during await — drop orphaned children
            return;
          }
          asyncPending = false;
          if (typeof resolved === "function") {
            // Thunk resolution — the owner scope for post-await bindings. A
            // bare Node resolution stays supported, but anything reactive it
            // created after the first await is ownerless (browser JS has no
            // AsyncContext to carry the scope across an await); resolve to a
            // thunk so railroad can bracket its construction.
            pushDisposeScope();
            let built: unknown;
            let thrown: unknown;
            let didThrow = false;
            try {
              built = resolved();
            } catch (err) {
              didThrow = true;
              thrown = err;
            }
            const thunkDispose = popDisposeScope();
            if (didThrow || !(built instanceof Node)) {
              thunkDispose();
              scopeDispose();
              activePattern = null;
              activeParams = null;
              const err = didThrow
                ? thrown
                : new Error("[railroad/routes] async handler thunk returned a non-Node");
              if (handleError(err)) return;
              console.error("[railroad/routes] async handler thunk failed:", err);
              return;
            }
            const preAwaitDispose = scopeDispose;
            activeDispose = () => {
              thunkDispose();
              preAwaitDispose();
            };
            target.appendChild(adoptIntoSvg(built, target));
            return;
          }
          activeDispose = scopeDispose;
          target.appendChild(adoptIntoSvg(resolved, target));
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
      target.appendChild(adoptIntoSvg(result, target));
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

  // Show whatever `path` matches. Runs untracked (below): a handler is a render
  // body, so a .get() inside it must not subscribe the router.
  function show(path: string) {
    for (const [pattern, handler] of Object.entries(table)) {
      const params = matchRoute(pattern, path);
      if (!params) continue;
      // Same pattern, new params: push them into params$, no teardown. Unless a
      // render for the old params is still in flight: its resolution would
      // paint outdated content, and a handler that captured the initial
      // `params` would never refresh, so tear down and run it again.
      if (pattern === activePattern && !asyncPending) {
        activeParams!.set(params);
        return;
      }
      teardown();
      activePattern = pattern;
      try {
        run(handler, params);
      } catch (err) {
        // A throwing handler must not kill the router. run() already balanced
        // the dispose stack and reset its state; surface the error.
        console.error("[railroad/routes] handler threw:", err);
      }
      return;
    }
    teardown();
  }

  disposeEffect = effect(() => {
    const path = hash.get();
    untrack(() => show(path));
  });

  return dispose;
}
