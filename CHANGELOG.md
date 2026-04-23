# Changelog

## 0.7.1

### Added

- **`Signal.touch()`** — public escape hatch to fire listeners without replacing the value reference. Pair with in-place mutation to skip the `structuredClone` cost of `.mutate(fn)` — intended for large documents where a single-field update shouldn't clone the whole tree, and for keeping child-ref identity stable across updates (closures that captured a row don't go stale). The `Object.is` guard still gates computed propagation: effects and primitive-returning computeds re-run, but a computed that returns the same reference bails out — by design.

### Fixed

- **`list()` and `when()` now adopt HTML-namespace children into SVG** — previously, `<circle>` rendered through `list(shapes, …)` inside an `<svg>` stayed in the HTML namespace and didn't render, even though `appendChildren` already handled this for static JSX. Adoption runs before the render result's child nodes are captured, so subsequent list reorders/removals and `when()` branch swaps operate on the adopted SVG nodes rather than stale HTML references.

### Tests

- **DOM test infra** — added `@happy-dom/global-registrator` as a dev dep and a `bunfig.toml` preload so `bun test` has a DOM available. Enables `jsx.test.tsx`, which covers the SVG adoption fix across keyed create, index-based recreate, reorder, remove, nested `<g>/<circle>`, and `createElementNS` pass-through paths. Suite grew from 46 to 64 passing tests.

## 0.7.0

### Removed (breaking)

- **`./delta`, `./delta-client`, `./delta-server`, `./delta-sqlite` subpath exports** are gone, along with the root-level `applyOps` / `DeltaOp` re-exports. Real-time document sync now lives in the sibling package [`@blueshed/delta`](https://www.npmjs.com/package/@blueshed/delta), extracted from railroad's 0.6.x delta-* modules and since extended with a Postgres backend, auth integration, temporal reads, DOM-ops helper, and a ~200-test suite. Railroad was the proving ground; delta is the finished product.
- Migration for existing users:
  - `@blueshed/railroad/delta` → `@blueshed/delta/core`
  - `@blueshed/railroad/delta-client` → `@blueshed/delta/client`
  - `@blueshed/railroad/delta-server` → `@blueshed/delta/server`
  - `@blueshed/railroad/delta-sqlite` → `@blueshed/delta/sqlite`
  The public API is a superset — no symbol names change.

### Changed

- **Scope and taglines rewritten.** No longer a "micro full-stack framework" — with delta extracted, railroad is client-side reactivity (signals, JSX, routes) plus a typed DI container and a logger that happen to work on either side. Package description, README, and SKILL.md all refresh to reflect that. `@blueshed/delta`'s client imports railroad's signals, so `openDoc("name")` still drops straight into a railroad JSX tree — no glue changes required.
- **`futures.md` removed** — the roadmap was all delta-doc / CRDT follow-ups (conflict resolution, path-aware merge), which belong with `@blueshed/delta` now. Nothing UI-framework-shaped was in there.

## 0.6.3

### Docs

- **README** — rebranded from "micro UI framework" to "micro full-stack framework." Added "Why Railroad?" positioning section comparing against SolidJS + Yjs composition. Updated line count to ~1,700 (actual code, excluding comments/blanks). Added delta-doc to the Design bullet list.
- **SKILL.md** — updated description, line count, and delta-doc section to reflect full-stack scope and SQLite backend.
- **futures.md** — replaced vague conflict resolution options with a concrete three-level plan: version stamping + conflict notification (next), path-aware auto-merge (future), custom merge strategies (future). Added "Why not CRDTs?" rationale.

## 0.6.2

### Added

- **`delta-sqlite` module** — SQLite relational backend for delta-doc. Declare schemas with typed columns, parent/child relationships, cascade deletes, and temporal versioning. Define doc lenses that load a root row plus its included collections. Same client API as the JSON file backend — swap `registerDoc` for `registerDocs` on the server.
- **166 tests** — full test coverage for `delta-sqlite` (schema DDL, CRUD ops, nested collections, cascade deletes, temporal queries, scope filters).

### Docs

- **README** — added delta-doc and delta-sqlite usage sections with server/client examples, schema declaration reference, and doc lens configuration.

## 0.6.1

### Changed

- **Strict `noUncheckedIndexedAccess`** — tsconfig now enables `noUncheckedIndexedAccess: true` so consumers with strict settings don't hit type errors that railroad's own checks miss.

## 0.6.0

### Added

- **Configurable WebSocket options** — `createWs()` accepts `WsOptions` with `path`, `idleTimeout`, and `sendPings`. Defaults: `"/ws"`, `60`, `true`.
- **`"silent"` log level** — suppresses all output including errors. Set via `setLogLevel("silent")` or `LOG_LEVEL=silent` in `.env`.
- **Test coverage** — 90 tests across 5 files covering `delta`, `delta-server`, `signals`, `shared`, and `logger`. `bun test --coverage` reports 87% overall.

### Changed

- **`createWs()` exposes `upgrade` not `routes`** — the consumer owns `Bun.serve()` and wires the upgrade handler into their own routes: `{ [ws.path]: ws.upgrade, ...myRoutes }`.
- **`log.error()` respects log level** — previously always logged regardless of level. Now gated like other levels, enabling silent mode for tests.
- **Logger reads `Bun.env`** — replaced `process.env` Node-ism with `globalThis.Bun?.env?.LOG_LEVEL`.
- **Client URL construction** — `connectWs()` uses `new URL()` to resolve the WebSocket path instead of manual string concatenation.
- **Server upgrade URL parsing** — removed unnecessary `"http://localhost"` base from `new URL(req.url)`.

### Docs

- **`.env` setup** — README now documents `LOG_LEVEL` environment variable and available levels (`debug | info | warn | error | silent`).

## 0.5.0

### Added

- **Delta-doc** — JSON document patching primitive for real-time sync. Three new modules:
  - `@blueshed/railroad/delta` — shared `DeltaOp` type and `applyOps()` function. Pure, zero dependencies, usable on both server and client.
  - `@blueshed/railroad/delta-server` — `createWs()` (shared WebSocket server with action routing and Bun pub/sub), `registerDoc()` (persist a typed JSON document, sync via delta ops), `registerMethod()` (stateless RPC handler).
  - `@blueshed/railroad/delta-client` — `connectWs()` (reconnecting WebSocket with request/response), `openDoc()` (open a doc as a reactive signal), `call()` (invoke RPC methods). Includes auto-reconnect with exponential backoff.
- **`DeltaOp` and `applyOps`** re-exported from the main `@blueshed/railroad` barrel for convenience.

## 0.4.0

### Added

- **Function children** — `{() => count.get() > 5 ? "High" : "Low"}` as JSX children auto-tracks dependencies and updates the text node. Replaces `text()`.
- **`Signal.map(fn)`** — derive a new signal: `count.map(n => n * 2)`. Clean pattern for reactive attributes and list items.
- **Component auto-scoping** — `createElement` wraps function components in a dispose scope automatically. Effects and computeds inside components clean up when the parent scope tears down. No manual `pushDisposeScope`/`popDisposeScope` needed.
- **Effect auto-tracking** — `effect()` and `computed()` register their dispose in the current scope automatically. No manual `trackDispose()` needed inside components.
- **Wildcard route patterns** — `matchRoute("/sites/*", "/sites/42/settings")` matches, capturing the rest as `params["*"]`. Enables nested routing with persistent layouts.
- **Nested routing** — use `/*` to keep a layout mounted while `route()` signals drive sub-views. Both `routes()` and `route()` auto-track in the parent dispose scope for clean teardown.

### Fixed

- **`when()` nesting** — `when()` inside `when()` now works without wrapper elements. Branches that return fragments (from nested `when`/`list`) are tracked as node arrays instead of a single reference.
- **`list()` fragment handling** — same fix as `when()` — list items returning fragments are handled correctly.
- **`route()` hash listener leak** — `route()` now tracks `releaseHash()` in the dispose scope, fixing a pre-existing ref-count leak.

### Removed

- **`text()`** — removed from public API. Use function children `{() => expr}` instead.
- **`pushDisposeScope` / `popDisposeScope`** — removed from public API. Components auto-scope, framework owns cleanup internally.

### Changed

- **Anti-patterns reduced from 8 to 4** — function children, auto-scoping, and fragment-safe `when`/`list` eliminate the need for most documented gotchas.

## 0.3.4

### Fixed

- **`computed()` inside `list()` leak** — `computed()` created inside a `list()` render function was leaking subscriptions to the outer list effect's listener, causing infinite synchronous re-entry. Initial evaluation now suspends outer tracking by saving/restoring `currentListener` and `currentDeps`.

## 0.3.3

### Docs

- **Skill anti-patterns** — added rules for nested `when()` (wrap in real element), shared DOM nodes across branches (create fresh), and null guards inside branches (signal cascade order is not guaranteed).

## 0.3.2

### Fixed

- **Index-based `list()` reactivity** — index-based list items now dispose and recreate when the signal changes, so inner content that depends on external signals updates correctly. Previously, existing items were reused without re-rendering, causing stale DOM when unrelated data changed.

## 0.3.1

### Added

- **Async route handlers** — route handlers can now return `Promise<Node>`. The router awaits the result before appending to the DOM, enabling `async` components that `await` data before rendering. Stale results are discarded if the user navigates away during the await.

## 0.3.0

### Added

- **Reactive route params** — route handlers now receive `(params, params$)`. The second argument is a `Signal` that updates when params change within the same pattern (e.g. `/users/1` → `/users/2`). Fully backwards compatible — ignore the second arg if you don't need it.
- **Reactive style signals** — `style={someSignal}` now works for reactive inline styles alongside static style objects.
- **Progressive adoption docs** — README now shows the dependency graph and three adoption levels (signals only → JSX → full app).

### Fixed

- **Computed disposal** — `computed()` now tracks its internal effect in the active dispose scope, preventing memory leaks when computed signals are created inside components.
- **Effect depth guard** — fixed off-by-one in infinite loop detection (`>` → `>=`).
- **Logger error handling** — proper type narrowing for non-Error throws, guarded `new URL()` against malformed URLs.
- **Route cleanup** — `hashchange` listener is now reference-counted and removed when the last router disposes.

### Changed

- **Dispose scopes moved to `signals.ts`** — `pushDisposeScope`, `popDisposeScope`, and `trackDispose` now live in `signals.ts` (re-exported from `jsx.ts` for compatibility). This allows `computed()` to participate in dispose scopes.
- **Consolidated skill docs** — five skill files (~900 lines) replaced by a single compact `SKILL.md` (~75 lines) that references source files.

## 0.2.8

### Fixed

- **npm publish workflow** — Node 24 (npm 11.5+) with `NODE_AUTH_TOKEN=""` for proper OIDC trusted publishing.

## 0.2.7

### Fixed

- **npm publish workflow** — use granular access token via `NPM_TOKEN` secret with provenance signing.

## 0.2.6

### Fixed

- **npm publish workflow** — strip token placeholder from `.npmrc` so npm falls through to OIDC auth.

## 0.2.5

### Fixed

- **npm publish workflow** — pin Node 22 to get npm 10.9+ required for OIDC trusted publishing. Remove token env var.

## 0.2.4

### Fixed

- **npm publish workflow** — use `setup-node` with `registry-url` only (no explicit node version, no token env) for correct OIDC trusted publishing.

## 0.2.3

### Fixed

- **npm publish workflow** — removed `actions/setup-node` registry config that was overriding OIDC auth with an empty token.

## 0.2.2

### Changed

- **npm publish via OIDC** — switched from `NPM_TOKEN` secret to trusted publishing with OpenID Connect. No token rotation needed.

## 0.2.1

### Added

- **GitHub Actions workflow** — publishes to npm automatically when a GitHub release is created. Runs tests and type check before publishing.

### Fixed

- **npm package contents** — excluded test files and local Claude settings from the published tarball.

## 0.2.0

### Added

- **`signal.mutate(fn)`** — `structuredClone` the value, mutate in place, notify. Eliminates forgotten-clone bugs when modifying objects, arrays, Sets, or Maps.
- **`signal.patch(partial)`** — shallow merge for object signals. `s.patch({ color: "blue" })` instead of `s.set({ ...s.peek(), color: "blue" })`.
- **`list()` keyed item signals** — the keyed overload now passes `Signal<T>` and `Signal<number>` to the render function. When an item's value changes, the signal updates in place — no node recreation. **(Breaking: keyed render callbacks must use `item.get()` instead of `item` directly.)**

### Docs

- Updated README, skill docs (signals.md, jsx.md, SKILL.md), and source comments for all three features.

## 0.1.9

### Fixed

- **Another strict-mode fix** — non-null assertion on `NamedNodeMap` index access in SVG attribute copying.

## 0.1.8

### Added

- **`tryInject()`** — non-throwing variant of `inject()` that returns `undefined` when no provider exists.

### Fixed

- **TypeScript strict-mode compatibility** — fixed `NamedNodeMap` spread in SVG adoption (use index loop), added non-null assertions for array access in `list()`. Disabled `skipLibCheck` so we catch consumer-facing type errors.

## 0.1.7

### Added

- **Logger** — `createLogger(tag)` returns a tagged logger with `info`, `warn`, `error`, `debug` methods. Level-gated via `setLogLevel()` or `LOG_LEVEL` env var. Includes `loggedRequest(tag, handler)` for wrapping route handlers with access logging and timing.

### Removed

- **`log.ts`** — consolidated into `logger.ts`.

## 0.1.6

### Added

- **SVG support** — `<svg>` elements are created with the SVG namespace. Child elements appended to an SVG-namespaced parent are automatically adopted into the SVG namespace, handling JSX's bottom-up evaluation order transparently. Write `<svg><g><circle /></g></svg>` and it just works.
- **`applyProps()` extracted** — shared prop application for both initial element creation and SVG adoption, ensuring signals and event handlers survive namespace adoption.

### Fixed

- **`className`/`class` now uses `setAttribute`** instead of `.className` property, which is required for SVG elements.

## 0.1.5

### Fixed

- **Export JSX namespace from `jsx-runtime`** — TypeScript's `react-jsx` mode requires the JSX namespace to be exported from the runtime module for type checking to work.

## 0.1.4

### Fixed

- **`Fragment` now reads `props.children`** — `createElement` passes children as `props.children` when calling function components, but `Fragment` only read rest params (which were empty). This broke all `<>...</>` usage via the automatic JSX runtime.

### Docs

- Added anti-patterns: `text()` for attributes (#6), missing dispose scopes (#9), `transition-all` CSS (#10).
- Added `computed()` for reactive attributes example and full dispose scope pattern to `jsx.md`.

## 0.1.3

### Fixed

- **`jsx-dev-runtime` now exports `jsxDEV`** — Bun's dev bundler uses `"jsx": "react-jsxdev"` internally and imports `jsxDEV`, which was missing. Added as a re-export of `jsx`.

## 0.1.2

### Added

- **Automatic JSX runtime** — `jsx-runtime.ts` and `jsx-dev-runtime.ts` enable `"jsx": "react-jsx"` with `"jsxImportSource": "@blueshed/railroad"`, so consumers can write JSX without importing `createElement`.
- **Claude Code skill** — ships in `.claude/skills/railroad/` with API reference, patterns, and anti-patterns for correct railroad code generation.

## 0.1.1

### Fixed

- **`when()` now only swaps on truthiness transitions.** Previously, any value change (e.g. `"a"` → `"b"`) would destroy and recreate the truthy branch. Now it compares `!!oldVal` vs `!!newVal` and only swaps when the branch actually changes (falsy↔truthy). Components inside each branch should use signals to react to value changes within the same branch.

## 0.1.0

### Added

- **Signals** — `signal`, `computed`, `effect`, `batch` with automatic dependency tracking and cleanup.
- **JSX runtime** — `createElement`, `Fragment` producing real DOM nodes. Signal-aware children and props auto-update via effects.
- **Reactive helpers** — `text()` for computed text nodes, `when()` for conditional rendering, `list()` for keyed list rendering.
- **Dispose scoping** — `pushDisposeScope` / `popDisposeScope` to collect and clean up effects.
- **Routes** — hash-based client router with automatic dispose scoping on navigation.
- **Shared** — typed dependency injection via `key`, `provide`, `inject`.
