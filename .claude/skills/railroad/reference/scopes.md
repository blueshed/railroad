# Dispose scopes

```tsx
import { signal, effect, mount } from "@blueshed/railroad";

const name = signal("ada");
const user = signal(1);

function Badge() {
  const c = signal(0);                                     // the component's own
  effect(() => console.log(c.get()));                      // disposed with the component
  const label = name.map((n) => n.toUpperCase());          // made beside the effect, not in it
  effect(() => { user.get(); console.log(label.get()); }); // each run reads the one label
  return <button onclick={() => c.update((n) => n + 1)}>{label}</button>;
}

const dispose = mount(document.getElementById("root")!, () => <Badge />);
dispose();                                                 // effects stop, nodes go
```

A scope is opened by a component (`createElement`), a `routes()` handler, a `when()` branch, a `list()` row and `mount()`, which returns the disposer (`routes()` returns one too). Everything made inside goes with it.

- Every `effect()` and `computed()` run is a scope too: what its body creates (computeds and `.map()`s, nested effects, `when()`, `list()`, components, `trackDispose()`s) is disposed before the next run and on dispose. So what must outlive one run is made outside the body:

  ```tsx
  // ❌ Released on the next run; the cache goes dead
  let label: ReadonlySignal<string> | undefined;
  effect(() => { user.get(); label ??= name.map((n) => n.toUpperCase()); });
  ```

- Opening a fresh resource each run is fine when that is the intent: ``openDoc(`room:${room.get()}`)`` follows `room`.
- An effect at module top level is never disposed: keep its disposer.
- An event handler is not a scope: an effect made in `onclick` leaks. Derive in the component body.
- `when()` or `list()` made outside any scope leaks, and warns in development.
- `route()` (singular) opens no scope; at module level it lives for the app, which is allowed.
- A custom root brackets itself: `pushDisposeScope()` … build … `const dispose = popDisposeScope()`. Pop on every path (`try/finally`), never across an `await`. `trackDispose(fn)` registers a cleanup; `hasActiveDisposeScope()` says whether one is open.
- After an `await` there is no scope: that is why async components resolve to a thunk ([async](async.md)).
