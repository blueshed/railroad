# Railroad — Skill for Claude

You are helping a developer build a UI with `@blueshed/railroad`, a micro reactive framework for Bun.

## What Railroad Is

- ~400 lines. Zero dependencies. Real DOM — no virtual DOM, no compiler, no build step.
- Designed for Bun. TypeScript source files are the distribution (no transpile step).
- Four concerns: **signals** (state), **JSX** (DOM), **routes** (navigation), **shared** (dependency injection).

## When to Use This Skill

Use railroad when the developer has it installed (`@blueshed/railroad` in package.json) or asks to build a UI with signals and JSX for Bun. Do NOT mix railroad with React, Preact, Solid, or any other framework — they are incompatible.

## Critical Setup

### Automatic runtime (recommended)

No JSX imports needed — the compiler inserts them automatically.

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@blueshed/railroad"
  }
}
```

### Classic runtime

If the project uses explicit imports, every `.tsx` file that uses JSX **must** import `createElement` (and `Fragment` if using `<>...</>`):

```json
{
  "compilerOptions": {
    "jsx": "react",
    "jsxFactory": "createElement",
    "jsxFragmentFactory": "Fragment"
  }
}
```

Check the project's `tsconfig.json` to see which mode is in use. Prefer the automatic runtime for new projects.

A minimal Bun server to serve the app:

```ts
import home from "./index.html";
Bun.serve({ routes: { "/": home } });
```

## How to Import

```ts
// Everything from one place:
import { createElement, Fragment, signal, computed, effect, batch, text, when, list, routes, navigate, key, provide, inject } from "@blueshed/railroad";

// Or by concern:
import { signal, computed, effect, batch } from "@blueshed/railroad/signals";
import { createElement, Fragment, text, when, list } from "@blueshed/railroad/jsx";
import { routes, navigate, route, matchRoute } from "@blueshed/railroad/routes";
import { key, provide, inject } from "@blueshed/railroad/shared";
```

## Reference Docs

Detailed usage for each concern is in the sibling files. Read them before generating railroad code:

- `signals.md` — reactive state: signal, computed, effect, batch, dispose, mutate, patch
- `jsx.md` — DOM creation: createElement, Fragment, text, when, list, props, events, refs
- `routes.md` — hash-based client router: routes, navigate, route, matchRoute
- `shared.md` — typed dependency injection: key, provide, inject

## Anti-Patterns — Do NOT Do These

1. **No React patterns.** There is no `useState`, `useEffect`, `useRef`, `useCallback`, `useMemo`, or any hooks. There are no lifecycle methods. There is no `React.memo`. Do not import from `react`.
2. **No virtual DOM.** `createElement` produces real DOM nodes. There is no reconciler, no diffing (except in `list()`), no re-rendering of component trees.
3. **Components run once.** A component function is called once and returns a DOM node. Reactivity comes from signals, not from re-calling the component.
4. **No JSX without setup.** In classic mode, every `.tsx` file needs `import { createElement } from "@blueshed/railroad"`. In automatic mode (`react-jsx` + `jsxImportSource`), no import is needed — the compiler handles it. Check tsconfig to know which mode.
5. **Do not call `.get()` in JSX children.** Pass the signal directly: `<p>{count}</p>`, not `<p>{count.get()}</p>`. The latter creates a static text node that never updates.
6. **Do not use `text()` for attributes.** `text()` creates a DOM text node — use `computed()` for reactive attribute values: `class={computed(() => active.get() ? "on" : "off")}`.
7. **Do not create signals inside components** unless you want fresh state on every mount. Module-level signals are shared state; component-level signals are local/ephemeral.
8. **Do not forget `batch()`** when setting multiple signals that feed the same effect — without it, the effect runs once per set.
9. **Do not rebuild JSX in effects without dispose scopes.** Any effect that does `container.innerHTML = ""; container.appendChild(<JSX/>)` **must** use the full dispose scope pattern — see `jsx.md` Dispose Scopes section. Both the re-run cleanup (`if (childDispose) childDispose()` at top) AND the effect cleanup return (`return () => { ... }`) are required. Without the return, child effects leak when the parent is torn down.
10. **Do not use `transition-all` in CSS** for elements near layout boundaries (cards, panels). Use specific properties like `transition-colors` or `transition-[width,border-color]` to avoid animating layout properties unintentionally.
