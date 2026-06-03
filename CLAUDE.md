# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## What this is

`@blueshed/railroad` — the smallest reactive layer for Bun realtime apps:
signals, a real-DOM JSX runtime, a hash router, typed DI, and a logger. Zero
runtime dependencies, ~1KLOC. Each module is independent and importable on its
own (`@blueshed/railroad/signals`, `/jsx`, `/routes`, `/shared`, `/logger`).

| File | Exports | Depends on |
|---|---|---|
| `signals.ts` | `signal` `computed` `effect` `batch` `untrack` `Signal` `trackDispose` `pushDisposeScope` `popDisposeScope` | — |
| `jsx.ts` | `createElement` `Fragment` `when` `list` | signals |
| `routes.ts` | `routes` `route` `navigate` `matchRoute` | signals |
| `shared.ts` | `key` `provide` `inject` `tryInject` `clearProviders` | — |
| `logger.ts` | `createLogger` `setLogLevel` `getLogLevel` `loggedRequest` | — |
| `index.ts` | re-exports the public surface | all of the above |
| `jsx-runtime.ts` / `jsx-dev-runtime.ts` | `jsx` `jsxs` `jsxDEV` `Fragment` | jsx |

This package is **Bun-/bundler-only**: it ships TypeScript source with no build
step and uses extensionless imports, so consumers must use `moduleResolution:
"bundler"` (or `"bun"`). It does not resolve under `node16`/`nodenext`.

Every source file has a JSDoc header that is the authoritative API reference —
read it before changing behaviour. `.claude/skills/railroad/SKILL.md` documents
the usage gotchas.

## Commands

```sh
bun install          # install dev deps
bun test             # unit suite (happy-dom)
bun run test:webview # real-browser WebView integration tests (explicit)
bun run check        # bunx tsc --noEmit — strict, noUncheckedIndexedAccess
bun run check:consumer # tsc against the documented consumer config (react-jsx, no @types/bun)
```

Unit tests run against happy-dom (preloaded via `bunfig.toml`). The integration
tests in `tests/webview.test.ts` drive a real headless browser via `Bun.WebView`
and need a one-time environment setup on Linux — see below.

Run the WebView suite via `bun run test:webview` (an explicit path). Bare
`bun test` discovers files under `tests/` non-deterministically and can silently
drop the WebView layer, so CI runs it as its own step — never rely on the bare
`bun test` count to tell you the browser tests ran.

`bun run check:consumer` type-checks `tests/consumer-types/` under the exact
config the README tells consumers to use (`jsx: react-jsx`, `jsxImportSource`,
`strict`, **no `@types/bun`**). The main `bun run check` uses `jsx: react`, so
this is the only gate on the automatic-runtime path consumers actually compile
against — keep it green.

## Testing in the Claude Code web sandbox

The default web sandbox could not run the WebView tests out of the box. Two
things had to be adapted; both are reproducible and do not change the library.

### 1. Bun version

`Bun.WebView` requires **Bun >= 1.3.12**. The image shipped 1.3.11, which made
all 5 WebView tests fail with `new Bun.WebView(...)` being `undefined is not a
constructor`. Upgrade via npm (the npm registry is reachable):

```sh
npm install -g bun@latest   # 1.3.14+ — provides Bun.WebView
```

### 2. A Chrome/Chromium backend

On Linux, `Bun.WebView` doesn't bundle a browser — it speaks CDP to an installed
Chrome/Chromium, located via `$BUN_CHROME_PATH` or a `$PATH` search. The sandbox
has no browser, Ubuntu's apt `chromium` is only a snap stub, and the usual
browser download hosts (`cdn.playwright.dev`, `googlechromelabs.github.io`,
`dl.google.com`, `storage.googleapis.com`) are blocked by the egress allowlist.

The npm registry and GitHub *are* reachable, so the binary comes from the
`@sparticuz/chromium` npm package, which bundles a real headless Chromium build
*inside the tarball* rather than fetching it from a CDN.

All of this — the Bun upgrade, `bun install`, and staging the browser — is
handled automatically by the `.claude/hooks/session-start.sh` SessionStart hook
(wired up in `.claude/settings.json`). It runs only when `CLAUDE_CODE_REMOTE`
is `true`, so it's a no-op on your local machine, and it's self-contained:
copy that one file plus the hook entry into any Bun project to get the same
setup. What it does, in order:

1. Upgrades Bun to >= 1.3.12 if the image is older (npm registry, no CDN).
2. `bun install` for dev dependencies.
3. Parks two preinstalled PPAs (deadsnakes, ondrej/php) that `403` and abort
   `apt update`, then installs Chromium's system libraries with
   `npx playwright install-deps chromium` (apt only — no CDN).
4. `npm pack @sparticuz/chromium`, brotli-decompresses `bin/chromium.br` into
   `/opt/chromium/chromium`, and unpacks the swiftshader (software GL) libs
   alongside it.
5. Writes `/opt/chromium/chrome-shim.sh`, a launcher that adds `--no-sandbox`
   `--disable-dev-shm-usage` `--disable-gpu` — without `--no-sandbox` a
   root-owned Chromium aborts at startup and Bun reports
   `Chrome process closed the pipe` — and persists `BUN_CHROME_PATH` to it for
   the session.

The unit tests need none of this and run anywhere with `bun test`.

## Conventions

- HTML-flavoured JSX: `class` not `className`, `onclick` not `onClick`.
- Never call `.get()` in JSX children — pass the bare signal (`{count}`), a
  function child (`{() => ...}`), or `.map()`. See SKILL.md §1.
- Effects/computeds auto-dispose only inside a parent scope (a component, a
  `routes()` handler, `when`, or `list`); a top-level `effect()` — or a `when`/
  `list`/`route()` created outside any scope — leaks unless you keep its
  disposer. `route()` (singular) returns a `ReadonlySignal`; it does not push a
  scope for children.
- TypeScript is strict with `noUncheckedIndexedAccess`. Keep both `bun run check`
  and `bun run check:consumer` clean.
- `bun.lock` is committed; CI/publish install with `--frozen-lockfile`. Keep it
  in sync (`bun install` after a dependency change) and commit the result.
- Publishing is release-driven: `.github/workflows/publish.yml` runs
  `bun test` + the WebView suite + `bunx tsc --noEmit` + `bun run check:consumer`
  then `npm publish --provenance` on a published GitHub release. Don't publish by
  hand.
