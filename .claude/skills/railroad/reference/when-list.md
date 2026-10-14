# when() and list()

```tsx
import { signal, when, list, mount } from "@blueshed/railroad";

type Todo = { id: number; text: string };
const todos = signal<Todo[]>([{ id: 1, text: "Buy milk" }]);
const selected = signal<Todo | null>(null);

function Todos() {
  return (
    <div>
      <ul>
        {list(todos, (t) => t.id, (todo$, idx$) => (
          <li class={idx$.map((i) => i % 2 ? "odd" : "even")}
              onclick={() => selected.set(todo$.peek())}>
            {todo$.map((t) => t.text)}
          </li>
        ))}
      </ul>
      {when(selected, (t$) => <p>{t$.map((t) => t.text)}</p>, () => <p>none</p>)}
    </div>
  );
}

mount(document.getElementById("root")!, () => <Todos />);
```

Both are typed in `jsx.ts`. Both render synchronously (in the DOM when `mount()` or the append returns), keep their content between bracket comments, need a [scope](scopes.md), and never rebuild after disposal.

## when(condition, truthy, falsy?)

- `condition` is a signal or a function.
- The branch rebuilds only when **truthiness** flips; `"a"` → `"b"` doesn't. Read the value through `v$`, the current truthy value (`NonNullable<T>`, no `!`), which notifies on every change while truthy, an in-place `.touch()` included. `when(x, () => <A id={x.get()!.id} />)` stays on the first value.
- Each branch has its own dispose scope; a branch that throws keeps nothing and builds again on the next change.

## list(items, keyFn, render, options?)

- A keyed row gets `ReadonlySignal<T>`, not `T`: `({ text }) => …` reads once. Derive with `row$.map(…)`; `row$.peek()` for a key or attribute that never changes.
- Keys must be unique and stable: duplicates collapse into one row (and warn).
- Rows move, never rebuild. A reorder moves only the rows out of order, so a row being typed in keeps its focus, selection and scroll.
- `options` (keyed form) are `SignalOptions` for each row's signal. The default `Object.is` is right when a changed row is a new object (delta's client gives one). Rows mutated in place then `.touch()`ed need `{ equals: () => false }`: [realtime](realtime.md).
- The index form, `list(items, (item, i) => …)`, passes raw values and rebuilds every row on every change: static lists only.
- Any array derived from a signal goes through `list()`. A plain `.map()` bakes its rows in once; it is right only for a static array (`COLUMNS.map(c => <Column col={c} />)`).
