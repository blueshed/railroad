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
      try {
        params[pp[i]!.slice(1)] = decodeURIComponent(hp[i]!);
      } catch {
        return null;
      }
    } else if (pp[i] !== hp[i]) return null;
  }
  return params;
}

export function route<
  T extends Record<string, string> = Record<string, string>,
>(pattern: string): ReadonlySignal<T | null> {
  const hash = getHash();
  trackDispose(() => releaseHash());
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
    runId++;
    if (asyncPending) {
      popDisposeScope()();
      asyncPending = false;
    }
    if (activeDispose) activeDispose();
    activeDispose = null;
    activePattern = null;
    activeParams = null;
    target.replaceChildren();
  }

  function run(handler: RouteHandler, params: Record<string, string>) {
    const myRunId = ++runId;
    activeParams = signal(params);
    pushDisposeScope();
    let result: Node | Promise<Node>;
    try {
      result = handler(params, activeParams);
    } catch (err) {
      // Synchronous throw — pop and dispose so the stack stays balanced.
      popDisposeScope()();
      activePattern = null;
      activeParams = null;
      if (options?.onError) {
        const fallback = options.onError(err);
        if (fallback instanceof Node) {
          target.appendChild(fallback);
          return;
        }
      }
      throw err;
    }

    if (result instanceof Promise) {
      asyncPending = true;
      result.then(
        (node) => {
          if (myRunId !== runId) return; // navigated away during await
          asyncPending = false;
          activeDispose = popDisposeScope();
          target.appendChild(node);
        },
        (err) => {
          if (myRunId !== runId) return; // teardown already popped our scope
          asyncPending = false;
          popDisposeScope()();
          activePattern = null;
          activeParams = null;
          if (options?.onError) {
            const fallback = options.onError(err);
            if (fallback instanceof Node) {
              target.appendChild(fallback);
              return;
            }
          }
          console.error("[railroad/routes] async handler rejected:", err);
        },
      );
    } else {
      activeDispose = popDisposeScope();
      target.appendChild(result);
    }
  }

  // Register the outer dispose into the caller's scope BEFORE creating the
  // effect — otherwise an async first-render leaves run()'s pushed scope on
  // the stack, and trackDispose() would place dispose into the route's own
  // internal scope, causing a self-disposal loop on teardown.
  let disposeEffect: Dispose | null = null;
  const dispose = () => {
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
          // Same pattern, different params — update the signal
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
