---
name: railroad
description: "Railroad — reactive UI for the Bun fullstack runtime. Signals, JSX, hash router, DI, logger. Use when writing JSX with signals, when()/list()/routes(), or any import from @blueshed/railroad. Pair with @blueshed/delta for WebSocket document sync."
---

Railroad is the reactive layer that fits the Bun 1.3 fullstack pipeline. **For scaffolding routes, server entries, or `Bun.WebView` test files, invoke the `bun-route` skill** — it auto-detects `@blueshed/railroad` in `package.json` and uses tsx-railroad mode. This skill covers what's railroad-specific: how the reactive primitives behave and the gotchas that bite in JSX.

Source files (each has a JSDoc header — read for full API): `signals.ts` · `jsx.ts` · `routes.ts` · `shared.ts` · `logger.ts`

## What railroad gives you on top of Bun

Bun 1.3 already ships HTML imports, HMR, TSX bundling, `--compile`, and `Bun.WebView`. Railroad adds:

- **Signals** — push-based reactive primitives (Vue/Solid/Preact family; not TC39).
- **JSX runtime** — components run once, return real DOM nodes, signals bind to text and attributes automatically.
- **`when()` / `list()`** — reactive conditionals and keyed lists with auto-disposal.
- **Hash router** — `routes(target, table)`, `route()` for sub-navigation, reactive `params$` so `/users/1` → `/users/2` updates without remounting.
- **DI / logger** — typed `provide`/`inject` with phantom-typed keys; leveled console output.
- **Realtime escape hatches** — `.touch()`, `.mutate()`, `.patch()` for in-place document mutation under WebSocket / CRDT / `LISTEN/NOTIFY` patch streams.

## The five things that bite if you're not careful

### 1. Do NOT call `.get()` in JSX children

```tsx
// ❌ Reads once, never updates
<span>{count.get()}</span>

// ✅ Bare signal — auto-reactive text node
<span>{count}</span>

// ✅ Function child — auto-tracks reads
<span>{() => count.get() > 5 ? "High" : "Low"}</span>

// ✅ .map() for derived attrs / list content
<input disabled={count.map(n => n > 10)} />
{list(todos, t => t.id, (todo$) => <li>{todo$.map(t => t.text)}</li>)}
```

#1 bug. `{count}` puts the Signal *itself* into JSX, where the runtime registers a reactive text node. `{count.get()}` puts a plain number in, never reactive again.

### 2. `list()` keyed render gets `Signal<T>`, not `T`

```tsx
// ❌ Destructuring the signal turns it into a plain value (no reactivity)
{list(rows, r => r.id, ({ text }) => <li>{text}</li>)}

// ✅ Use .map() to derive reactive content
{list(rows, r => r.id, (row$) => <li>{row$.map(r => r.text)}</li>)}

// ✅ .peek() for one-shot reads (key/attribute that won't change)
{list(rows, r => r.id, (row$) => <li data-id={row$.peek().id}>{row$.map(r => r.text)}</li>)}
```

Index-based form (no keyFn) gets raw values and recreates the row on change — fine for static lists, wasteful for editable ones.

### 3. SVG works — but only when `<svg>` is the JSX outer wrapper

```tsx
// ✅ list() / when() inside <svg> auto-adopt children to SVG namespace
<svg>
  {list(shapes, s => s.id, (s$) => <circle r={s$.map(s => s.r)} />)}
</svg>

// ❌ <circle> created outside an <svg> ancestor stays in HTML namespace, won't render
function Circle() { return <circle r="10" />; }
```

If you must build SVG by hand, use `document.createElementNS("http://www.w3.org/2000/svg", "circle")` — railroad passes those through unchanged.

### 4. Effects auto-dispose **only** inside a parent scope

```tsx
// ✅ Inside a component / route / when / list — auto-disposed on teardown
function Counter() {
  const c = signal(0);
  effect(() => console.log(c.get()));
  return <span>{c}</span>;
}

// ❌ Module top-level — never disposed (leaks until process exit)
const c = signal(0);
effect(() => console.log(c.get()));
```

Dispose scopes are pushed by `createElement(Component)`, `routes()`, `route()`, `when()`, and `list()`. If you create an effect outside any of those, capture the dispose function returned by `effect(...)` and call it manually.

### 5. Use the realtime escape hatches for large documents

Railroad is push-based and synchronous — `set()` notifies subscribers immediately. For large objects mutated by patch streams, don't `set()` a fresh clone every time:

```tsx
// ❌ Wasteful — clones whole document on every patch
ws.onmessage = (ev) => {
  doc.set({ ...doc.peek(), ...applyPatch(doc.peek(), JSON.parse(ev.data)) });
};

// ✅ Mutate in place, then touch() to notify without replacing the ref
ws.onmessage = (ev) => {
  applyPatch(doc.peek(), JSON.parse(ev.data));
  doc.touch();
};

// .mutate(fn) is the safer middle ground: structuredClone, mutate, notify
doc.mutate(d => { d.items.push(newRow); });

// .patch(partial) is shallow-merge for object signals
filter.patch({ color: "blue" });
```

`.touch()` propagates to effects and primitive-returning computeds. A computed that returns the same reference (`computed(() => doc.get().items)`) bails via its own `equals` guard — by design.

## Mental model

Components run **once**. They return real DOM nodes. No virtual DOM, no reconciler, no diffing. Reactivity comes from signals — bare signals as children become reactive text nodes; signals as props become reactive attributes; function children auto-track signal reads.

Effects and computeds auto-dispose when their parent scope (component, route, `when`, `list`) tears down.

## Routes — wildcard layouts

```tsx
routes(app, {
  "/":          () => <Home />,
  "/sites/*":   () => <SitesLayout />,    // wildcard keeps layout mounted
});

function SitesLayout() {
  const detail = route<{ id: string }>("/sites/:id");
  return (
    <div>
      <SitesNav />
      {when(detail, () => <SiteDetail />, () => <SitesList />)}
    </div>
  );
}
```

`/sites` → `/sites/42` → `/sites/99`: layout stays mounted, only inner content swaps. `params$` updates without remounting; `route()` is a `ReadonlySignal<T | null>`.

In tests: `hashchange` is dispatched on the next macrotask in both happy-dom and real browsers. After `navigate(...)`, `await new Promise(r => setTimeout(r, 0))`.

## Realtime — pair with `@blueshed/delta`

For WebSocket document sync over JSON-Patch use [`@blueshed/delta`](https://www.npmjs.com/package/@blueshed/delta). Delta declares `@blueshed/railroad` as a peer dependency and `delta/client.ts` imports `signal` directly — `openDoc("name")` returns a `Doc<T>` whose `data` field **is a railroad `Signal<T | null>`**, not a wrapper. It drops straight into JSX / `when()` / `list()` with no glue.

Three backends: JSON file, SQLite (temporal), Postgres (RLS + LISTEN/NOTIFY).

### Server — one Bun.serve hosting both the HTML route and the WebSocket

```tsx
import home from "./index.html";
import { createWs, registerDoc } from "@blueshed/delta/server";

const ws = createWs();
await registerDoc(ws, "board:1", {
  file: "./board.json",
  empty: { columns: {}, cards: {} },
});

Bun.serve({
  routes: { "/": home, [ws.path]: ws.upgrade },
  websocket: ws.websocket,
  development: { hmr: true, console: true },
});
```

### Client — `list(doc.data.map(...), keyFn, render)` is the keyed-list pattern

`doc.data` is a railroad signal. To render a collection from it, **use `list()`** with a `.map()` projection — not `applyOpsToCollection` from `@blueshed/delta/dom-ops`. List's keyed form already does the surgical per-row update that `applyOpsToCollection` exists to provide for vanilla DOM, so they overlap. With railroad in the project, `list()` wins:

```tsx
import { provide, list, when } from "@blueshed/railroad";
import { connectWs, WS, openDoc } from "@blueshed/delta/client";

provide(WS, connectWs("/ws"));

interface Card { id: number; title: string; column_id: number; }
interface BoardDoc { columns: Record<string, Column>; cards: Record<string, Card>; }

const doc = openDoc<BoardDoc>("board:1");

function Board() {
  // doc.data is Signal<BoardDoc | null>. .map() derives a ReadonlySignal<Card[]>
  // that re-emits whenever the doc updates. list() then preserves DOM identity
  // per card.id — only the changed row's signal updates, not the whole list.
  const cards = doc.data.map((d) => d ? Object.values(d.cards) : []);
  return (
    <div>
      {when(doc.data, () => (
        <ul>
          {list(cards, (c) => c.id, (card$) => (
            <li>{card$.map((c) => c.title)}</li>
          ))}
        </ul>
      ), () => <p>loading…</p>)}
    </div>
  );
}

// Sending an op — single verb, single path, signal updates automatically
await doc.send([{ op: "add", path: "/cards/-",
  value: { column_id: 1, title: "new card", position: 0 } }]);
```

### When NOT to use `applyOpsToCollection`

`@blueshed/delta/dom-ops` exists for projects that don't have a keyed reactive list primitive (e.g. vanilla DOM clients). Railroad's `list(..., keyFn, ...)` provides the same per-row identity preservation natively. Don't import both; pick one:

| Project shape | Use |
|---|---|
| Vanilla DOM (no railroad) | `applyOpsToCollection(parent, "coll", ops, { create, update })` from `@blueshed/delta/dom-ops` |
| Railroad in deps | `list(doc.data.map(d => Object.values(d.coll)), r => r.id, (r$) => …)` |

The `delta-doc` skill (installed with `@blueshed/delta`) has the full API surface, the three-backend graduation table, and the canonical recipe for non-railroad projects.

## Anti-patterns

1. **No React.** No `useState`, `useEffect`, hooks, lifecycle methods, class components, or `react`/`react-dom` imports. Railroad is its own JSX runtime via `jsxImportSource`.
2. **No external bundler.** Don't add Vite, esbuild config, or webpack. Bun's HTML imports + `bun build` cover the entire pipeline. For project setup, use the `bun-route` skill.
3. **No `.get()` in JSX children.** See section 1.
4. **No shared DOM nodes across `when()` branches.** Each branch creates fresh nodes.
5. **No effects at module top-level** unless you manually capture and dispose. See section 4.
6. **No `transition-all` in CSS** near layout boundaries — use specific properties.
