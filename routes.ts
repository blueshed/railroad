/**
 * Routes — Hash-based client router built on signals
 *
 * API:
 *   routes(target, table)   — declarative hash router, swaps target content
 *   route<T>(pattern)       — reactive route: Signal<T | null>, null when unmatched
 *   navigate(path)          — set location.hash programmatically
 *   matchRoute(pattern, path) — pure pattern matcher, returns params or null
 *
 * Handlers return a Node to render. The router manages cleanup automatically.
 *   routes(app, {
 *     "/":          () => <Home />,
 *     "/site/:id":  ({ id }) => <SiteDetail id={id} />,
 *   });
 */

import { Signal, computed, effect } from "./signals";
import type { Dispose } from "./signals";
import { pushDisposeScope, popDisposeScope } from "./jsx";

let hashSignal: Signal<string> | null = null;

function getHash(): Signal<string> {
  if (!hashSignal) {
    hashSignal = new Signal(location.hash.slice(1) || "/");
    window.addEventListener("hashchange", () => {
      hashSignal!.set(location.hash.slice(1) || "/");
    });
  }
  return hashSignal;
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

type RouteHandler = (params: Record<string, string>) => Node;

export function routes(
  target: HTMLElement,
  table: Record<string, RouteHandler>,
): Dispose {
  const hash = getHash();
  let activePattern: string | null = null;
  let activeDispose: Dispose | null = null;

  function teardown() {
    if (activeDispose) activeDispose();
    activeDispose = null;
    activePattern = null;
    target.replaceChildren();
  }

  function run(handler: RouteHandler, params: Record<string, string>) {
    pushDisposeScope();
    const node = handler(params);
    activeDispose = popDisposeScope();
    target.appendChild(node);
  }

  return effect(() => {
    const path = hash.get();
    for (const [pattern, handler] of Object.entries(table)) {
      const params = matchRoute(pattern, path);
      if (params) {
        if (pattern === activePattern) return;
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
}
