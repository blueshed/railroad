# Railroad

Signals, JSX, and routes — a micro UI framework for Bun.

~900 lines. Zero dependencies. Real DOM. No virtual DOM, no compiler, no build step.

## Install

```sh
bun add @blueshed/railroad
```

## Quick Start

### Automatic runtime (recommended)

No JSX imports needed — the compiler inserts them for you.

```json
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@blueshed/railroad"
  }
}
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
        {() => `Count: ${count.get()}`}
      </button>
    </div>
  );
}

routes(document.getElementById("app")!, {
  "/": () => <Home />,
});
```

### Classic runtime

If you prefer explicit imports:

```json
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "react",
    "jsxFactory": "createElement",
    "jsxFragmentFactory": "Fragment"
  }
}
```

```tsx
// app.tsx
import { createElement, signal, routes } from "@blueshed/railroad";

const count = signal(0);

function Home() {
  return (
    <div>
      <h1>Hello World</h1>
      <button onclick={() => count.update(n => n + 1)}>
        {() => `Count: ${count.get()}`}
      </button>
    </div>
  );
}

routes(document.getElementById("app")!, {
  "/": () => <Home />,
});
```

### Server

```ts
// server.ts
import home from "./index.html";

Bun.serve({
  routes: { "/": home },
});
```

Resources and routes. Server and client. Same pattern.

## API

### Signals

```ts
import { signal, computed, effect, batch } from "@blueshed/railroad";

const count = signal(0);
const doubled = computed(() => count.get() * 2);
const label = count.map(n => `Count: ${n}`);  // derive a signal

const dispose = effect(() => {
  console.log(`count is ${count.get()}`);
});

count.set(1);        // logs "count is 1"
count.update(n => n + 1); // logs "count is 2"
count.peek();        // read without tracking

// In-place mutation (auto-clones, always notifies):
const todos = signal([{ id: 1, text: "Buy milk" }]);
todos.mutate(arr => arr.push({ id: 2, text: "Walk dog" }));

// Shallow merge for object signals:
const filter = signal({ color: "red", size: 10 });
filter.patch({ color: "blue" }); // { color: "blue", size: 10 }

batch(() => {
  count.set(10);
  count.set(20);     // effect runs once, not twice
});

dispose();           // stop listening
```

### JSX

Components are functions that run **once** and return DOM nodes. Reactivity comes from signals, not re-rendering.

```tsx
import { signal, when, list } from "@blueshed/railroad";

const name = signal("World");

function Greeting() {
  return <h1>Hello {name}</h1>;  // updates when name changes
}
```

#### Reactive expressions — function children

```tsx
<span>{() => count.get() > 5 ? "High" : "Low"}</span>
<p>{() => `${first.get()} ${last.get()}`}</p>
```

#### Reactive attributes — `computed()` or `.map()`

```tsx
<div class={visible.map(v => v ? "show" : "hide")}>...</div>
<input disabled={count.map(n => n > 10)} />
```

#### `when(condition, truthy, falsy?)` — conditional rendering

```tsx
{when(
  () => loggedIn.get(),
  () => <Dashboard />,
  () => <Login />,
)}
```

Nestable — `when()` inside `when()` works without wrapper elements.

#### `list(items, keyFn?, render)` — keyed list rendering

```tsx
// Keyed — render receives Signal<T> and Signal<number>:
{list(todos, t => t.id, (todo$, idx$) => (
  <li class={idx$.map(i => i % 2 ? "odd" : "even")}>
    {todo$.map(t => t.name)}
  </li>
))}

// Non-keyed (index-based, raw values):
{list(items, (item, i) => <li>{item}</li>)}
```

### Routes

Hash-based client router. Handlers receive `(params, params$)` — destructure the first for convenience, watch the second for reactive param changes.

```tsx
import { routes, navigate, route, when, effect } from "@blueshed/railroad";

routes(app, {
  "/":           () => <Home />,
  "/about":      () => <About />,
  "/users/:id":  ({ id }, params$) => {
    effect(() => fetchUser(params$.get().id));
    return <h1>{params$.map(p => `User ${p.id}`)}</h1>;
  },
  "*":           () => <NotFound />,
});

navigate("/users/42");
```

#### Nested routes

Use wildcard patterns to keep a layout mounted while sub-views swap:

```tsx
routes(app, {
  "/":          () => <Home />,
  "/sites/*":   () => <SitesLayout />,
});

function SitesLayout() {
  const detail = route<{ id: string }>("/sites/:id");

  return (
    <div>
      <SitesNav />
      {when(() => detail.get(),
        () => <SiteDetail params$={detail} />,
        () => <SitesList />,
      )}
    </div>
  );
}
```

Navigate `/sites` → `/sites/42` → `/sites/99`: `SitesLayout` stays mounted, only the inner content swaps. Navigate away from `/sites/*`: layout tears down cleanly.

### Shared

Typed dependency injection without prop threading.

```ts
import { key, provide, inject } from "@blueshed/railroad";

const STORE = key<AppStore>("store");
provide(STORE, createStore());

// anywhere:
const store = inject(STORE);

// Non-throwing variant:
const maybeStore = tryInject(STORE); // T | undefined
```

### Logger

Colored, timestamped, level-gated console output.
Set the level via `.env` (Bun loads it automatically):

```sh
# .env
LOG_LEVEL=debug    # debug | info | warn | error | silent
```

```ts
import { createLogger, setLogLevel, loggedRequest } from "@blueshed/railroad";

const log = createLogger("[server]");
log.info("listening on :3000");
log.debug("tick");             // only shown when level is "debug"

setLogLevel("debug");          // override at runtime

// Wrap a route handler with access logging:
const handler = loggedRequest("[api]", myHandler);
```

### Delta-Doc

Real-time document sync over WebSocket. The server holds a document; clients open it as a reactive signal and send JSON Pointer ops to mutate it.

#### JSON file backend

```ts
// server.ts
import { createWs, registerDoc, registerMethod } from "@blueshed/railroad/delta-server";

const ws = createWs();

await registerDoc(ws, "message", {
  file: "./message.json",
  empty: { message: "", items: [] },
});

registerMethod(ws, "status", () => ({ uptime: process.uptime() }));

const server = Bun.serve({
  routes: { "/": homepage, "/ws": ws.upgrade },
  websocket: ws.websocket,
});
ws.setServer(server);
```

```ts
// client.ts
import { connectWs, openDoc, call } from "@blueshed/railroad/delta-client";
import { provide } from "@blueshed/railroad";
import { WS } from "@blueshed/railroad/delta-client";

provide(WS, connectWs("/ws"));

const doc = openDoc<Message>("message");

// Reactive — updates automatically when any client changes the doc
effect(() => console.log(doc.data.get()));

// Mutate via JSON Pointer ops (RFC 6901)
doc.send([
  { op: "replace", path: "/message", value: "hello" },
  { op: "add", path: "/items/-", value: { id: 1, text: "first" } },
]);

// Stateless RPC
const status = await call<Status>("status");
```

#### SQLite relational backend

Same client API — swap the server backend from a JSON file to SQLite temporal tables.

```ts
// schema.ts
import { defineSchema, defineDoc } from "@blueshed/railroad/delta-sqlite";

const schema = defineSchema({
  projects: {
    columns: { name: "text", status: "text" },
  },
  tasks: {
    parent: { collection: "projects", fk: "project_id" },
    columns: {
      title: "text",
      done: "boolean",
      priority: "integer?",
    },
  },
  comments: {
    parent: { collection: "tasks", fk: "task_id" },
    columns: { body: "text", author: "text?" },
  },
});

const projectDoc = defineDoc("project:", {
  root: "projects",
  include: ["tasks", "comments"],
});
```

```ts
// server.ts
import { createWs, registerMethod } from "@blueshed/railroad/delta-server";
import { createTables, registerDocs } from "@blueshed/railroad/delta-sqlite";
import { Database } from "bun:sqlite";

const db = new Database("app.db", { create: true });
const ws = createWs();

createTables(db, schema);
registerDocs(ws, db, schema, [projectDoc]);

const server = Bun.serve({
  routes: { "/": homepage, "/ws": ws.upgrade },
  websocket: ws.websocket,
});
ws.setServer(server);
```

```ts
// client.ts — identical to JSON backend
const project = openDoc<ProjectDoc>("project:abc-123");

project.send([
  { op: "add", path: "/tasks/uuid-1", value: { title: "Ship it", done: false } },
  { op: "replace", path: "/tasks/uuid-1/done", value: true },
  { op: "remove", path: "/tasks/uuid-1" },
]);
```

The schema declares:

- **Tables** — columns, types (`text`, `integer`, `real`, `boolean`, `json`), nullability (`"text?"`), defaults
- **Relationships** — `parent` creates FK columns; the FK graph drives loading and cascade deletes
- **Cascade references** — `cascadeOn` triggers deletes across FK boundaries (e.g. removing a user cascades to their assignments)
- **Temporal versioning** — every row tracks `valid_from`/`valid_to` for time-travel queries. Set `temporal: false` to opt out

Documents are lenses into the schema:

- **`prefix`** — maps `openDoc("project:abc")` to the right handler
- **`root`** — the root table; its PK is the doc ID
- **`include`** — which collections to load and sync
- **`scope`** — optional row-level filter (e.g. `{ user_id: ":docId" }` for per-user docs)

Multiple doc types share one `createWs()`. The same table can appear in different docs — changes propagate to all subscribed lenses.

## Design

- **Signals hold state** — reactive primitives with automatic dependency tracking
- **Effects update the DOM** — run when dependencies change, auto-cleanup in scope
- **JSX creates the DOM** — real elements, not virtual. Signal-aware props and children
- **Routes swap the DOM** — hash-based, auto-scoped, nestable via wildcards

No lifecycle methods. No hooks rules. No context providers. No `useCallback`. Just signals and the DOM.

## Progressive Adoption

Each module is independent — use as much or as little as you need.

```
signals.ts       ← no deps         Use signals anywhere: server, CLI, worker
shared.ts        ← no deps         Add typed DI when you need shared state
logger.ts        ← no deps         Add logging to your Bun server
jsx.ts           ← signals         Add reactive DOM when you need a UI
routes.ts        ← signals         Add client-side routing when you need pages
delta.ts         ← no deps         JSON Pointer ops (shared by client + server)
delta-client.ts  ← signals, shared Real-time doc sync for the browser
delta-server.ts  ← logger          WebSocket protocol + doc/method registration
delta-sqlite.ts  ← delta-server    SQLite relational backend for delta-doc
```

**Level 1 — Reactive state only** (no DOM, no tsconfig changes)

```ts
import { signal, computed, effect } from "@blueshed/railroad/signals";
```

**Level 2 — Add JSX** (needs `tsconfig.json` JSX settings)

```ts
import { signal, createElement, when, list } from "@blueshed/railroad";
```

**Level 3 — Full app** (signals + JSX + routing + DI + logging)

```ts
import { signal, routes, inject, createLogger } from "@blueshed/railroad";
```

Every import path (`/signals`, `/shared`, `/logger`, `/jsx`, `/routes`) works standalone. The barrel export (`@blueshed/railroad`) re-exports everything.

## Claude Code

This package ships with a [Claude Code](https://claude.com/claude-code) skill in `.claude/skills/railroad/`. Copy it into your project so Claude generates correct railroad code:

```sh
cp -r node_modules/@blueshed/railroad/.claude/skills/railroad .claude/skills/
```

Or install it user-wide (available in all projects):

```sh
cp -r node_modules/@blueshed/railroad/.claude/skills/railroad ~/.claude/skills/
```

## License

MIT
