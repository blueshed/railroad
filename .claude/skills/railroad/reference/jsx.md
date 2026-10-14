# JSX

```tsx
import { signal, mount } from "@blueshed/railroad";

const name = signal("World");
const count = signal(0);

function Greeting() {
  return (
    <div class={() => count.get() > 5 ? "hot" : "cold"} style={{ "--accent": "teal" }}>
      <h1>Hello {name}</h1>                                     {/* a Signal child: live text */}
      <p>{() => count.get() > 5 ? "High" : "Low"}</p>           {/* a function child tracks its reads */}
      <input value={name} oninput={(e) => name.set(e.currentTarget.value)} />
      <button disabled={count.map((n) => n >= 10)} onclick={() => count.update((n) => n + 1)}>+</button>
    </div>
  );
}

mount(document.getElementById("root")!, () => <Greeting />);
```

A component runs once and returns real DOM. A Signal or a function, as a child or a prop, is reactive; anything else is applied once. Each tag's props are typed from the DOM (`jsx.ts`, "Intrinsic element props"): read the types, not a table.

- No `.get()` in JSX or a render body (a component, a `when()` branch, a `list()` row, a route handler, `mount()`'s render): they run once, untracked, so it reads once and subscribes nothing. It warns once per render body in development; `.peek()` and `untrack()` are the silent one-shot reads.
- A function child returns text, not a Node: `{() => ok ? <A/> : <B/>}` renders the element as a string (and warns). Use `when()` for an element, `list()` for a collection ([when-list](when-list.md)).
- `null`, `undefined`, `true`, `false` render nothing, static or reactive.
- Handlers are lowercase DOM events and must be functions: never `onClick`, `onclick={f()}`, `onclick="…"` or a Signal (handlers are not reactive). A non-function warns and attaches nothing; `null`/`undefined` is fine.
- `oninput` fires per keystroke; `onchange` on a text input fires on commit (blur or Enter).
- HTML spellings: `class`, `tabindex`, `readonly`. `className` and `htmlFor` also compile; `tabIndex` and typos don't. Hyphenated names (`data-*`, `aria-*`, `hx-get`) take any value, as does any attribute on an SVG tag or custom element.
- Props are applied after children, so a `<select value>` finds its option and a `ref` (called once) sees the element whole.
- `value`, `checked`, `disabled`, `selected`, `src`, `srcdoc` are set as DOM properties (`null` → `""`). `innerHTML` replaces any JSX children. Other attributes: `false`/`null`/`undefined` removes them.
- `style` is a CSS string or an object (camelCase keys, `--custom` properties); `null`, `false` or `""` sets none. A reactive one may switch between string and object, and an object clears keys the next omits.
- Don't share DOM nodes across `when()` branches: each branch builds its own.

## SVG

SVG tags (`circle`, `g`, `linearGradient`, `foreignObject`, `fe*`…) are made in the SVG namespace wherever they appear, camelCase kept; `<foreignObject>` children stay HTML.

- `a`, `script`, `style`, `title` are shared with HTML: made as HTML and adopted when placed in `<svg>`. There a `ref` fires twice (use the last) and hand-attached listeners are lost: use `on*` props.
- A `when()`/`list()` fragment appended by hand (`svg.appendChild(when(…))`) doesn't adopt those four on its first render: place it through JSX, `mount()`, `routes()` or a parent `when()`/`list()`.
- An SVG element renders only under an `<svg>` ancestor (SVG's rule). Prefer `href` to `xlink:href`.

Async components: [async](async.md).
