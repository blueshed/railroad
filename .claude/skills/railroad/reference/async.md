# Async components and handlers

```tsx
import { mount, routes } from "@blueshed/railroad";

async function Profile() {
  const user = await fetch("/api/me").then((r) => r.json() as Promise<{ name: string }>);
  return () => <div>{user.name}</div>;        // the () => is the whole contract
}

mount(document.getElementById("profile")!, () => <Profile fallback={() => <p>loading…</p>} />);

routes(document.getElementById("root")!, {
  "/users/:id": {
    keyed: true,
    handler: async ({ id }) => {
      const u = await fetch(`/api/users/${id}`).then((r) => r.json() as Promise<{ name: string }>);
      return () => <h1>{u.name}</h1>;
    },
  },
});
```

After an `await` there is no scope (browser JS has no AsyncContext). The thunk gives railroad a synchronous moment to run your bindings under a scope it owns, so they are torn down however late the promise settles.

- A bare Node after an `await` is a console error and renders nothing; in `routes()` it goes to `onError` if given.
- Effects made before the first `await` belong to the component as usual.
- Disposed before it settles, the thunk never runs.
- `fallback` is a thunk, shown at once and swapped out on settlement; on a rejection it is cleared and the error logged.
- An async route handler's bindings die on navigation.
- For streams or several stages rather than one swap, an effect writes a signal and `when()` shows it.
- `effect(async () => …)` is an error (logged in development): start the async work from a synchronous effect and write the result to a signal.
