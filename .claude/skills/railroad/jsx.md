# JSX — Real DOM Elements Backed by Signals

Railroad's JSX produces real DOM nodes, not a virtual DOM. Components are plain functions called once. Reactivity comes from signals, not re-rendering.

## JSX Setup

Railroad supports two JSX modes. Check the project's `tsconfig.json` to know which is in use.

### Automatic runtime (recommended)

```json
{ "jsx": "react-jsx", "jsxImportSource": "@blueshed/railroad" }
```

No imports needed — the compiler auto-inserts the runtime. Just write JSX:

```tsx
import { signal } from "@blueshed/railroad";
const count = signal(0);
function App() {
  return <div>{count}</div>;  // works, no createElement import
}
```

### Classic runtime

```json
{ "jsx": "react", "jsxFactory": "createElement", "jsxFragmentFactory": "Fragment" }
```

Every `.tsx` file must import `createElement` (and `Fragment` for `<>...</>`):

```tsx
import { createElement, Fragment } from "@blueshed/railroad";
```

## Components

A component is a function that receives props and returns a DOM Node. It runs **once** per mount.

```tsx
function Greeting({ name }: { name: string }) {
  return <h1>Hello {name}</h1>;
}

// Usage:
<Greeting name="World" />
```

### Children

Children are passed as part of props:

```tsx
function Card({ children }: { children: any[] }) {
  return <div class="card">{children}</div>;
}

<Card><p>Content</p></Card>
```

### Components Run Once

This is the most important thing to understand. Unlike React, the component function body executes once. To make things reactive, use signals:

```tsx
// WRONG — static, never updates:
function Counter() {
  let count = 0;
  return <p>{count}</p>; // always shows 0
}

// RIGHT — reactive via signal:
function Counter() {
  const count = signal(0);
  return (
    <div>
      <p>{count}</p>  {/* auto-updates when count changes */}
      <button onclick={() => count.update(n => n + 1)}>+</button>
    </div>
  );
}
```

## Props and Attributes

### Event Handlers

Lowercase `on` prefix, directly on the element. The handler name after `on` is lowercased and passed to `addEventListener`.

```tsx
<button onclick={() => doSomething()}>Click</button>
<input oninput={(e) => query.set(e.target.value)} />
<form onsubmit={(e) => { e.preventDefault(); save(); }}>
```

### Class

Use `class` or `className` — both work. Signals are supported:

```tsx
<div class="active">static</div>
<div class={activeClass}>reactive</div>  {/* activeClass is a Signal<string> */}
```

For derived/conditional class values, use `computed()`:

```tsx
import { computed } from "@blueshed/railroad";

<button class={computed(() => `btn ${active.get() ? "active" : ""}`)}>
```

**Do NOT use `text()` for attributes** — `text()` creates a text DOM node, not a string. Use `computed()` for any reactive attribute value (class, style, data-*, etc.).

### Style

Pass a plain object (not a signal) to set inline styles:

```tsx
<div style={{ color: "red", fontSize: "16px" }}>styled</div>
```

### DOM Properties

These are set as element properties (not attributes) and support signals: `value`, `checked`, `disabled`, `selected`, `src`, `srcdoc`.

```tsx
const inputValue = signal("");
<input value={inputValue} oninput={(e) => inputValue.set(e.target.value)} />

const isDisabled = signal(false);
<button disabled={isDisabled}>Submit</button>
```

### innerHTML

Set raw HTML (supports signals):

```tsx
<div innerHTML={htmlSignal} />
```

### Ref

Get a reference to the underlying DOM element:

```tsx
<input ref={(el) => el.focus()} />
```

The ref callback fires immediately after element creation.

### Regular Attributes

Anything not matching the above is set via `setAttribute`. Signals auto-update. `false` and `null`/`undefined` remove the attribute.

```tsx
<a href="/about">About</a>
<div data-id={itemId}>...</div>  {/* itemId can be a Signal */}
<input aria-label={label} />
```

## Signals as Children

Pass a signal directly as a child to create a reactive text node:

```tsx
const count = signal(0);
<p>Count: {count}</p>  // updates automatically
```

**Do NOT call `.get()` in JSX children** — this evaluates once and creates a static string:

```tsx
// WRONG — static text, never updates:
<p>Count: {count.get()}</p>

// RIGHT — reactive:
<p>Count: {count}</p>
```

## Null, Boolean, and Undefined Children

`null`, `undefined`, `true`, and `false` are ignored (not rendered). Use this for conditional inline content:

```tsx
<div>{showWarning.peek() && <span>Warning!</span>}</div>
```

But prefer `when()` for reactive conditionals — see below.

## `text(fn)` — Reactive Computed Text

For expressions more complex than a single signal, use `text()`:

```tsx
import { text } from "@blueshed/railroad";

<span>{text(() => count.get() > 5 ? "High" : "Low")}</span>
<p>{text(() => `${firstName.get()} ${lastName.get()}`)}</p>
```

`text()` creates a computed signal internally and keeps its text node updated.

## `when(condition, truthy, falsy?)` — Conditional Rendering

Swaps DOM nodes when the truthiness of the condition changes.

```tsx
import { when } from "@blueshed/railroad";

// With a signal:
{when(isLoggedIn, () => <Dashboard />, () => <Login />)}

// With a function (becomes a computed internally):
{when(() => user.get() !== null, () => <Profile />, () => <SignIn />)}
```

### Key Behavior

- Swaps **only on truthiness transitions** (falsy to truthy, or truthy to falsy).
- Value changes within the same branch (e.g., user changes from one user to another — both truthy) do **not** re-render the branch.
- Components inside each branch should read signals to react to value changes.
- Each branch gets its own dispose scope — effects created inside are cleaned up on swap.

## `list(items, keyFn?, render)` — Keyed List Rendering

Renders a reactive list with DOM diffing by key.

```tsx
import { list, text } from "@blueshed/railroad";

const todos = signal([
  { id: 1, text: "Buy milk" },
  { id: 2, text: "Walk dog" },
]);
```

### Keyed form (recommended)

The render function receives **`Signal<T>`** and **`Signal<number>`** — not raw values. When the array updates and an existing key's value changes, the item signal is updated in place, so effects inside the rendered DOM react automatically without recreating the node.

```tsx
{list(todos, (t) => t.id, (todo, idx) =>
  <li class={computed(() => todo.get().done ? "done" : "")}>
    {text(() => todo.get().text)}
  </li>
)}
```

Use `.get()` inside `text()`, `computed()`, or `effect()` to subscribe to item changes. Use `.peek()` for one-off reads.

### Non-keyed form (index-based, raw values)

The render function receives the raw item value and index number. Items are recreated when the array changes.

```tsx
{list(todos, (t, i) => <li>{t.text}</li>)}
```

### How It Works

- New items: rendered and inserted.
- Removed items: disposed and removed from DOM.
- Reordered items: moved in the DOM (not re-created).
- **Keyed: changed items** update the existing item `Signal`, triggering reactive updates inside the node.
- Each item gets its own dispose scope.

## `Fragment` — Grouping Without a Wrapper

```tsx
import { createElement, Fragment } from "@blueshed/railroad";

function Columns() {
  return (
    <>
      <td>First</td>
      <td>Second</td>
    </>
  );
}
```

## Dispose Scopes

The JSX layer manages cleanup automatically via dispose scopes. When `routes()` or `when()` swap content, all effects created during that content's rendering are disposed. You can also manage scopes manually:

```tsx
import { pushDisposeScope, popDisposeScope } from "@blueshed/railroad";

pushDisposeScope();
// ... create elements, effects ...
const dispose = popDisposeScope();

// later, clean up everything:
dispose();
```

This is **required** when an effect creates JSX that may contain child effects, event handlers, or WebSocket listeners. Every effect that clears a container and appends new JSX **must** use this pattern:

```tsx
let childDispose: (() => void) | null = null;

effect(() => {
  const data = mySignal.get();
  if (childDispose) { childDispose(); childDispose = null; }
  container.innerHTML = "";
  pushDisposeScope();
  container.appendChild(<ChildComponent data={data} /> as Node);
  childDispose = popDisposeScope();
  return () => { if (childDispose) { childDispose(); childDispose = null; } };
});
```

### Why the cleanup return matters

The effect handles two lifecycle events:

1. **Re-run** — when a tracked signal changes, the effect re-runs. The `if (childDispose)` call at the top cleans up the previous child scope before creating a new one.
2. **Dispose** — when the effect itself is stopped (parent scope torn down, route change, `when()` swap), the cleanup function returned from the effect disposes the child scope. **Without this return, child effects leak when the parent is removed.**

### Common mistake

The most frequent porting bug is forgetting dispose scopes in effects that rebuild DOM. Any effect that does `container.innerHTML = ""; container.appendChild(<SomeJSX /> as Node)` needs this pattern. Static JSX with no signals, effects, or event listeners inside does not need it, but when in doubt, wrap it.
