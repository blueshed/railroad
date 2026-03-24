# Signals — Reactive State

Signals are the foundation of railroad. Everything reactive flows from them.

## Creating Signals

```ts
import { signal } from "@blueshed/railroad";

const count = signal(0);          // Signal<number>
const name = signal("World");     // Signal<string>
const items = signal<string[]>([]); // Signal<string[]>
```

## Reading and Writing

```ts
count.get()              // read (tracks dependency inside effect/computed)
count.set(5)             // write (notifies listeners if value changed)
count.update(n => n + 1) // transform and write (caller must return a new value)
count.mutate(v => ...)   // clone, mutate in place, notify (see below)
count.patch({ key: v })  // shallow merge for object signals (see below)
count.peek()             // read WITHOUT tracking — use for one-off reads outside effects
```

### Equality Check

`set()` uses `Object.is()` to compare old and new values. If they are the same, no listeners are notified. This means:

- Primitives: setting the same number/string/boolean is a no-op.
- Objects/arrays: you must create a new reference to trigger updates.

```ts
const todos = signal([{ id: 1, text: "Buy milk" }]);

// WRONG — same array reference, no update:
todos.peek().push({ id: 2, text: "Walk dog" });
todos.set(todos.peek()); // Object.is says same reference, listeners NOT notified

// RIGHT — new array:
todos.update(arr => [...arr, { id: 2, text: "Walk dog" }]);
```

### `mutate(fn)` — In-Place Mutation

`mutate()` clones the current value with `structuredClone`, passes the clone to your function for in-place mutation, then notifies listeners. Use it when you want to modify objects or arrays naturally without manually creating a new reference.

```ts
const todos = signal([{ id: 1, text: "Buy milk" }]);

// Append:
todos.mutate(arr => arr.push({ id: 2, text: "Walk dog" }));

// Modify nested property:
const doc = signal({ title: "Draft", meta: { tags: ["a"] } });
doc.mutate(d => d.meta.tags.push("b"));

// Toggle in a Set:
const selected = signal(new Set([1, 2, 3]));
selected.mutate(s => s.has(4) ? s.delete(4) : s.add(4));
```

`mutate()` always notifies listeners (the clone guarantees a new reference). Use `update()` when you can return a new value cheaply; use `mutate()` when in-place mutation is more natural.

### `patch(partial)` — Shallow Merge

`patch()` does a shallow merge for object signals — equivalent to `set({ ...current, ...partial })`:

```ts
const filter = signal({ color: "red", size: 10, active: true });

filter.patch({ color: "blue" });           // { color: "blue", size: 10, active: true }
filter.patch({ size: 20, active: false }); // { color: "blue", size: 20, active: false }
```

Like `set()`, `patch()` uses `Object.is` — since the spread always creates a new reference, listeners are always notified.

## Computed Signals

Derived read-only signals that auto-update when dependencies change.

```ts
import { computed } from "@blueshed/railroad";

const firstName = signal("John");
const lastName = signal("Doe");
const fullName = computed(() => `${firstName.get()} ${lastName.get()}`);

fullName.get(); // "John Doe"
firstName.set("Jane");
fullName.get(); // "Jane Doe"
```

Computed signals chain:

```ts
const a = signal(1);
const b = computed(() => a.get() + 1);   // 2
const c = computed(() => b.get() * 10);  // 20
a.set(3);
c.get(); // 40
```

## Effects

Run a function whenever its signal dependencies change. The function runs immediately on creation.

```ts
import { effect } from "@blueshed/railroad";

const count = signal(0);

const dispose = effect(() => {
  console.log(`count is ${count.get()}`);
});
// logs: "count is 0"

count.set(1);
// logs: "count is 1"

dispose(); // stop listening
count.set(2); // nothing logged
```

### Cleanup Functions

An effect can return a cleanup function. It runs before each re-execution and on dispose.

```ts
effect(() => {
  const id = setInterval(() => console.log(count.get()), 1000);
  return () => clearInterval(id); // cleanup before re-run or on dispose
});
```

### Automatic Dependency Tracking

Effects only track signals read during execution. If a branch is not taken, those signals are not tracked:

```ts
const showDetail = signal(true);
const summary = signal("short");
const detail = signal("long");

effect(() => {
  if (showDetail.get()) {
    console.log(detail.get());   // tracked
  } else {
    console.log(summary.get());  // tracked only when showDetail is false
  }
});

// When showDetail is true, changing summary does NOT re-run the effect.
```

### Infinite Loop Protection

Effects are guarded against infinite loops (max depth 100). If an effect sets a signal that triggers itself in a cycle, it throws:

```
Error: Maximum effect depth exceeded — possible infinite loop
```

## Batch

Group multiple signal writes so effects run only once at the end.

```ts
import { batch } from "@blueshed/railroad";

const a = signal(1);
const b = signal(2);

effect(() => {
  console.log(a.get() + b.get());
});
// logs: 3

batch(() => {
  a.set(10);
  b.set(20);
});
// logs: 30 (once, not twice)
```

Batches nest safely — effects flush only when the outermost batch completes.

## Dispose Pattern

`effect()` returns a dispose function. Call it to stop the effect and run its cleanup.

The JSX layer manages dispose scopes automatically — effects created during component rendering are collected and disposed when the component is removed (e.g., by the router or `when()`). You rarely need to manage dispose manually unless you create effects outside of JSX rendering.

```ts
// Manual dispose (outside JSX):
const dispose = effect(() => { ... });
// later:
dispose();

// Inside JSX components, effects are auto-collected.
// The router or when() calls dispose when swapping content.
```

## Where to Declare Signals

- **Module level** — shared state, lives for the app lifetime. Good for stores, global UI state.
- **Inside a component** — local state, created fresh each time the component mounts. Disposed when the component is removed.

```ts
// Module level — shared, persistent
const currentUser = signal<User | null>(null);

// Component level — local, ephemeral
function SearchBox() {
  const query = signal("");
  return <input value={query} oninput={(e) => query.set(e.target.value)} />;
}
```
