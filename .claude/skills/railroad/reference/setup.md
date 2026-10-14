# Setup

The README's app, which `tests/readme.test.ts` serves, builds and compiles as written:

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

```ts
// server.ts
import home from "./index.html";

Bun.serve({
  routes: { "/": home },
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
});
```

```sh
bun add @blueshed/railroad
bun server.ts                                        # dev with HMR
bun build ./index.html --production --outdir=dist    # production assets
bun build --compile server.ts                        # one binary
```

The server step adds `"types": ["bun"]` to the tsconfig, which needs `@types/bun` (`bun init` adds it; else `bun add -d @types/bun`).

- A routed app calls `routes(root, table)` in place of `mount()`: see [routes](routes.md). Adding pages to an app, server entries and `Bun.WebView` tests: the `bun-route` skill.
- `bun create blueshed/paintbrush my-app` makes a paintbrush app (Bun 1.4): Bun routes and resources, railroad for the page; its `evolve` skill adds a delta document when a resource needs one.
- Bun or another bundler only: railroad ships TypeScript source with extensionless imports, so it needs `moduleResolution: "bundler"` (or `"bun"`), never Node's `node16`/`nodenext`.
- No global `JSX`, so railroad sits beside React's types. `react-jsx` + `jsxImportSource` finds the types in `@blueshed/railroad/jsx-runtime`; classic `"jsx": "react"` with `jsxFactory: "createElement"`, `jsxFragmentFactory: "Fragment"` (import `createElement` per file) finds them on `createElement.JSX`.
- To annotate: `import type { JSX } from "@blueshed/railroad"`. `JSX.Element` is a DOM `Node`.
- Warnings are development-only. A build that defines `process.env.NODE_ENV` as `"production"` drops them: `bun build --production`, `Bun.serve` with `development: false`, esbuild, Vite. `bun build --minify` alone does not. Served unbundled (no `process`), railroad warns. What throws still throws.
- Each module stands alone: `@blueshed/railroad/signals`, `/shared`, `/logger` need no DOM and no JSX config (server, CLI, worker); `/jsx` needs signals; `/routes` needs signals and jsx, and loads without a DOM.
