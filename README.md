# Railroad

Signals, JSX and a hash router for Bun apps that change in real time.
Components run once and return real DOM nodes; a signal pushes each change
straight to the text and attributes that read it.

It exists because Bun 1.3 already does the rest. HTML imports, TSX bundling,
HMR, single-binary builds and headless browser tests all ship with Bun. What is
missing is a small reactive layer on top, so that is all railroad is: no
virtual DOM, no compiler, no build config, no runtime dependencies.

## Try it

You need Bun 1.3.12 or later. In an empty folder:

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
Bun bundles the TSX on request and reloads on save.

When the app needs its own server (an API, a WebSocket), import the page into
`Bun.serve` (and `bun add -d @types/bun`, so the editor knows `Bun` and HTML imports):

```ts
// server.ts
import home from "./index.html";

Bun.serve({
  routes: { "/": home },
  development: { hmr: true, console: true },
});
```

`bun build --compile server.ts` turns the page, the TSX and the server into one
binary.

## What is in it

| Import | What it does |
|---|---|
| `signal` `computed` `effect` `batch` | Push-based reactive values. A write settles every dependent in depth order: once each, with no half-updated reads, while each computed reads the same signals every time. |
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
- **eta** (private) ties documents to people and to server-rendered pages.

`bun create blueshed my-app` scaffolds railroad and delta together.

## What it is not

- Not React: no hooks, no re-rendering, no virtual DOM. JSX uses HTML names
  (`class`, `onclick`).
- Not TC39 Signals. It is in the family of Vue's `ref`, Solid's
  `createSignal` and Preact's signals.
- Not for Node. It ships TypeScript source and needs Bun, or a bundler with
  `moduleResolution: "bundler"`.

## Where to go next

- [The manual](.claude/skills/railroad/reference.md): setup, every API,
  props, routes, realtime patterns, testing, sharp edges.
- [What bites](.claude/skills/railroad/SKILL.md): the short checklist of
  mistakes that actually happen.
- The contract: the comment at the top of each source file.
- [What changed](CHANGELOG.md).

Both skills ship in the package. To use them with Claude Code, copy them in:

```sh
cp -r node_modules/@blueshed/railroad/.claude/skills/* .claude/skills/
# or for every project:
cp -r node_modules/@blueshed/railroad/.claude/skills/* ~/.claude/skills/
```

`railroad` covers the library; `bun-route` scaffolds Bun HTML routes and
`Bun.WebView` tests.

## License

MIT
