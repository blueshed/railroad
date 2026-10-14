# Routes

```tsx
import { routes, route, navigate, when } from "@blueshed/railroad";

function SitesLayout() {
  const detail = route<{ id: string }>("/sites/:id");     // null when unmatched
  return (
    <div>
      <a href="#/sites/42">42</a>
      {when(detail, (d$) => <h2>site {d$.map((d) => d.id)}</h2>, () => <p>all sites</p>)}
    </div>
  );
}

routes(
  document.getElementById("root")!,
  {
    "/":          () => <h1>home</h1>,
    "/users/new": () => <h1>new user</h1>,                                   // before /users/:id
    "/users/:id": (_p, params$) => <h1>user {params$.map((p) => p.id)}</h1>,
    "/posts/:id": { keyed: true, handler: ({ id }) => <h1>post {id}</h1> },
    "/sites/*":   () => <SitesLayout />,                                     // stays mounted
    "/slow":      async () => { const n = await Promise.resolve(7); return () => <p>{n}</p>; },
  },
  { onError: (err) => { console.warn(err); return <p class="error">Something went wrong.</p>; } },
);

navigate("/users/42");   // route() and the router are current as it returns
```

`routes(target, table, options?)` returns its disposer (idempotent); `matchRoute(pattern, path)` is the pure matcher, for tests and servers. Types and the contract: `routes.ts`.

- The first match wins, in declaration order: `/users/new` before `/users/:id`.
- Segments only: no query strings (`#/users/42?tab=1` gives `id` `"42?tab=1"`; split `?` yourself), and a trailing slash is a segment (`/users/42/` doesn't match `/users/:id`).
- A handler runs once per **pattern**, untracked, so `({ id }) => …` keeps the first id after `/users/1` → `/users/2`. Read `params$`, or mark the route `{ keyed: true, handler }`, which disposes the old run and runs again when the params change (local state and focus reset).
- Don't key a wildcard layout: its `params["*"]` changes on every sub-path. `/sites/*` matches `/sites` and keeps the layout mounted while `route()` swaps the inside.
- An async handler resolves to a thunk, as an async component does; a bare Node is an error. Bindings made in the thunk die on navigation.
- `onError` runs when a handler throws or rejects (`err` is `unknown`); a returned Node renders in the target. Without it the error goes to `console.error`.
- `navigate()` is synchronous. Setting `location.hash`, or following a `#/…` link, lands on the next `hashchange`, a macrotask later.
