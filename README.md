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

```ts
import { createLogger, setLogLevel, loggedRequest } from "@blueshed/railroad";

const log = createLogger("[server]");
log.info("listening on :3000");
log.debug("tick");             // only shown when level is "debug"

setLogLevel("debug");          // show everything

// Wrap a route handler with access logging:
const handler = loggedRequest("[api]", myHandler);
```

## Design

- **Signals hold state** — reactive primitives with automatic dependency tracking
- **Effects update the DOM** — run when dependencies change, auto-cleanup in scope
- **JSX creates the DOM** — real elements, not virtual. Signal-aware props and children
- **Routes swap the DOM** — hash-based, auto-scoped, nestable via wildcards

No lifecycle methods. No hooks rules. No context providers. No `useCallback`. Just signals and the DOM.

## Progressive Adoption

Each module is independent — use as much or as little as you need.

```
signals.ts  ← no deps         Use signals anywhere: server, CLI, worker
shared.ts   ← no deps         Add typed DI when you need shared state
logger.ts   ← no deps         Add logging to your Bun server
jsx.ts      ← signals         Add reactive DOM when you need a UI
routes.ts   ← signals         Add client-side routing when you need pages
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
