# Railroad — Skill for Claude

Micro reactive UI framework for Bun. ~900 lines, zero dependencies, real DOM.

**Source files are the canonical reference.** Each has a JSDoc header with full API docs. Read the source when you need detail:
- `signals.ts` — signal, computed, effect, batch, dispose scopes
- `jsx.ts` — createElement, Fragment, text, when, list, SVG adoption
- `routes.ts` — routes, route, navigate, matchRoute
- `shared.ts` — key, provide, inject, tryInject
- `logger.ts` — createLogger, setLogLevel, loggedRequest

## Setup

```json
// tsconfig.json — automatic runtime (recommended)
{ "jsx": "react-jsx", "jsxImportSource": "@blueshed/railroad" }
```

```ts
// server.ts
import home from "./index.html";
Bun.serve({ routes: { "/": home } });
```

## API Quick Reference

### Signals (`signals.ts`)

```ts
signal<T>(value): Signal<T>           // mutable reactive value
computed<T>(fn): Signal<T>            // derived, auto-tracked, auto-disposed in scope
effect(fn): Dispose                   // side-effect, returns dispose function
batch(fn): void                       // group writes, flush once
```

Signal methods: `.get()` `.set(v)` `.update(fn)` `.mutate(fn)` `.patch(partial)` `.peek()`

Dispose scopes: `pushDisposeScope()` `popDisposeScope(): Dispose` `trackDispose(fn)`

### JSX (`jsx.ts`)

Components are functions called **once**. Reactivity comes from signals, not re-rendering.

```ts
createElement(tag, props, ...children): Node
Fragment(props): DocumentFragment
text(fn): Node                        // reactive computed text node
when(condition, truthy, falsy?): Node // conditional swap on truthiness transition
list(items, keyFn, render): Node      // keyed list, render gets Signal<T>, Signal<number>
list(items, render): Node             // index-based list, render gets raw T
```

Props: `class`/`className`, `style` (object or Signal), `value`/`checked`/`disabled`/`selected`/`src`/`srcdoc` (as DOM properties), `innerHTML`, `ref(el)`, `on*` events. All support Signal values for reactivity.

SVG: `<svg>` children are auto-adopted into SVG namespace.

### Routes (`routes.ts`)

```ts
routes(target, table): Dispose        // hash router, auto-disposes on swap
route<T>(pattern): Signal<T | null>   // reactive route match
navigate(path): void                  // set location.hash
matchRoute(pattern, path): params | null
```

Handlers receive `(params, params$)` — plain object + Signal. Destructure the first, watch the second for same-pattern param changes (e.g. `/users/1` → `/users/2`).

### Shared (`shared.ts`)

```ts
key<T>(name): Key<T>                 // typed symbol key
provide<T>(key, value): void         // register value
inject<T>(key): T                    // retrieve value (throws if missing)
tryInject<T>(key): T | undefined     // retrieve value (returns undefined if missing)
```

### Logger (`logger.ts`)

```ts
createLogger(tag): { info, warn, error, debug }
setLogLevel(level): void             // "error" | "warn" | "info" | "debug"
loggedRequest(tag, handler): Handler // wrap route handler with access logging
```

## Anti-Patterns

1. **No React.** No useState, useEffect, hooks, lifecycle methods, memo, or react imports.
2. **No `.get()` in JSX children.** `<p>{count}</p>` is reactive. `<p>{count.get()}</p>` is static.
3. **No `text()` for attributes.** `text()` creates a DOM node. Use `computed()` for reactive attributes.
4. **No JSX in effects without dispose scopes.** Any effect that rebuilds DOM must use `pushDisposeScope`/`popDisposeScope` and return a cleanup function. See `jsx.ts` source for the pattern.
5. **No `transition-all` in CSS** near layout boundaries. Use specific properties.
6. **No bare nested `when()`.** `when()` returns a fragment — nesting fragments inside another `when()` breaks dispose scope tracking. Always wrap an inner `when()` in a real element: `<div>{when(...)}</div>`.
7. **No shared DOM nodes across `when()` branches.** Nodes must be created fresh inside each branch function. A node created outside and reused across branches will be torn out of the DOM when the other branch activates.
8. **Guard against null inside `when()` branches.** Signal cascade order is not guaranteed — an inner `when()` can fire before the outer `when()` swaps it away. Always null-check even inside a branch that "shouldn't" be reached (e.g. `text(() => item.get()?.name ?? "")`).
