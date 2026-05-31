# Railroad

Reactive UI for the Bun fullstack runtime. Signals, JSX, and a hash router that lean directly into Bun 1.3's HTML imports, HMR, and `Bun.build --compile`. Pair with [`@blueshed/delta`](https://www.npmjs.com/package/@blueshed/delta) for WebSocket document sync.

Zero runtime dependencies. Real DOM. ~1KLOC. Designed so an LLM (or you, six months from now) can use it correctly without re-reading documentation.

## Why Bun + Railroad is the sweet spot

Bun 1.3 ships the parts that frontend stacks normally need three packages and a config file to assemble:

- **HTML imports in `Bun.serve`** ([1.2+](https://bun.com/blog/bun-v1.2)) — server reads `import index from "./index.html"`, walks `<script>` and `<link>` tags, transpiles TSX/JSX, bundles imports, processes CSS, hashes asset URLs. No `vite.config.ts`. No build step in development.
- **First-class JSX/TSX** — `jsxImportSource: "@blueshed/railroad"` in `tsconfig.json` is the entire setup. Bun's transpiler and bundler both honour it; railroad ships matching `jsx-runtime` and `jsx-dev-runtime` modules so dev mode (`jsxDEV`) works too.
- **HMR** ([1.3+](https://bun.com/blog/bun-v1.3)) — `Bun.serve({ development: { hmr: true } })` gives you `import.meta.hot` modelled on Vite's, including console mirroring (`development: { console: true }`).
- **`bun build --compile`** ([1.3+](https://bun.com/blog/bun-v1.3)) — compile the entire HTML+TSX+server graph into a single static binary you can scp to a server. No Node, no install, no Docker layer.
- **`Bun.WebView`** ([1.3.12+](https://bun.com/blog/bun-v1.3.12)) — real headless browser tests in the same `bun test` you already run for unit tests. WKWebView on macOS, Chrome via CDP elsewhere. Railroad uses it.

Railroad fills exactly the slot Bun leaves open: a small, push-based reactive layer that binds signals to real DOM. No virtual DOM, no compiler, no SSR layer Bun doesn't have anyway. You get reactivity, JSX, and a router; you keep Bun's pipeline.

## Install

```sh
bun add @blueshed/railroad
```

## A working app, end to end

```json
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@blueshed/railroad",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "moduleResolution": "bundler",
    "strict": true
  }
}
```

```html
<!-- index.html -->
<!DOCTYPE html>
<html>
  <body>
    <div id="root"></div>
    <script type="module" src="./app.tsx"></script>
  </body>
</html>
```

```tsx
// app.tsx
import { signal, routes } from "@blueshed/railroad";

const count = signal(0);

function Home() {
  return (
    <div>
      <h1>Hello World</h1>
      <button onclick={() => count.update(n => n + 1)}>
        Count: {count}
      </button>
    </div>
  );
}

routes(document.getElementById("root")!, {
  "/": () => <Home />,
});
```

```ts
// server.ts
import home from "./index.html";

Bun.serve({
  routes: { "/": home },
  development: { hmr: true, console: true },
});
```

```sh
bun server.ts                          # dev with HMR
bun build ./index.html --production    # production assets
bun build --compile server.ts          # one-binary deploy
```

That's the whole stack. No Vite, no webpack, no Rollup config, no `tsx-loader`, no `@vitejs/plugin-react`. The HMR works, the TSX compiles, sourcemaps are emitted, CSS bundles, and asset URLs are content-hashed — out of the box.

## Signals

```ts
import { signal, computed, effect, batch, untrack } from "@blueshed/railroad";

const count = signal(0);
const doubled = computed(() => count.get() * 2);     // ReadonlySignal — no .set
const label = count.map(n => `Count: ${n}`);         // also ReadonlySignal

effect(() => console.log(count.get()));              // runs on count change

count.set(1);
count.update(n => n + 1);
count.peek();                                         // read without tracking
untrack(() => count.get());                           // same, function form

// In-place mutation helpers — the realtime story
const todos = signal([{ id: 1, text: "Buy milk" }]);
todos.mutate(arr => arr.push({ id: 2, text: "Walk dog" }));   // structuredClone + notify
todos.patch({ /* shallow merge for object signals */ });
todos.touch();                                                 // notify without replacing the ref

// Custom equality — suppress notifications when contents match
const filter = signal({ x: 1, y: 2 }, {
  equals: (a, b) => a.x === b.x && a.y === b.y,
});

batch(() => { count.set(10); count.set(20); });      // effect runs once
```

## JSX

Components run **once** and return real DOM nodes. Reactivity is in the signals, not in re-rendering.

```tsx
const name = signal("World");
function Greeting() {
  return <h1>Hello {name}</h1>;       // bare signal as child — auto-reactive
}

<span>{() => count.get() > 5 ? "High" : "Low"}</span>      // function child auto-tracks
<input value={name} />                                      // signal as prop
<div class={visible.map(v => v ? "show" : "hide")} />       // .map() for derived attrs
```

### `when(condition, truthy, falsy?)`

```tsx
{when(loggedIn, () => <Dashboard />, () => <Login />)}
```

### `list(items, keyFn?, render)` — keyed reactive list

```tsx
{list(todos, t => t.id, (todo$, idx$) => (
  <li class={idx$.map(i => i % 2 ? "odd" : "even")}>
    {todo$.map(t => t.text)}
  </li>
))}
```

SVG works transparently — `<svg><circle /></svg>` adopts children into the SVG namespace, including inside `when()` and `list()`.

## Routes

Hash-based client router. Handlers receive `(params, params$)` — the second is a reactive `ReadonlySignal` that updates when params change within the same pattern (`/users/1` → `/users/2` does not re-render).

```tsx
import { routes, navigate, route, when } from "@blueshed/railroad";

routes(app, {
  "/":          () => <Home />,
  "/users/:id": (_p, params$) => <User id={params$.map(p => p.id)} />,
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

navigate("/users/42");
```

`/sites` → `/sites/42` → `/sites/99`: `SitesLayout` stays mounted, only the inner content swaps. Navigate away from `/sites/*` and the layout tears down cleanly.

## Realtime — the actual reason this library exists

Two patterns, depending on whether the patch stream is something you control or something you delegate to `@blueshed/delta`.

### Hand-rolled patch streams — `.touch()` + `.mutate()`

For a signal holding a large document mutated in place by patches (CRDT updates, custom WebSocket protocols, SQL `LISTEN/NOTIFY` payloads), `Signal.touch()` and `.mutate()` skip the `structuredClone` cost of `.set()` on a fresh object:

```tsx
import { signal, list } from "@blueshed/railroad";

type Row = { id: number; text: string; done: boolean };
const rows = signal<Row[]>([]);

const ws = new WebSocket("/ws");
ws.onmessage = (ev) => {
  applyPatch(rows.peek(), JSON.parse(ev.data));   // mutate the existing array
  rows.touch();                                    // notify without cloning
};

function App() {
  return (
    <ul>
      {list(rows, r => r.id, (row$) => (
        <li>
          <input type="checkbox" checked={row$.map(r => r.done)} />
          {row$.map(r => r.text)}
        </li>
      ))}
    </ul>
  );
}
```

### Delta-doc — turnkey JSON-Patch sync, signal-backed

For a turnkey WebSocket sync layer use [`@blueshed/delta`](https://www.npmjs.com/package/@blueshed/delta). Delta declares railroad as a peer dependency and `delta/client.ts` imports `signal` directly — `openDoc("name")` returns a `Doc<T>` whose `data` field **is** a railroad `Signal<T | null>`, not a wrapper. It drops straight into JSX, `when()`, and `list()` with no glue. Three backends: JSON file, SQLite (temporal), Postgres (RLS + LISTEN/NOTIFY).

```tsx
// Server — same Bun.serve hosting your JSX routes
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

```tsx
// Client — list() reads doc.data directly, preserving per-row identity
import { provide, list, when } from "@blueshed/railroad";
import { connectWs, WS, openDoc } from "@blueshed/delta/client";

provide(WS, connectWs("/ws"));

interface Card { id: number; title: string; column_id: number }
interface BoardDoc { columns: Record<string, Column>; cards: Record<string, Card> }

const doc = openDoc<BoardDoc>("board:1");

function Board() {
  const cards = doc.data.map((d) => d ? Object.values(d.cards) : []);
  return when(doc.data, () => (
    <ul>
      {list(cards, c => c.id, (card$) => (
        <li>{card$.map(c => c.title)}</li>
      ))}
    </ul>
  ), () => <p>loading…</p>);
}

await doc.send([{ op: "add", path: "/cards/-",
  value: { column_id: 1, title: "new card", position: 0 } }]);
```

**One important steering note:** delta also ships `applyOpsToCollection` (in `@blueshed/delta/dom-ops`) for projects without a keyed reactive list primitive. **If you have railroad, use `list()` instead** — the keyed form already does the per-row surgical update that `applyOpsToCollection` exists to provide. They overlap; pick one per project. Use `list(doc.data.map(d => Object.values(d.coll)), r => r.id, ...)` and keep the realtime story in one idiom.

## Testing — `bun test` does both halves

Unit tests run against happy-dom (preloaded via `bunfig.toml`) for fast reactivity assertions. Integration tests use **`Bun.WebView`** (1.3.12+) to drive a real headless browser against your actual `Bun.serve` instance:

```ts
import { test, expect } from "bun:test";
import { startServer } from "./server";

test("counter increments", async () => {
  const { server } = await startServer({ port: 0 });
  await using view = new Bun.WebView({ width: 800, height: 600 });
  await view.navigate(server.url.href);
  await view.click("[data-testid=inc]");
  expect(await view.evaluate<string>("document.querySelector('#count').textContent")).toBe("1");
  server.stop(true);
});
```

Same `bun test` runner. No Playwright install. No browser binary download on macOS (uses system WKWebView). Railroad's own suite is 112 tests across happy-dom and WebView.

## Shared (DI) and Logger

```ts
import { key, provide, inject } from "@blueshed/railroad";
const STORE = key<AppStore>("store");
provide(STORE, createStore());
const store = inject(STORE);

import { createLogger, setLogLevel } from "@blueshed/railroad";
const log = createLogger("[server]");
log.info("listening");                    // gated by LOG_LEVEL in .env
```

## Progressive adoption

Each module is independent — pick the level you need:

```
signals     no deps        Use anywhere: server, CLI, worker, tests
shared      no deps        Typed DI without prop threading
logger      no deps        Bun-friendly leveled console output
jsx         signals        Reactive real-DOM rendering
routes      signals        Hash router with reactive params
```

```ts
// Just signals (no JSX, no tsconfig changes)
import { signal, computed, effect } from "@blueshed/railroad/signals";
```

## Claude Code

Ships with a Claude Code skill at `.claude/skills/railroad/SKILL.md`. It's a checklist of the failure modes that have actually shown up in development — not a tutorial. Copy it in:

```sh
cp -r node_modules/@blueshed/railroad/.claude/skills/railroad .claude/skills/
# or user-wide:
cp -r node_modules/@blueshed/railroad/.claude/skills/railroad ~/.claude/skills/
```

## What it isn't

- Not a TC39 Signals implementation. It's push-based, in the same family as Vue's `ref`, Solid's `createSignal`, Preact's signals.
- Not an SSR / RSC framework. Bun doesn't ship those either; railroad doesn't add them on top.
- Not a 30KB framework with a hooks system, lifecycle methods, or a virtual DOM.

## Sharp edges to know

- **Propagation is eager, not glitch-free.** In a diamond (`a → b`, `a → c`, an effect reads both), a write to `a` runs the effect twice and its first run can observe a half-updated state (`b` new, `c` stale). Fine for binding signals to DOM; for multi-write transactions wrap them in `batch()` so subscribers see one consistent flush.
- **Routes match in declaration order.** The first pattern that matches wins — declare `/users/new` before `/users/:id`.
- **`provide`/`inject` is a process-global singleton.** Great for client apps and app-wide services; on the server it is shared across all requests, so don't use it for per-request state.
- **`.mutate()` uses `structuredClone`** — it only works on plain-data signals (no functions, class instances, or DOM nodes in the value).

It's the smallest correct reactive layer for the workflow Bun 1.3 actually ships: HTML imports, TSX bundling, HMR, and `--compile` to a single binary. That's the niche, and it's a real one.

## License

MIT
