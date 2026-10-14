---
name: railroad
metadata:
  version: 0.16.2
description: "Railroad — reactive UI for the Bun fullstack runtime. Signals, JSX, hash router, DI, logger. Use when writing JSX with signals, when()/list()/routes(), or any import from @blueshed/railroad. Pair with @blueshed/delta for WebSocket document sync."
---

# railroad

Signals bound to real DOM. A component runs **once** and returns real nodes; what changes later is a Signal or a function you bound in the JSX, never a re-render. No virtual DOM, no compiler, no hooks.

The contract is each source file's JSDoc header and its types: `signals.ts`, `jsx.ts` (props typed under "Intrinsic element props"), `routes.ts`, `shared.ts`, `logger.ts`. Where this skill and a header disagree, the header wins.

## Order of work

1. Set up: tsconfig, an HTML route, `mount()` or `routes()`. Pages, server entries and `Bun.WebView` tests: the `bun-route` skill.
2. State as signals; derive with `.map()` or `computed()`.
3. Components bind signals in JSX; `when()` and `list()` for what appears and repeats.
4. Pages with `routes()`.
5. Server data: `@blueshed/delta`, or your own patch stream.
6. Prove it with tests.

## What bites

1. No `.get()` in JSX or a render body (component, `when()` branch, `list()` row, route handler, `mount()`'s render): it reads once and subscribes nothing. Bind `{count}` or `{() => …}`; `.peek()` for a deliberate one-shot. → jsx
2. A function child returns text, not a Node: `when()` for an element, `list()` for many. → jsx
3. Keyed `list()` rows are `Signal<T>`: `row$.map(…)`, never destructure. Keys unique and stable. → when-list
4. An array that changes needs `list()`; a plain `.map()` is for a static array. → when-list
5. `when()` rebuilds only when truthiness flips: read the value through `v$`. A route handler runs once per pattern: read `params$`, or mark it `keyed: true`. → when-list, routes
6. Effects, `when()` and `list()` are disposed only inside a scope (component, route handler, branch, row, `mount()`). Each effect run owns what its body makes, so what must outlive a run is made outside it. An event handler is not a scope. → scopes
7. Handlers are lowercase functions: `onclick={() => …}`, never `onClick`, a call, or a Signal. `oninput` per keystroke; `onchange` on commit. → jsx
8. Async components and async route handlers resolve to a thunk: `return () => <div/>`. `effect(async …)` is an error. → async
9. Large documents: mutate in place, then `.touch()`; a keyed `list()` over rows changed in place needs `{ equals: () => false }`. → realtime
10. Routes match in declaration order, on segments only: no query strings, a trailing slash is a segment. → routes
11. One copy of railroad per page, or signals silently stop crossing. → [one-copy](reference/one-copy.md)

## Invariants

- No React: no hooks, lifecycle methods, classes, or `react` imports. Railroad is its own JSX runtime, chosen by `jsxImportSource`.
- No external bundler: Bun's HTML imports and `bun build` are the pipeline.
- No global `JSX`: `import type { JSX } from "@blueshed/railroad"`.
- Warnings are development-only (a production build drops them); throws are not.
- `doc.data` from delta is read-only: change a document with `doc.send(ops)`.

## Which file for which job

- [setup](reference/setup.md): new project, tsconfig, JSX types, builds, subpath imports
- [signals](reference/signals.md): `signal`, `computed`, `effect`, `batch`, `touch`, scheduling
- [scopes](reference/scopes.md): what is disposed when; custom roots
- [jsx](reference/jsx.md): components, props, handlers, SVG
- [async](reference/async.md): async components and route handlers
- [when-list](reference/when-list.md): conditional and keyed rendering
- [routes](reference/routes.md): `routes`, `route`, `navigate`, keyed and wildcard routes, `onError`
- [realtime](reference/realtime.md): patch streams and `@blueshed/delta`
- [testing](reference/testing.md): unit tests on happy-dom
- [shared-logger](reference/shared-logger.md): `provide`/`inject`, the logger
- [one-copy](reference/one-copy.md): a linked checkout breaks reactivity
