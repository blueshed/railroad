# Shared — Typed Dependency Injection

A minimal provide/inject system for sharing values across modules without prop threading. Uses typed symbol keys for safety.

## Creating a Key

```ts
import { key } from "@blueshed/railroad";

const STORE = key<AppStore>("store");
const THEME = key<Signal<string>>("theme");
const API = key<ApiClient>("api");
```

`key<T>(name)` creates a unique symbol branded with type `T`. The name is for debugging (shows in error messages).

## Providing a Value

```ts
import { provide } from "@blueshed/railroad";

provide(STORE, createStore());
provide(THEME, signal("light"));
provide(API, new ApiClient("/api"));
```

Call `provide()` during initialization, before any component calls `inject()`. Values are stored in a global registry.

## Injecting a Value

```ts
import { inject } from "@blueshed/railroad";

const store = inject(STORE);  // typed as AppStore
const theme = inject(THEME);  // typed as Signal<string>
```

If no value has been provided for the key, `inject()` throws:

```
Error: No provider for store
```

## Typical Pattern

Define keys in a shared module, provide at app init, inject anywhere:

```ts
// keys.ts — shared key definitions
import { key } from "@blueshed/railroad";
import type { Signal } from "@blueshed/railroad";

export interface AppStore {
  user: Signal<User | null>;
  todos: Signal<Todo[]>;
}

export const STORE = key<AppStore>("store");
```

```ts
// main.ts — provide at startup
import { provide, signal } from "@blueshed/railroad";
import { STORE } from "./keys";

provide(STORE, {
  user: signal(null),
  todos: signal([]),
});
```

```tsx
// any-component.tsx — inject where needed
import { createElement } from "@blueshed/railroad";
import { inject } from "@blueshed/railroad";
import { STORE } from "./keys";

function TodoList() {
  const { todos } = inject(STORE);
  return list(todos, (t) => t.id, (t) => <li>{t.text}</li>);
}
```

## When to Use Shared vs Props

- **Props** — for data that flows parent-to-child and varies per instance.
- **Shared** — for app-wide services, stores, or configuration that many components need. Avoids threading the same value through every intermediate component.

## Important Notes

- The registry is global and module-scoped. There is one registry per JavaScript realm.
- Keys are symbols, so two calls to `key("store")` produce **different** keys. Export and import a single key instance.
- `provide()` can be called again with the same key to replace the value.
- `inject()` is synchronous — the value must already be provided.
