# Changelog

## 0.10.1

A cross-library hardening pass with `@blueshed/delta`: two `when()`/`list()`
lifecycle bugs found in an adversarial review, and an escape hatch for
in-place patch streams. Every fix is pinned by a regression test, and the
delta repo gains an integration suite that drives the pairing — real server,
real WebSocket, real DOM — end to end.

### Added

- **Keyed `list()` takes a fourth `options` argument** (`SignalOptions<T>`,
  forwarded to each row's item signal). Patch streams that mutate row objects
  in place and notify via `.touch()` (delta's JSON-file backend, hand-rolled
  `applyPatch` loops) re-deliver the same reference on sync, which the default
  `Object.is` equality swallowed — edited rows went silently stale. Pass
  `{ equals: () => false }` to force per-row re-projection; row-level `.map()`
  computeds still prune unchanged values, so DOM writes stay minimal.

### Fixed

- **`when()`/`list()` no longer build content after disposal.** Their first
  render is always deferred by a microtask (the anchor has no parent until the
  returned fragment is appended), so disposing the owning scope in that window
  — e.g. a keyed row added and removed in the same flush of a realtime patch
  stream — let the queued swap/sync run anyway: it rebuilt the branch/rows and
  leaked their effects, whose disposers were captured after the scope cleanup
  had already run. Both helpers now latch a `disposed` flag in their scope
  cleanup and the deferred callback is a no-op after it. (`list()` was only
  shielded when its anchor had left the DOM entirely; an anchor still sitting
  in a detached-but-parented subtree rebuilt every row.)
- **Keyed `list()` reorders no longer strand `when()` branch nodes.** A row
  whose top-level content is a `when()` (or a fragment containing one) kept
  only the `when` anchor comment in the list's node bookkeeping — the branch
  nodes it inserts beside that anchor later were left behind on reorder,
  silently scrambling row content. Each row is now bracketed by
  `<!--row-->`/`<!--/row-->` comment markers and reorders/removals operate on
  the whole live range, so nodes that `when()` (or a nested `list()`) inserts
  next to its anchor travel with the row. Rows therefore contribute two extra
  comment nodes each — invisible to CSS and `children`, but visible to code
  that walks `childNodes` by index.

## 0.10.0

SVG promoted to first-class and the two long-standing core caveats removed:
propagation is now glitch-free, and the dispose-scope rule got a real API plus
a guardrail. Every change is pinned by a regression test; the WebView suite
verifies the SVG work in real Chrome.

### Added

- **`mount(target, render)`** — root dispose scope for apps mounted outside
  `routes()`. Effects, `when()`, and `list()` created by the render callback
  tear down via the returned disposer, which also removes the rendered nodes.
- **`hasActiveDisposeScope()`** — exported alongside the scope primitives.
- **Scope guardrail:** `when()`/`list()` created outside any dispose scope now
  `console.warn` — their internal disposers are unreachable, a guaranteed leak
  once that UI unmounts.

### Changed

- **Signals are glitch-free.** Propagation is topologically scheduled: a write
  (or batch) runs each affected computed/effect at most once per settled pass,
  ordered by derivation depth. A diamond (`a → b`, `a → c`, effect reads both)
  re-runs the effect once and never observes half-updated state. Deep computed
  chains no longer grow the call stack. The cycle guard is now per-listener per
  flush (same `Maximum effect depth` error).
- **SVG namespace is decided at creation.** SVG-only tags (`circle`, `g`,
  `linearGradient`, `clipPath`, `foreignObject`, `fe*` filters, …) are created
  via `createElementNS` directly, so refs fire once, manual `addEventListener`
  survives, and camelCase needs no rescue. Only the four HTML-ambiguous tags
  (`a`, `script`, `style`, `title`) still use append-time adoption.

### Fixed

- **`when()` leaked its active branch on parent teardown.** The branch scope's
  disposer was only invoked on the next truthiness swap, so effects inside the
  rendered branch outlived route/component teardown and kept writing to
  detached DOM. `when()` now registers branch cleanup in the parent scope, as
  `list()` already did.
- **camelCase SVG tags were silently broken** (pre-table):
  `document.createElement` lowercased `linearGradient` et al. before adoption,
  producing SVG-namespace elements the browser doesn't recognise. Now created
  with correct case; real Chrome asserts `instanceof SVGLinearGradientElement`
  in the WebView suite.
- **`<foreignObject>` children were force-adopted into the SVG namespace**,
  destroying HTML islands. Adoption (and `when()`/`list()` insertion) stops at
  the `foreignObject` boundary.
- **Fragment children inside `<svg>` bypassed adoption** — `<>...</>` and
  components returning fragments left children in the HTML namespace.
- **A throwing effect run stranded its new subscriptions:** the dep-set swap
  was skipped on throw, so `dispose()` could never unsubscribe signals first
  read in the failed run.
- **`batch()` no longer masks an error thrown by `fn()`** with a later flush
  error; the flush still drains, but the original exception wins.
- **Docs:** route matching documented as segment-only (query strings fold into
  the last param; trailing slash is a real empty segment); README
  ships-both-skills copy instructions; bun-route reference updated to the seven
  gotchas and the `mount()` pattern.

## 0.9.0

A deep correctness/fitness review drove this release. Every item below is pinned
by a regression test; the full suite and a new consumer-typecheck pass are green.

### Fixed

- **Router: async first render no longer imbalances the dispose stack.** When a
  router's first matching handler was async, `routes()` returned with an extra
  scope left on the global dispose stack. Nested inside a parent scope (the
  documented pattern), the parent then popped the wrong scope — leaking its own
  disposers — and the resolving render captured the parent scope into
  `activeDispose`, recursing into a **stack overflow on teardown**. `run()` now
  always returns at the depth it entered, sync or async.
- **Router: `dispose()` is idempotent.** Calling the returned disposer more than
  once (or via both the handle and a parent scope) previously drove the shared
  `hashListenerCount` negative and detached the `hashchange` listener out from
  under other live routers. `route()` got the same guard.
- **Router: same-pattern param navigation during a pending async render** now
  invalidates the in-flight render and re-runs the handler, instead of painting
  stale content built from the original params.
- **Router: a throwing `onError` boundary on the async-reject path** is now
  contained (logged via `console.error`) like the sync path, instead of escaping
  as an unhandled rejection.
- **Signals: an effect disposed mid-`batch()` no longer runs.** Effects carry a
  `disposed` flag checked before execution, so a `batch()` flush that snapshotted
  the queue before disposal can't run a dead effect. `effect()`'s disposer is now
  idempotent.
- **JSX: SVG namespace adoption no longer double-subscribes.** Adopting an HTML
  element into `<svg>` re-applied its props to a fresh SVG element while leaving
  the discarded element's reactive effects live (writing to a detached node). The
  discarded element's effects are now torn down first; the `ref` ends on the
  final SVG-namespace element.
- **JSX: cleared signal values coerce to `""`** for `value`/`checked`/`src`/etc.,
  instead of writing the literal string `"null"`/`"undefined"`.
- **`matchRoute`** keeps the raw segment when a `:param` has a malformed percent-
  escape (consistent with the wildcard branch) instead of silently failing to
  match.

### Changed

- **`provide(k, undefined)` is now honored** — presence is tracked by key
  (`registry.has`), so `inject(k)` returns a provided `undefined` instead of
  throwing "No provider".
- **Infinite-loop guard raised** from 100 to 1000 (and the check now precedes the
  increment), so a legitimately deep computed chain isn't misreported as a loop.
- **Logger emits ANSI colors only to an interactive TTY** and respects
  `NO_COLOR`; logs stay plain when piped, redirected, or in a browser. Env is read
  via a typed cast so consumers no longer need `@types/bun`.

### Added

- `clearProviders()` (DI registry reset, for test isolation).
- Re-exported dispose-scope primitives from the package root: `trackDispose`,
  `pushDisposeScope`, `popDisposeScope`.
- New `./logger` and `./package.json` subpath exports; `engines.bun` marker.
- Dev-mode `console.warn` for `list()` duplicate keys and for a function child
  that returns a Node.
- Scripts: `test:webview` (explicit WebView run) and `check:consumer` (type-check
  against the documented react-jsx + strict + no-`@types/bun` config).
- `tests/consumer-types/` fixture exercising the documented consumer surface.

### Type-safety / DX

- **`list()` is now real overloads**, so the bare-arrow keyed form
  `list(rows, r => r.id, …)` infers `r` and compiles under a consumer's `strict`
  tsconfig (previously `implicitly has an 'any' type`).
- **Importing the package root type-checks without `@types/bun`** (the
  `globalThis.Bun` `TS7017` break is fixed); CI now gates the consumer config.

### CI / packaging

- `bun.lock` is committed; CI and publish install with `--frozen-lockfile`.
- CI and publish run the WebView suite as an explicit step (bare `bun test` can
  drop it from discovery) and run `bun run check:consumer`.
- Pinned `setup-bun` to `1.3.14` in CI/publish (previously resolved implicitly
  from `engines.bun`), and gave the WebView suite a 30s default timeout so a cold
  Chrome launch on CI runners can't trip Bun's 5s per-test default.

### Skills

- **`bun-route` skill refreshed for Bun 1.3.13–1.3.14 `Bun.WebView`/`Bun.serve`:**
  native double-click via `click(selector, { clickCount: 2 })` (retires the
  synthetic-`dblclick` recipe), per-click `timeout`, constructor `console`/
  `dataStore` options, `view.url`/`title`/`loading` properties, `Range`/`206`
  file serving, `--target=bun` keeping `using` native, and the `bun test`
  `--isolate`/`--parallel`/`--shard`/`--changed` flags.

## 0.8.2

### Fixed

- **`batch()` no longer strands queued effects on a throw** — if an effect throws mid-flush, the remaining effects already queued behind it still run; the first error is remembered and rethrown once the flush drains. Previously a throwing effect aborted the loop and silently dropped the rest.
- **Throwing components keep the dispose-scope stack balanced** — `createElement` now wraps component render in `try/finally`, so a component that throws still pops its dispose scope. Previously the leaked scope corrupted every later `pushDisposeScope`/`popDisposeScope`.
- **Unknown `LOG_LEVEL` falls back to `info`** — a typo'd value (env or `setLogLevel`) no longer makes `LEVELS[current]` undefined and silence all logs including errors; unknown values coerce back to `"info"`.

### Docs

- JSDoc on `signals.ts` (eager/non-glitch-free propagation, `.mutate()` `structuredClone` limits), `routes.ts` (declaration-order matching), and `shared.ts` (process-global DI, not per-request on the server).
- README: new "Sharp edges to know" section; added `CLAUDE.md` repository guide.

### CI

- Added `.github/workflows/ci.yml` (tsc + test on push/PR) and a Chrome-locating step for the `Bun.WebView` integration tests in both CI and publish workflows.

### Tests

- Added tests for batch throw-resilience, component-throw dispose balance, and logger level fallback. Suite: 109 → **112 passing tests**.

## 0.8.1

### Added

- **`options.onError` router boundary callback** — `routes(container, table, options)` now accepts `options.onError(err)`. Synchronous route throws and async handler rejections invoke the callback; if it returns a `Node`, the fallback is rendered into the container instead of a blank screen. Dispose scope stack stays balanced. Returning nothing preserves the prior behavior (sync re-throws, async logs to `console.error`).

### Fixed

- **`style` signal property clearance** — reactive style updates now track previously written keys and reset any key omitted by the next style object to `""`. Previously, `sty.set({ color: "blue" })` after `{ color: "red", fontSize: "10px" }` left `fontSize: 10px` lingering on the element.

### Tests

- **`routes.test.ts`** — added two tests covering sync and async `onError` boundary fallback rendering.
- **`jsx.test.tsx`** — added a test verifying dynamic style-key clearance when style signals omit keys.
- Suite: 106 → **109 passing tests**.

### Docs

- **SKILL.md** — expanded operational checklist from five to seven gotchas: lowercase HTML event handlers (`onclick`, not `onClick`), and `list()` vs plain `.map()` for dynamic arrays.
- **`/publish` skill** — restructured with frontmatter; codified the rule that the skill itself is the authorisation for the push (per global `CLAUDE.md`); requires skill `version:` frontmatter to track `package.json`.

## 0.8.0

### Re-positioned, not redesigned

Railroad's earliest commit message described it as "based on the TC39 Signals proposal." The code never matched that claim — railroad has always been push-based, with `effect()` and `batch()` in core, in the same family as Vue's `ref`, Solid's `createSignal`, and Preact's signals. The TC39 proposal is pull-based and explicitly leaves effects out of core. They are different things.

This release stops claiming TC39 alignment and re-pitches railroad honestly under the brief it actually serves: **the smallest correct reactive layer for Bun realtime apps**, designed to be small enough that an LLM can use it correctly without re-learning the framework.

### Added — borrowed-from-RFC, useful on their own merits

- **`ReadonlySignal<T>`** — interface returned by `computed()` and `Signal.map()`. `.set()` on a computed is now a TypeScript error. Runtime is unchanged (the underlying object is still a Signal).
- **`SignalOptions { equals }`** — per-signal equality function on `signal()`, `computed()`, and the `Signal` constructor. Default is `Object.is`.
- **`untrack(fn)`** — read without registering a dependency. Function-form complement to `.peek()`.

### Fixed

- **`routes()` no longer leaks dispose state on async first-render.** The outer dispose function was being registered into the route's own internal scope when the first handler returned a Promise, causing infinite recursion on teardown.
- **`routes()` no longer kills the router on a synchronous handler error.** Errors are caught at the boundary, dispose stack stays balanced, error is logged via `console.error`.
- **`routes()` async handler rejections** are similarly caught and logged rather than swallowing the rejection unsafely.
- **`popDisposeScope()` throws on empty stack** instead of silently returning a no-op — surfaces push/pop imbalance immediately.
- **`computed()` evaluates `fn()` exactly once on creation** (was twice). The new implementation creates the inner Signal during the effect's first run, eliminating the double evaluation that surprised callers using `Date.now()` / `Math.random()` inside `fn`.

### Tests

- **`routes.test.ts` (new)** — 15 happy-dom tests covering `routes()`, `route()`, `navigate()`, the async race, sync handler errors, `params$` reactivity within the same pattern, wildcard layouts, dispose semantics. The async-first-render bug above was caught by these tests.
- **Reactive prop tests in `jsx.test.tsx`** — value, checked, disabled, class, generic attribute, style, innerHTML, function children, event handlers, ref callbacks. Plus a nested when-inside-list composition test.
- **`tests/webview.test.ts` (new)** — Bun.WebView integration tests with a fixture app at `tests/fixtures/`. Five tests run the actual DOM in a real headless browser (WKWebView on macOS): home route + DI + reactive count, keyed list identity, hash navigation + params reactivity, SVG namespace, async route resolution. Catches what happy-dom misses.
- **`signals.test.ts` additions** — equals option, untrack, computed-as-readonly TS contract.
- Suite: 64 → **106 passing tests**.

### Docs

- **README rewritten** — leads with the actual brief ("smallest correct thing for the Bun-HTML-import-TSX workflow"), explicit about not being a TC39 implementation, explicit about what to use instead (Preact / Solid / signal-polyfill) when railroad isn't the right fit. Added a worked realtime example showing in-place patch application via `.touch()`.
- **SKILL.md rewritten** — operational checklist of the five failure modes encountered in development (no `.get()` in JSX children, list keyed render gets a Signal, SVG only adopts inside `<svg>`, effects auto-dispose only inside parent scopes, realtime escape hatches for large documents). Added a "when not to use railroad" section.

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
