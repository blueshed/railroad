/**
 * Routes — Hash-based client router built on signals
 *
 * API:
 *   routes(target, table)   — declarative hash router, swaps target content
 *   route<T>(pattern)       — reactive route: Signal<T | null>, null when unmatched
 *   navigate(path)          — set location.hash programmatically
 *   matchRoute(pattern, path) — pure pattern matcher, returns params or null
 *
 * Handlers receive (params, params$) and return a Node (sync or async).
 *   params  — plain object for destructuring: ({ id }) => ...
 *   params$ — Signal that updates when params change within the same pattern
 *
 * The router manages cleanup automatically. When params change within the
 * same pattern (e.g. /users/1 → /users/2), params$ updates — no teardown.
 *   routes(app, {
 *     "/":          () => <Home />,
 *     "/site/:id":  ({ id }, params$) => <SiteDetail id={id} params$={params$} />,
 *     "/status":    async () => { const s = await api.get(); return <Status data={s} />; },
 *   });
 */

import { Signal, signal, computed, effect, pushDisposeScope, popDisposeScope } from "./signals";
import type { Dispose } from "./signals";

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
  if (pp.length !== hp.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i]!.startsWith(":")) {
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
>(pattern: string): Signal<T | null> {
  const hash = getHash();
  return computed(() => matchRoute(pattern, hash.get()) as T | null);
}

export function navigate(path: string): void {
  location.hash = path;
}

type RouteHandler = (
  params: Record<string, string>,
  params$: Signal<Record<string, string>>,
) => Node | Promise<Node>;

export function routes(
  target: HTMLElement,
  table: Record<string, RouteHandler>,
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
    const result = handler(params, activeParams);

    if (result instanceof Promise) {
      asyncPending = true;
      result.then((node) => {
        if (myRunId !== runId) return; // navigated away during await
        asyncPending = false;
        activeDispose = popDisposeScope();
        target.appendChild(node);
      });
    } else {
      activeDispose = popDisposeScope();
      target.appendChild(result);
    }
  }

  const disposeEffect = effect(() => {
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
        run(handler, params);
        return;
      }
    }
    if (table["*"]) {
      if (activePattern !== "*") {
        teardown();
        activePattern = "*";
        run(table["*"], {});
      }
      return;
    }
    teardown();
  });

  return () => {
    disposeEffect();
    teardown();
    releaseHash();
  };
}
