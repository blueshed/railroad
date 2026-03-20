# Routes — Hash-Based Client Router

Railroad uses hash-based routing (`#/path`). The router swaps content in a target element and automatically manages dispose scoping — when a route changes, all effects from the previous route are cleaned up.

## `routes(target, table)` — Declarative Router

The main entry point. Pass a DOM element and a route table. Returns a dispose function to stop the router.

```tsx
import { createElement, routes } from "@blueshed/railroad";

const app = document.getElementById("app")!;

const dispose = routes(app, {
  "/":            () => <Home />,
  "/users/:id":   ({ id }) => <UserDetail id={id} />,
  "/settings":    () => <Settings />,
  "*":            () => <NotFound />,
});
```

### Route Table

- Keys are URL patterns (without the `#`).
- Values are handler functions that receive matched params and return a Node.
- Patterns are matched in declaration order — first match wins.
- `*` is a catch-all, checked last.

### Pattern Syntax

- **Exact match:** `/about` matches only `#/about`
- **Params:** `/users/:id` matches `#/users/42` with `{ id: "42" }`
- **Multiple params:** `/users/:id/posts/:pid` matches `#/users/1/posts/99` with `{ id: "1", pid: "99" }`
- **Catch-all:** `*` matches anything not matched by other patterns

Segments must match exactly in count — `/users/:id` does not match `/users/42/extra`.

URI components are automatically decoded (`%20` becomes a space, etc.).

### Automatic Cleanup

When the hash changes to a new route:

1. The previous route's dispose scope is called (cleaning up all effects).
2. The target element is cleared (`replaceChildren()`).
3. A new dispose scope is pushed.
4. The new handler runs, creating DOM and effects.
5. The dispose scope is popped and stored for next cleanup.

If the hash changes but the **same pattern** matches (e.g., `/users/1` to `/users/2`), the route does **not** re-render. The component should use signals or `route()` to react to param changes.

## `navigate(path)` — Programmatic Navigation

```ts
import { navigate } from "@blueshed/railroad";

navigate("/users/42");   // sets location.hash = "/users/42"
navigate("/");           // go home
```

Use this in event handlers, after form submissions, etc. It triggers a `hashchange` event which the router picks up.

### Navigation Links

For `<a>` tags, use hash hrefs directly:

```tsx
<a href="#/users/42">View User</a>
<a href="#/settings">Settings</a>
```

Or use `navigate()` in an onclick:

```tsx
<button onclick={() => navigate(`/users/${id}`)}>View</button>
```

## `route(pattern)` — Reactive Route Signal

Returns a `Signal<T | null>` that is non-null when the pattern matches the current hash, null otherwise. Useful for components that need to react to route changes without being inside the router.

```ts
import { route } from "@blueshed/railroad";

const userRoute = route<{ id: string }>("/users/:id");

effect(() => {
  const params = userRoute.get();
  if (params) {
    console.log(`Viewing user ${params.id}`);
  }
});
```

This is useful for:
- Highlighting the active nav link.
- Loading data when params change within the same route pattern.
- Reacting to route changes from anywhere in the app.

## `matchRoute(pattern, path)` — Pure Pattern Matcher

A utility function with no side effects. Returns params object on match, `null` on no match.

```ts
import { matchRoute } from "@blueshed/railroad";

matchRoute("/users/:id", "/users/42");       // { id: "42" }
matchRoute("/users/:id", "/users/42/extra"); // null (segment count mismatch)
matchRoute("/about", "/about");              // {}
matchRoute("/about", "/home");               // null
```

## Handling Param Changes Within a Route

When navigating from `/users/1` to `/users/2`, the router sees the same pattern (`/users/:id`) and does **not** re-render. The component must handle this itself:

```tsx
import { createElement, route, when, signal, effect } from "@blueshed/railroad";

function UserDetail({ id }: { id: string }) {
  // Option 1: Use route() signal to track param changes
  const userRoute = route<{ id: string }>("/users/:id");
  const user = signal<User | null>(null);

  effect(() => {
    const params = userRoute.get();
    if (params) {
      fetchUser(params.id).then(u => user.set(u));
    }
  });

  return when(user, () => <div>{user.get()!.name}</div>);
}
```

## Server-Side Pattern

Railroad's route tables mirror Bun.serve's route syntax. A typical app has both:

```ts
// server.ts — Bun serves the HTML shell
import home from "./index.html";
Bun.serve({
  routes: {
    "/": home,
    "/api/users": () => Response.json(users),
  },
});

// app.tsx — client-side routing inside the shell
routes(document.getElementById("app")!, {
  "/":           () => <Home />,
  "/users/:id":  ({ id }) => <UserDetail id={id} />,
});
```

Resources and routes. Server and client. Same pattern.
