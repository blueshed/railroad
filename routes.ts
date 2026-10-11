/**
 * Routes — Hash-based client router built on signals
 *
 * API:
 *   routes(target, table, options?) — declarative hash router, swaps target
 *                             content; a table value is a handler or
 *                             { handler, keyed? }
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
 * A promise that resolves to a bare Node is an error (onError, or the
 * console): what it built after its first await would have no owner scope.
 *   params  — the params at the time the handler ran. A handler runs once
 *             per pattern, so `({ id }) => <h1>{id}</h1>` still shows the
 *             first id after /users/1 → /users/2 (unless the route is keyed).
 *   params$ — ReadonlySignal that updates when params change within the same
 *             pattern: `(_, p$) => <h1>{p$.map(p => p.id)}</h1>`
 * A handler, like a component, runs untracked: a .get() in it is a one-shot
 * read that doesn't subscribe the router (and warns, in development).
 *
 * The router manages cleanup automatically. When params change within the
 * same pattern (e.g. /users/1 → /users/2), params$ updates — no teardown.
 *
 * Keyed routes — a table value `{ handler, keyed: true }` re-runs its handler
 * whenever the matched params change (compared value by value), disposing
 * the previous run, as Solid's <Show keyed> does. Then destructuring works:
 *   "/users/:id": { keyed: true, handler: ({ id }) => <User id={id} /> }
 * Keep a wildcard layout unkeyed, or every sub-path remounts it (its
 * params["*"] changes). `{ handler }` without keyed is a bare handler.
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

import { Signal, signal, computed, effect, untrack, untrackRender, scoped, trackDispose } from "./signals";
import type { Dispose, ReadonlySignal } from "./signals";
import { adoptIntoSvg, renderThunk } from "./jsx";

// The hash as a signal, shared by every route() and routes() through one
// hashchange listener, counted.
let hashSignal: Signal<string> | null = null;
let hashListenerCount = 0;
let hashListener: (() => void) | null = null;

// A share of the hash signal, and its release. The release runs once however
// often it is called, so disposing a scope twice can't drive the count
// negative and detach the listener from other routers; the last removes it.
function getHash(): { hash: Signal<string>; release: Dispose } {
  if (!hashSignal) {
    hashSignal = new Signal(location.hash.slice(1) || "/");
    hashListener = () => {
      hashSignal!.set(location.hash.slice(1) || "/");
    };
    window.addEventListener("hashchange", hashListener);
  }
  hashListenerCount++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (--hashListenerCount === 0) {
      window.removeEventListener("hashchange", hashListener!);
      hashListener = null;
      hashSignal = null;
    }
  };
  return { hash: hashSignal, release };
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

// Two matches of one pattern have the same keys; compare their values.
function sameParams(a: Record<string, string>, b: Record<string, string>): boolean {
  return Object.keys(a).every((k) => a[k] === b[k]);
}

export function route<
  T extends Record<string, string> = Record<string, string>,
>(pattern: string): ReadonlySignal<T | null> {
  const { hash, release } = getHash();
  trackDispose(release);
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

/** A table entry: a handler, or `{ handler, keyed }`. With `keyed: true` the
 *  handler re-runs (a fresh scope, the old one disposed) whenever the matched
 *  params change, instead of running once per pattern. */
type RouteEntry<H> = H | { handler: H; keyed?: boolean };

export interface RouterOptions {
  onError?: (err: unknown) => Node | void;
}

export function routes(
  target: Element,
  table: Record<string, RouteEntry<RouteHandler>>,
  options?: RouterOptions,
): Dispose {
  const { hash, release } = getHash();
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

  // Show onError's fallback for a failed render (one that threw, rejected or
  // resolved to no thunk), or log it, and forget the route so the next
  // navigation runs it again. A throwing onError is logged, never thrown, so
  // it can't escape as an unhandled rejection.
  function failed(err: unknown, log: string): void {
    activePattern = null;
    activeParams = null;
    try {
      const fallback = options?.onError?.(err);
      if (fallback instanceof Node) {
        target.appendChild(adoptIntoSvg(fallback, target));
        return;
      }
    } catch (boundaryErr) {
      console.error("[railroad/routes] onError boundary threw:", boundaryErr);
      return;
    }
    console.error(log, err);
  }

  function run(handler: RouteHandler, params: Record<string, string>) {
    const myRunId = ++runId;
    const params$ = signal(params);
    activeParams = params$;
    let ran: { value: Node | Promise<() => Node>; dispose: Dispose };
    try {
      ran = scoped(() => untrackRender("a route handler", handler, () => handler(params, params$)));
    } catch (err) {
      return failed(err, "[railroad/routes] handler threw:");
    }
    const { value: result, dispose: scopeDispose } = ran;
    if (!(result instanceof Promise)) {
      activeDispose = scopeDispose;
      target.appendChild(adoptIntoSvg(result, target));
      return;
    }

    // Async. The handler's scope has closed (never across an await) and holds
    // what it made before its first one; the thunk it resolves to builds the
    // rest under a scope of its own. A settlement after navigating away (a
    // newer run) only disposes.
    asyncPending = true;
    const isCurrent = (): boolean => {
      if (myRunId !== runId) {
        scopeDispose();
        return false;
      }
      asyncPending = false;
      return true;
    };
    const asyncFailed = (err: unknown) => {
      scopeDispose();
      failed(err, "[railroad/routes] async handler failed:");
    };
    result.then(
      (resolved) => {
        if (!isCurrent()) return;
        let built: { value: Node; dispose: Dispose };
        try {
          built = renderThunk(resolved, "an async route handler", "a route handler", handler);
        } catch (err) {
          return asyncFailed(err);
        }
        activeDispose = () => {
          built.dispose();
          scopeDispose();
        };
        target.appendChild(adoptIntoSvg(built.value, target));
      },
      (err) => {
        if (isCurrent()) asyncFailed(err);
      },
    );
  }

  // Register the outer dispose into the caller's scope BEFORE creating the
  // effect, so dispose lands in the caller's scope (not the router's own
  // internal one). run() keeps the dispose stack balanced across async first
  // renders, so this is now purely about attributing dispose to the right scope.
  let disposeEffect: Dispose | null = null;
  let disposed = false;
  const dispose = () => {
    // Idempotent: called by the returned handle and by a parent scope, it
    // tears down once.
    if (disposed) return;
    disposed = true;
    if (disposeEffect) disposeEffect();
    teardown();
    release();
  };
  trackDispose(dispose);

  // Show whatever `path` matches. Runs untracked (below): a handler is a render
  // body, so a .get() inside it must not subscribe the router.
  function show(path: string) {
    for (const [pattern, entry] of Object.entries(table)) {
      const params = matchRoute(pattern, path);
      if (!params) continue;
      const { handler, keyed } = typeof entry === "function" ? { handler: entry, keyed: false } : entry;
      // Same pattern, new params: push them into params$, no teardown. Unless a
      // render for the old params is still in flight: its resolution would
      // paint outdated content, and a handler that captured the initial
      // `params` would never refresh, so tear down and run it again. A keyed
      // route runs again whenever the params differ.
      if (
        pattern === activePattern && !asyncPending &&
        !(keyed && !sameParams(params, activeParams!.peek()))
      ) {
        activeParams!.set(params);
        return;
      }
      teardown();
      activePattern = pattern;
      run(handler, params);
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
