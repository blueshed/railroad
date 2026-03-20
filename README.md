# Railroad

Signals, JSX, and routes — a micro UI framework for Bun.

~400 lines. Zero dependencies. Real DOM. No virtual DOM, no compiler, no build step.

## Install

```sh
bun add @blueshed/railroad
```

## Quick Start

```tsx
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
        Count: {count}
      </button>
    </div>
  );
}

routes(document.getElementById("app")!, {
  "/": () => <Home />,
});
```

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

const dispose = effect(() => {
  console.log(`count is ${count.get()}`);
});

count.set(1);        // logs "count is 1"
count.update(n => n + 1); // logs "count is 2"
count.peek();        // read without tracking

batch(() => {
  count.set(10);
  count.set(20);     // effect runs once, not twice
});

dispose();           // stop listening
```

### JSX

Components are functions that return DOM nodes. Signals in children and props auto-update.

```tsx
import { createElement, text, when, list, signal } from "@blueshed/railroad";

const name = signal("World");

function Greeting() {
  return <h1>Hello {name}</h1>;  // updates when name changes
}
```

#### `text(fn)` — reactive computed text

```tsx
<span>{text(() => count.get() > 5 ? "High" : "Low")}</span>
```

#### `when(condition, truthy, falsy?)` — conditional rendering

```tsx
{when(
  () => loggedIn.get(),
  () => <Dashboard />,
  () => <Login />,
)}
```

#### `list(items, keyFn?, render)` — keyed list rendering

```tsx
{list(
  todos,
  (t) => t.id,  // optional key function
  (t, i) => <li>{t.name}</li>,
)}
```

### Routes

Hash-based client router with automatic dispose scoping.

```tsx
import { routes, navigate } from "@blueshed/railroad";

const dispose = routes(app, {
  "/":           () => <Home />,
  "/users/:id":  ({ id }) => <User id={id} />,
  "*":           () => <NotFound />,
});

navigate("/users/42");
```

### Shared

Typed dependency injection without prop threading.

```ts
import { key, provide, inject } from "@blueshed/railroad";

const STORE = key<AppStore>("store");
provide(STORE, createStore());

// anywhere:
const store = inject(STORE);
```

## Design

- **Signals hold state** — reactive primitives with automatic dependency tracking
- **Effects update the DOM** — run when dependencies change, return cleanup
- **JSX creates the DOM** — real elements, not virtual. Signal-aware props and children
- **Routes swap the DOM** — hash-based, dispose-scoped, Bun.serve-style tables

No lifecycle methods. No hooks rules. No context providers. No `useCallback`. Just signals and the DOM.

## License

MIT
