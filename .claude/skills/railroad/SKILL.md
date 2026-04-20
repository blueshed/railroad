---
name: railroad
description: "Railroad — client-side reactivity for Bun (signals, JSX, routes) plus a typed DI container and logger that also run server-side. Use when writing JSX with signals, routes, when(), list(), or importing @blueshed/railroad. Pair with @blueshed/delta for document sync."
---

Client-side reactivity for Bun — signals, JSX, routes — plus a typed DI container and a logger that work on both sides. Zero dependencies, real DOM, no build step. For document-sync / WebSocket / relational-backend work, use [`@blueshed/delta`](https://www.npmjs.com/package/@blueshed/delta); its client is built on railroad's signals.

**Read the source files for full API detail** — each has a JSDoc header:
`signals.ts` · `jsx.ts` · `routes.ts` · `shared.ts` · `logger.ts`

## Setup

```json
// tsconfig.json
{ "jsx": "react-jsx", "jsxImportSource": "@blueshed/railroad" }
```

## Mental Model

Components run **once**. They return real DOM nodes. Reactivity comes from signals — not re-rendering. Effects and computeds auto-dispose when their parent scope (component, route, `when`, `list`) tears down.

```tsx
// Bare signal — auto-reactive
<span>{count}</span>

// Function child — auto-reactive expression
<span>{() => count.get() > 5 ? "High" : "Low"}</span>

// Signal.map() — derive a signal for attributes and list items
<input disabled={count.map(n => n > 10)} />
{list(todos, t => t.id, (todo$) => <li>{todo$.map(t => t.name)}</li>)}
```

## Key Patterns

```tsx
// Reactive attributes — .map() or computed()
<div class={visible.map(v => v ? "show" : "hide")}>...</div>

// Keyed list — render gets Signal<T>, use .map() for content
{list(todos, t => t.id, (todo$, idx$) => (
  <li class={idx$.map(i => i % 2 ? "odd" : "even")}>
    {todo$.map(t => t.name)}
  </li>
))}

// Nested routes — wildcard keeps layout mounted, route() for sub-navigation
routes(app, { "/sites/*": () => <SitesLayout /> });
function SitesLayout() {
  const detail = route<{ id: string }>("/sites/:id");
  return when(() => detail.get(), () => <SiteDetail />, () => <SitesList />);
}
```

## Doc sync — use @blueshed/delta

Real-time document sync lives in the sibling package [`@blueshed/delta`](https://www.npmjs.com/package/@blueshed/delta) — the delta client bundles railroad's signals automatically, so `openDoc("name")` returns a signal-backed Doc that works inside JSX / `when()` / `list()` the same way any other signal does. Three backends: JSON file (simplest), SQLite (temporal), Postgres (RLS + LISTEN/NOTIFY). The `delta-doc` skill at `.claude/skills/delta-doc/` (installed with `@blueshed/delta`) has the full API.

```tsx
// Server — in the same Bun.serve that hosts your JSX routes
import { createWs, registerDoc } from "@blueshed/delta/server";
const ws = createWs();
await registerDoc(ws, "message", { file: "./data/message.json", empty: { message: "" } });
Bun.serve({ routes: { "/ws": ws.upgrade }, websocket: ws.websocket });

// Client — reactive signal, drops straight into JSX
import { provide } from "@blueshed/railroad";
import { connectWs, WS, openDoc } from "@blueshed/delta/client";
provide(WS, connectWs("/ws"));
const doc = openDoc<Message>("message");
// {() => doc.data.get()?.message}   ← auto-reactive
```

## Anti-Patterns

1. **No React.** No useState, useEffect, hooks, lifecycle methods, or react imports.
2. **No `.get()` in JSX children.** `{count}` or `{() => count.get() + 1}` — never `{count.get()}`.
3. **No shared DOM nodes across `when()` branches.** Create nodes fresh inside each branch.
4. **No `transition-all` in CSS** near layout boundaries. Use specific properties.
