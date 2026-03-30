# Changelog

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
