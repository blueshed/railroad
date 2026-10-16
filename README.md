# Railroad

**railroad changes a page exactly where the data changed, and nowhere else, with no build step:
a tsconfig is the whole setup.**

You write components in JSX, and each runs once, returning real DOM nodes. The values that
change live in signals. A signal is a value in a box: `signal(0)` makes one, `.set(5)` or
`.update((n) => n + 1)` changes what is inside, and any text or attribute on the page that was
given the box, not a copy of its value, updates to match. Nothing else is touched: no virtual
DOM, no re-rendering, no hooks. Lists keep their rows by key, and the hash router hands a page
its params as a signal, so going from `/users/1` to `/users/2` updates the page in place.

Bun already serves an HTML file straight from disk, bundles the TSX its `<script>` tag names,
reloads on save, builds one binary and runs headless browser tests. railroad is the small
reactive layer Bun was missing: no compiler, no build config, no runtime dependencies. It's small enough to read in one sitting, by a person or
an AI, and the mistakes people actually make fit on one page. It pairs with delta: an open delta
document is a railroad signal, so live shared data drops straight into the page.

## Try it

You need Bun 1.3.14 or later. In an empty folder:

```sh
bun add @blueshed/railroad
```

Add three files.

```json
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@blueshed/railroad",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "module": "esnext",
    "target": "esnext",
    "moduleResolution": "bundler",
    "strict": true
  }
}
```

```html
<!-- index.html -->
<!DOCTYPE html>
<html>
  <body>
    <div id="root"></div>
    <script type="module" src="./app.tsx"></script>
  </body>
</html>
```

```tsx
// app.tsx
import { signal, mount } from "@blueshed/railroad";

const count = signal(0);

function Counter() {
  return (
    <button onclick={() => count.update((n) => n + 1)}>
      Clicked {count} times
    </button>
  );
}

mount(document.getElementById("root")!, () => <Counter />);
```

Then serve it:

```sh
bun ./index.html
```

Open the URL it prints and click the button. `{count}` is the signal itself,
not its value, so only that text node changes; `Counter` never runs again.
`{count.get()}` would put the value in once, and the button would say 0
forever. Bun bundles the TSX on request and reloads on save.

When the app needs its own server (an API, a WebSocket), import the page into
`Bun.serve`. So the editor knows `Bun` and HTML imports, `bun add -d @types/bun`
and add `"types": ["bun"]` to `compilerOptions`:

```ts
// server.ts
import home from "./index.html";

Bun.serve({
  routes: { "/": home },
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
});
```

`bun build --compile server.ts` turns the page, the TSX and the server into one
binary.

## What is in it

| Import | What it does |
|---|---|
| `signal` `computed` `effect` `batch` | Push-based reactive values. A write updates each dependent once, never half-updated. |
| JSX, `mount` `when` `list` | Real-DOM rendering. Signals and functions bind to text and attributes; `when` swaps branches; `list` keeps keyed rows. |
| `routes` `route` `navigate` | Hash router with reactive params, so `/users/1` to `/users/2` updates without remounting. |
| `provide` `inject` | Typed dependency injection without passing props down. |
| `createLogger` | Levelled, timestamped console output. |

Each module stands alone: `@blueshed/railroad/signals` works on a server or in
a worker with no DOM and no JSX.

## What it pairs with

- **railroad** draws in the browser.
- **[@blueshed/delta](https://www.npmjs.com/package/@blueshed/delta)** keeps
  documents and syncs them over one WebSocket. `openDoc("name").data` is a
  railroad signal, so a document drops straight into JSX, `when()` and
  `list()`.
- **[paintbrush](https://github.com/blueshed/paintbrush)** is a starting
  website: Bun routes and resources, railroad for the page, a delta document
  when a resource needs one. `bun create blueshed/paintbrush my-app` makes one (Bun 1.4).

## What it is not

- Not React: no hooks, no re-rendering, no virtual DOM. JSX uses HTML names
  (`class`, `onclick`).
- Not TC39 Signals. It is in the family of Vue's `ref`, Solid's
  `createSignal` and Preact's signals.
- Not for Node. It ships TypeScript source and needs Bun, or a bundler with
  `moduleResolution: "bundler"`.

## Where to go next

- [What bites](.claude/skills/railroad/SKILL.md): the short checklist of
  mistakes that actually happen, and which page of
  [the manual](.claude/skills/railroad/reference/) to read for which job.
- The contract: the comment at the top of each source file.
- [Why railroad](docs/why-railroad.md): the reasons behind it.
- [What changed](CHANGELOG.md).

Both skills ship in the package. To use them with Claude Code, copy them in:

```sh
mkdir -p .claude/skills
cp -r node_modules/@blueshed/railroad/.claude/skills/* .claude/skills/
# or for every project, use ~/.claude/skills in both lines
```

`railroad` covers the library; `bun-route` scaffolds Bun HTML routes and
`Bun.WebView` tests.

## License

MIT
