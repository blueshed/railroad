---
name: bun-route
metadata:
  version: 0.16.2
description: "Scaffold a new page or route in a Bun fullstack app: an HTML entry, bundled CSS, a TypeScript, JavaScript or TSX client script, registered on the server. Also writes Bun.WebView browser tests for a route's interaction. Use when the user wants to add a page or route, or to test one in a real browser."
argument-hint: "[route-path] [description]"
---

# Bun route scaffolding

A route is an HTML file imported by the server and handed to `Bun.serve({ routes })`; Bun bundles the scripts and CSS it references. A page is three files beside each other: `<name>.html`, `<name>.css`, `<name>.<ext>`.

## 1. Detect the mode

Read the existing HTML's `<script src>` extensions, `tsconfig.json` (and its `jsxImportSource`), `package.json`'s dependencies, and the route files already there. Match what is in use.

| Signal | Mode | Script |
|---|---|---|
| No tsconfig, no JSX deps | **js** | `.js`, plain DOM |
| tsconfig, no JSX deps | **ts** | `.ts`, plain DOM |
| `@blueshed/railroad` in deps | **tsx-railroad** | `.tsx` |
| `react` in deps | **tsx-react** | `.tsx` |

If nothing settles it, ask.

**Empty project** (no `package.json`, no server entry): `bun init -y`, delete its `index.ts`, then install only what the mode needs: nothing for js/ts; `bun add @blueshed/railroad`; or `bun add react react-dom && bun add -d @types/react @types/react-dom`. For ts/tsx, replace `compilerOptions` with the mode's block ([tsconfig](reference/tsconfig.md)). Create the server entry ([server](reference/server.md)).

## 2. Arguments

`$ARGUMENTS` is a route path (`/about`) and maybe a description. With none, ask.

## 3. Create the files

- A route `/about` gets a directory: `about/about.html`, `about/about.css`, `about/about.<ext>`.
- The root route (`/`, `index`, `home`) goes in the project root as `index.html`, `index.css`, `index.<ext>`; no `index/` directory.
- Templates per mode: [templates](reference/templates.md). In tsx-railroad mode, read the `railroad` skill before writing components.

## 4. Register it

In the file that calls `Bun.serve()`: `import aboutPage from "./about/about.html";` and `"/about": aboutPage,` in `routes`. In a ts/tsx project `bun check` needs `@types/bun` and `"types": ["bun"]` for `Bun` and `.html` imports.

## 5. Verify

Ask the user to start or restart the server. Read its port (default 3000), then `curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>/<route>` must print `200`. With a browser tool, screenshot the page (from Docker, use `host.docker.internal`, not `localhost`), and check the CSS matches the other routes.

## 6. Test it (when it has interaction worth locking down)

Forms, drag, WebSockets, client state: write a `Bun.WebView` test. Make the server an importable `startServer(opts)` factory first. → [webview](reference/webview.md), then [webview-recipes](reference/webview-recipes.md) for polling, multi-statement `evaluate`, synthetic drag and wheel, and suite flags.

## Invariants

- `development: process.env.NODE_ENV !== "production" && { hmr: true, console: true }`: always on in development, always gated, because Bun keeps HMR under `NODE_ENV=production`.
- Each route's CSS is self-contained; no shared `base.css`.
- HTML paths are relative (`./`) to the HTML file; scripts are `type="module"`.
- Install framework dependencies only when the mode needs them; never `bun-types` beside `@types/bun`.
- No external bundler: `bun build` makes static assets or one binary ([server](reference/server.md)).
- Browser tests bind `port: 0` and use `server.url.href`.

## Reference

- [templates](reference/templates.md): HTML entry, CSS, client script per mode
- [server](reference/server.md): `Bun.serve`, API routes, files, build and deploy
- [tsconfig](reference/tsconfig.md): the block for each mode
- [webview](reference/webview.md): server factory, test skeleton, footguns
- [webview-recipes](reference/webview-recipes.md): polling, `Function(…)()`, synthetic events, order-independent tests, suite flags
